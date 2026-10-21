<script setup lang="ts">
/**
 * Everything that was sent: one row per recipient, newest first, for one
 * project or (on /emails) all of them. API sends, test sends, conversation
 * and feedback notifications all land here. A row opens the full entry:
 * who, what, which template and values, the delivery timeline from Mailgun's
 * webhook, and the message itself when the project keeps content.
 */
import { watchDebounced } from '@vueuse/core'
import type { EmailLogEntry, EmailLogStats, EmailLogStatus } from '~~/server/utils/emailLogs'
import type { AdminProject } from '~~/server/utils/projects'
import EmailTabs from '~/components/email/EmailTabs.vue'
import { compactCount, EMAIL_SOURCE_LABELS, EMAIL_STATUS, logTime } from '~/utils/emailStatus'

const props = defineProps<{ project?: AdminProject | null }>()

type EmailSettings = { configured: boolean, fromEmail: string, domain: string, webhook: { configured: boolean, url: string }, retentionDays: number }

const { api, projects } = useAgent()
const toast = useToast()
const { t } = useI18n()

const logs = ref<EmailLogEntry[]>([])
const stats = ref<EmailLogStats | null>(null)
const settings = ref<EmailSettings | null>(null)
const nextBefore = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')

const search = ref('')
const status = ref<EmailLogStatus | 'all'>('all')
const source = ref('all')
// The send key a row shows as its chip (submission-flagged, password-reset…).
const template = ref('all')
// A campaign links here with ?batch=cm_<id> to list its recipients.
const batch = ref(String(useRoute().query.batch || ''))

const statusItems = computed(() => [{ label: t('emailLibrary.log.anyStatus'), value: 'all' }, ...Object.entries(EMAIL_STATUS).map(([value, s]) => ({ label: s.label, value, icon: s.icon }))])
const sourceItems = computed(() => [{ label: t('emailLibrary.log.anySource'), value: 'all' }, ...Object.entries(EMAIL_SOURCE_LABELS).map(([value, label]) => ({ label, value }))])
// The keys sent in the last 30 days, most used first; a key picked from a link or an older send stays listed.
const templateItems = computed(() => {
  const keys = (stats.value?.topTemplates || []).map(item => item.key)
  if (template.value !== 'all' && !keys.includes(template.value)) keys.push(template.value)
  return [{ label: t('emailLibrary.log.anyTemplate'), value: 'all' }, ...keys.map(key => ({ label: key, value: key }))]
})

const query = computed(() => ({
  project: props.project?.id || undefined,
  to: search.value.trim() || undefined,
  status: status.value === 'all' ? undefined : status.value,
  source: source.value === 'all' ? undefined : source.value,
  template: template.value === 'all' ? undefined : template.value,
  batch: batch.value || undefined
}))

async function load() {
  error.value = ''
  try {
    const res = await api<{ logs: EmailLogEntry[], nextBefore: string | null }>('/admin/email-logs', { query: query.value })
    logs.value = res.logs
    nextBefore.value = res.nextBefore
  } catch (e: any) {
    error.value = e?.message || t('emailLibrary.log.loadError')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!nextBefore.value) return
  loadingMore.value = true
  try {
    const res = await api<{ logs: EmailLogEntry[], nextBefore: string | null }>('/admin/email-logs', { query: { ...query.value, before: nextBefore.value } })
    logs.value.push(...res.logs)
    nextBefore.value = res.nextBefore
  } catch (e: any) {
    toast.add({ title: e?.message || t('emailLibrary.log.loadMoreError'), color: 'error' })
  } finally {
    loadingMore.value = false
  }
}

function refresh() {
  load()
  api<EmailLogStats>('/admin/email-logs/stats', { query: { project: props.project?.id || undefined, days: 30 } }).then(s => { stats.value = s }).catch(() => {})
}

onMounted(() => {
  refresh()
  api<EmailSettings>('/admin/email-settings').then(s => { settings.value = s }).catch(() => {})
})
watchDebounced(query, load, { debounce: 300, deep: true })

// ---- figures ------------------------------------------------------------------------
const count = (...keys: string[]) => keys.reduce((sum, k) => sum + (stats.value?.byStatus[k] || 0), 0)
const tiles = computed(() => stats.value
  ? [
      { label: t('emailLibrary.log.tileEmails'), value: stats.value.total, hint: t('emailLibrary.log.tileEmailsHint') },
      { label: t('emailLibrary.log.tileDelivered'), value: count('delivered', 'opened', 'clicked', 'unsubscribed', 'complained'), hint: settings.value?.webhook.configured ? t('emailLibrary.log.tileDeliveredHint') : t('emailLibrary.log.tileDeliveredNeedsWebhook') },
      { label: t('emailLibrary.log.tileFailed'), value: count('failed', 'bounced'), hint: t('emailLibrary.log.tileFailedHint') },
      { label: t('emailLibrary.log.tileNotSent'), value: count('suppressed'), hint: t('emailLibrary.log.tileNotSentHint') }
    ]
  : [])

const projectName = (id: string | null) => (id ? projects.value.find(p => p.id === id)?.name || t('emailLibrary.log.project') : 'HelpBites')

// ---- one entry ------------------------------------------------------------------------
const openId = ref<string | null>(null)
const detail = ref<EmailLogEntry | null>(null)
const detailOpen = computed({ get: () => !!openId.value, set: (v) => { if (!v) openId.value = null } })
const showText = ref(false)
// With no saved copy, the template rendered with the logged values.
const templateHtml = ref('')

watch(openId, async (id) => {
  detail.value = null
  templateHtml.value = ''
  showText.value = false
  if (!id) return
  detail.value = logs.value.find(l => l.id === id) || null
  try {
    const res = await api<{ log: EmailLogEntry, templatePreview: string | null }>(`/admin/email-logs/${id}`)
    detail.value = res.log
    templateHtml.value = res.templatePreview || ''
  } catch (e: any) {
    toast.add({ title: e?.message || t('emailLibrary.log.openError'), color: 'error' })
  }
})

// ---- the sent message, full size -----------------------------------------------------
const preview = ref<EmailLogEntry | null>(null)
const previewFromTemplate = ref(false)
const previewOpen = computed({ get: () => !!preview.value, set: (v) => { if (!v) preview.value = null } })

async function openPreview(entry: EmailLogEntry, fallbackHtml = '') {
  previewFromTemplate.value = false
  preview.value = entry
  if (entry.html) return
  try {
    let { log, templatePreview } = fallbackHtml ? { log: entry, templatePreview: fallbackHtml } : await api<{ log: EmailLogEntry, templatePreview: string | null }>(`/admin/email-logs/${entry.id}`)
    if (preview.value?.id !== entry.id) return
    if (!log.html && templatePreview) {
      log = { ...log, html: templatePreview }
      previewFromTemplate.value = true
    }
    if (!log.html) throw new Error(t('emailLibrary.log.notKept'))
    preview.value = log
  } catch (e: any) {
    preview.value = null
    toast.add({ title: e?.message || t('emailLibrary.log.messageError'), color: 'error' })
  }
}

function showBatch(id: string) {
  batch.value = id
  search.value = ''
  status.value = 'all'
  source.value = 'all'
  template.value = 'all'
  openId.value = null
}

async function suppress(entry: EmailLogEntry) {
  if (!entry.projectId || !window.confirm(t('emailLibrary.log.stopConfirm', { project: projectName(entry.projectId), to: entry.to }))) return
  try {
    await api('/admin/email-suppressions', { method: 'POST', body: { project: entry.projectId, emails: [entry.to], reason: 'manual', detail: 'Added from the email log' } })
    toast.add({ title: t('emailLibrary.log.suppressedToast', { to: entry.to }), color: 'success', icon: 'i-lucide-mail-x' })
  } catch (e: any) {
    toast.add({ title: e?.message || t('emailLibrary.log.suppressError'), color: 'error' })
  }
}

async function copy(text: string, what: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: t('emailLibrary.common.copied', { what }), icon: 'i-lucide-clipboard-check', color: 'success' })
}

const fullDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : '')
const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project?.id" :title="$t('nav.email')">
      <template #title><EmailTabs current="log" :masters="!project" /></template>
      <template #actions>
        <UInput v-model="search" icon="i-lucide-search" :placeholder="$t('emailLibrary.log.address')" size="sm" class="hidden w-44 sm:block" :aria-label="$t('emailLibrary.log.filterByAddress')" />
        <USelect v-model="status" :items="statusItems" value-key="value" size="sm" class="hidden w-36 md:flex" :aria-label="$t('emailLibrary.log.status')" />
        <USelect v-model="source" :items="sourceItems" value-key="value" size="sm" class="hidden w-32 lg:flex" :aria-label="$t('emailLibrary.log.source')" />
        <USelect v-model="template" :items="templateItems" value-key="value" size="sm" class="hidden w-44 lg:flex" :ui="{ content: 'min-w-48' }" :aria-label="$t('emailLibrary.log.template')" />
        <UTooltip :text="$t('emailLibrary.log.refresh')"><UButton icon="i-lucide-refresh-cw" size="sm" color="neutral" variant="ghost" square class="text-muted" :aria-label="$t('emailLibrary.log.refresh')" @click="refresh" /></UTooltip>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <section class="border-b border-default px-4 py-4 md:px-6" :aria-label="$t('emailLibrary.log.last30Days')">
        <div v-if="!stats" class="grid grid-cols-2 gap-3 lg:grid-cols-4"><USkeleton v-for="n in 4" :key="n" class="h-[74px] rounded-xl" /></div>
        <div v-else class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div v-for="tile in tiles" :key="tile.label" class="rounded-xl border border-default bg-default px-4 py-3">
            <p class="text-xs text-muted">{{ tile.label }}</p>
            <p class="mt-1 text-2xl font-semibold text-highlighted">{{ compactCount(tile.value) }}</p>
            <p class="mt-0.5 truncate text-[11px] text-dimmed">{{ tile.hint }}</p>
          </div>
        </div>
        <UAlert
          v-if="settings && !settings.configured"
          class="mt-3"
          icon="i-lucide-mail-warning"
          color="warning"
          variant="soft"
          :title="$t('emailLibrary.log.notConfiguredTitle')"
          :description="$t('emailLibrary.log.notConfiguredDescription')"
        />
        <UAlert
          v-else-if="settings && !settings.webhook.configured"
          class="mt-3"
          icon="i-lucide-webhook"
          color="neutral"
          variant="soft"
          :title="$t('emailLibrary.log.webhookTitle')"
          :description="$t('emailLibrary.log.webhookDescription', { url: settings.webhook.url })"
        />
      </section>

      <div v-if="batch" class="flex items-center gap-2 border-b border-default px-6 py-2 text-[13px] text-muted">
        <UIcon name="i-lucide-layers" class="size-4" />{{ $t('emailLibrary.log.batchRecipients') }} <code class="font-mono text-xs">{{ batch }}</code>
        <UButton :label="$t('emailLibrary.log.showEverything')" size="xs" color="neutral" variant="ghost" class="ml-auto" @click="batch = ''" />
      </div>

      <div v-if="loading" class="space-y-1 p-4"><USkeleton v-for="i in 8" :key="i" class="h-11" /></div>
      <p v-else-if="error" class="p-6 text-[13px] text-error">{{ error }}</p>
      <EmptyState
        v-else-if="!logs.length"
        icon="i-lucide-history"
        :title="query.to || query.status || query.source || query.template || query.batch ? $t('emailLibrary.log.noMatch') : $t('emailLibrary.log.nothingYet')"
        :description="query.to || query.status || query.source || query.template || query.batch ? $t('emailLibrary.log.noMatchDescription') : $t('emailLibrary.log.nothingYetDescription')"
      />
      <ul v-else class="py-2" :aria-label="$t('emailLibrary.log.sentEmails')">
        <li v-for="entry in logs" :key="entry.id" class="mx-2 flex items-center rounded-lg pr-2 transition-colors hover:bg-elevated">
          <button type="button" class="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-left text-[13px]" @click="openId = entry.id">
            <UTooltip :text="EMAIL_STATUS[entry.status].hint">
              <UBadge :icon="EMAIL_STATUS[entry.status].icon" :label="EMAIL_STATUS[entry.status].label" :color="EMAIL_STATUS[entry.status].color" variant="subtle" size="sm" class="w-fit shrink-0 justify-start" />
            </UTooltip>
            <span class="w-48 shrink-0 truncate font-medium text-highlighted" :title="entry.to">{{ entry.to }}</span>
            <span class="min-w-0 flex-1 truncate text-muted">{{ entry.subject }}</span>
            <code v-if="entry.template?.key" class="hidden max-w-36 shrink-0 truncate rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-toned md:block">{{ entry.template.key }}</code>
            <span v-else-if="entry.template?.name" class="hidden max-w-44 shrink-0 truncate text-xs text-dimmed md:block">{{ entry.template.name }}</span>
            <span v-if="!project" class="hidden w-fit shrink-0 truncate text-xs text-muted lg:block">{{ projectName(entry.projectId) }}</span>
            <span class="hidden w-20 shrink-0 text-xs text-muted xl:block">{{ EMAIL_SOURCE_LABELS[entry.source] || entry.source }}</span>
            <UIcon v-if="entry.testMode" name="i-lucide-flask-conical" class="size-3.5 shrink-0 text-dimmed" :aria-label="$t('emailLibrary.log.testMode')" />
            <span class="w-14 shrink-0 text-right text-xs text-muted">{{ logTime(entry.createdAt) }}</span>
          </button>
          <span class="flex w-7 shrink-0 justify-end">
            <UTooltip v-if="entry.hasContent || entry.template?.id" :text="$t('emailLibrary.log.previewEmail')">
              <UButton icon="i-lucide-eye" size="xs" color="neutral" variant="ghost" square class="text-muted" :aria-label="$t('emailLibrary.log.previewEmail')" @click="openPreview(entry)" />
            </UTooltip>
          </span>
        </li>
      </ul>
      <div v-if="nextBefore && !loading" class="flex justify-center pb-6">
        <UButton :label="$t('emailLibrary.log.loadMore')" color="neutral" variant="outline" size="sm" :loading="loadingMore" @click="loadMore" />
      </div>
    </div>

    <USlideover v-model:open="detailOpen" :title="detail?.subject || $t('nav.email')" :description="detail ? $t('emailLibrary.log.toLine', { to: detail.to, date: fullDate(detail.createdAt) }) : ''" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <div v-if="!detail" class="space-y-2"><USkeleton v-for="i in 6" :key="i" class="h-8" /></div>
        <div v-else class="space-y-6 text-[13px]">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge :icon="EMAIL_STATUS[detail.status].icon" :label="EMAIL_STATUS[detail.status].label" :color="EMAIL_STATUS[detail.status].color" variant="subtle" />
            <span class="text-muted">{{ EMAIL_STATUS[detail.status].hint }}</span>
          </div>
          <p v-if="detail.error" class="rounded-lg bg-error/10 px-3 py-2 font-mono text-xs text-error">{{ detail.error }}</p>

          <dl class="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2">
            <dt class="text-muted">{{ $t('emailLibrary.log.to') }}</dt><dd class="min-w-0 break-words">{{ detail.toName ? `${detail.toName} <${detail.to}>` : detail.to }}</dd>
            <template v-if="detail.cc.length"><dt class="text-muted">{{ $t('emailLibrary.log.cc') }}</dt><dd class="min-w-0 break-words">{{ detail.cc.join(', ') }}</dd></template>
            <template v-if="detail.bcc.length"><dt class="text-muted">{{ $t('emailLibrary.log.bcc') }}</dt><dd class="min-w-0 break-words">{{ detail.bcc.join(', ') }}</dd></template>
            <dt class="text-muted">{{ $t('emailLibrary.log.from') }}</dt><dd class="min-w-0 break-words">{{ detail.from }}</dd>
            <template v-if="detail.replyTo"><dt class="text-muted">{{ $t('emailLibrary.log.replyTo') }}</dt><dd class="min-w-0 break-words">{{ detail.replyTo }}</dd></template>
            <dt class="text-muted">{{ $t('emailLibrary.log.template') }}</dt>
            <dd class="min-w-0">
              <template v-if="detail.template">
                <NuxtLink v-if="detail.template.id" :to="`/emails/${detail.template.id}`" class="underline decoration-dotted underline-offset-2">{{ detail.template.name || detail.template.key }}</NuxtLink>
                <span v-else>{{ detail.template.name || detail.template.key }}</span>
                <code v-if="detail.template.key" class="ml-2 font-mono text-xs text-muted">{{ detail.template.key }}</code>
              </template>
              <span v-else class="text-muted">{{ detail.kind === 'html' ? $t('emailLibrary.log.kindHtml') : detail.kind === 'document' ? $t('emailLibrary.log.kindDocument') : detail.kind === 'message' ? $t('emailLibrary.log.kindMessage') : '—' }}</span>
            </dd>
            <template v-if="!project"><dt class="text-muted">{{ $t('emailLibrary.log.project') }}</dt><dd>{{ projectName(detail.projectId) }}</dd></template>
            <dt class="text-muted">{{ $t('emailLibrary.log.sentBy') }}</dt><dd>{{ EMAIL_SOURCE_LABELS[detail.source] || detail.source }}<span v-if="detail.actor.name" class="text-muted"> · {{ detail.actor.name }}</span><span v-if="detail.testMode" class="text-muted"> · {{ $t('emailLibrary.log.mailgunTestMode') }}</span></dd>
            <template v-if="detail.scheduledAt"><dt class="text-muted">{{ $t('emailLibrary.log.scheduledFor') }}</dt><dd>{{ fullDate(detail.scheduledAt) }}</dd></template>
            <template v-if="detail.tags.length"><dt class="text-muted">{{ $t('emailLibrary.log.tags') }}</dt><dd class="flex flex-wrap gap-1"><UBadge v-for="tag in detail.tags" :key="tag" :label="tag" color="neutral" variant="soft" size="sm" /></dd></template>
            <template v-if="Object.keys(detail.metadata).length"><dt class="text-muted">{{ $t('emailLibrary.log.metadata') }}</dt><dd class="space-y-0.5"><div v-for="(value, key) in detail.metadata" :key="key"><code class="font-mono text-xs text-muted">{{ key }}</code> {{ value }}</div></dd></template>
            <template v-if="detail.attachments.length"><dt class="text-muted">{{ $t('emailLibrary.log.attachments') }}</dt><dd class="space-y-0.5"><div v-for="file in detail.attachments" :key="file.filename" class="flex items-center gap-1.5"><UIcon name="i-lucide-paperclip" class="size-3.5 text-muted" />{{ file.filename }}<span class="text-xs text-muted">{{ kb(file.size) }}{{ file.inline ? ` · ${$t('emailLibrary.log.inline')}` : '' }}</span></div></dd></template>
            <template v-if="detail.headers.length"><dt class="text-muted">{{ $t('emailLibrary.log.headers') }}</dt><dd class="font-mono text-xs">{{ detail.headers.join(', ') }}</dd></template>
            <dt class="text-muted">{{ $t('emailLibrary.log.send') }}</dt>
            <dd class="flex items-center gap-2">
              <code class="font-mono text-xs">{{ detail.batchId }}</code>
              <UButton :label="$t('emailLibrary.log.allRecipients')" size="xs" color="neutral" variant="ghost" @click="showBatch(detail.batchId)" />
            </dd>
            <template v-if="detail.messageId"><dt class="text-muted">{{ $t('emailLibrary.log.messageId') }}</dt><dd class="min-w-0 break-all font-mono text-xs">{{ detail.messageId }}</dd></template>
            <template v-if="detail.idempotencyKey"><dt class="text-muted">{{ $t('emailLibrary.log.idempotencyKey') }}</dt><dd class="font-mono text-xs">{{ detail.idempotencyKey }}</dd></template>
            <template v-if="detail.ip"><dt class="text-muted">{{ $t('emailLibrary.log.request') }}</dt><dd class="min-w-0 truncate text-xs text-muted" :title="detail.userAgent">{{ detail.ip }}{{ detail.userAgent ? ` · ${detail.userAgent}` : '' }}</dd></template>
          </dl>

          <section v-if="detail.variables.length" class="space-y-2">
            <h3 class="text-xs font-semibold text-muted">{{ $t('emailLibrary.log.valuesSentWith') }}</h3>
            <ul class="divide-y divide-default rounded-lg border border-default">
              <li v-for="v in detail.variables" :key="v.key" class="flex items-baseline gap-3 px-3 py-1.5">
                <code class="w-36 shrink-0 truncate font-mono text-xs">{{ v.key }}</code>
                <span v-if="v.value === '[redacted]'" class="flex items-center gap-1 text-xs text-dimmed"><UIcon name="i-lucide-lock" class="size-3" />{{ $t('emailLibrary.log.redacted') }}</span>
                <span v-else class="min-w-0 flex-1 break-words text-xs">{{ v.value }}</span>
              </li>
            </ul>
          </section>

          <section class="space-y-2">
            <h3 class="text-xs font-semibold text-muted">{{ $t('emailLibrary.log.timeline') }}</h3>
            <ol class="space-y-1.5">
              <li class="flex items-baseline gap-2"><UIcon name="i-lucide-send" class="size-3.5 shrink-0 text-muted" /><span class="flex-1">{{ detail.status === 'failed' ? $t('emailLibrary.log.refused') : detail.status === 'suppressed' ? $t('emailLibrary.log.skipped') : $t('emailLibrary.log.handedOff') }}</span><span class="text-xs text-muted">{{ fullDate(detail.createdAt) }}</span></li>
              <li v-for="(e, i) in detail.events" :key="i" class="flex items-baseline gap-2">
                <UIcon :name="EMAIL_STATUS[e.type as EmailLogStatus]?.icon || 'i-lucide-hourglass'" class="size-3.5 shrink-0 text-muted" />
                <span class="min-w-0 flex-1 break-words">{{ EMAIL_STATUS[e.type as EmailLogStatus]?.label || (e.type === 'deferred' ? $t('emailLibrary.log.deferred') : e.type) }}<span v-if="e.detail" class="text-muted"> · {{ e.detail }}</span></span>
                <span class="shrink-0 text-xs text-muted">{{ fullDate(e.at) }}</span>
              </li>
            </ol>
          </section>

          <section class="space-y-2">
            <div class="flex items-center gap-2">
              <h3 class="flex-1 text-xs font-semibold text-muted">{{ $t('emailLibrary.log.theMessage') }}</h3>
              <UButton v-if="detail.html" :label="showText ? $t('emailLibrary.log.htmlView') : $t('emailLibrary.log.plainText')" size="xs" color="neutral" variant="ghost" @click="showText = !showText" />
              <UButton v-if="detail.html" icon="i-lucide-maximize-2" :label="$t('emailLibrary.log.fullSize')" size="xs" color="neutral" variant="ghost" @click="openPreview(detail)" />
              <UButton v-else-if="templateHtml" icon="i-lucide-eye" :label="$t('emailLibrary.log.viewEmail')" size="xs" color="neutral" variant="soft" @click="openPreview(detail, templateHtml)" />
            </div>
            <template v-if="detail.html">
              <pre v-if="showText" class="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-default bg-elevated p-3 text-xs">{{ detail.text }}</pre>
              <iframe v-else :srcdoc="detail.html" sandbox="" :title="$t('emailLibrary.log.sentEmail')" class="h-[28rem] w-full rounded-lg border border-default bg-white" />
            </template>
            <template v-else-if="templateHtml">
              <p class="text-xs text-muted">{{ $t('emailLibrary.log.templatePreviewNote') }}</p>
              <iframe :srcdoc="templateHtml" sandbox="" :title="$t('emailLibrary.log.sentEmail')" class="h-[28rem] w-full rounded-lg border border-default bg-white" />
            </template>
            <i18n-t v-else keypath="emailLibrary.log.noContent" tag="p" class="text-xs text-muted">
              <template #setting><span class="font-medium">{{ $t('emailLibrary.log.keepCopy') }}</span></template>
            </i18n-t>
          </section>

          <div class="flex flex-wrap gap-2 border-t border-default pt-4">
            <UButton v-if="detail.projectId && detail.status !== 'suppressed'" icon="i-lucide-mail-x" :label="$t('emailLibrary.log.stopEmailing')" size="sm" color="neutral" variant="outline" @click="suppress(detail)" />
            <UButton icon="i-lucide-clipboard" :label="$t('emailLibrary.log.copyEntryId')" size="sm" color="neutral" variant="ghost" @click="copy(detail.id, $t('emailLibrary.log.entryId'))" />
          </div>
        </div>
      </template>
    </USlideover>

    <UModal v-model:open="previewOpen" :title="preview?.subject || $t('nav.email')" :description="preview ? $t('emailLibrary.log.toLine', { to: preview.to, date: fullDate(preview.createdAt) }) : ''" :ui="{ content: 'max-w-4xl' }">
      <template #body>
        <p v-if="previewFromTemplate" class="mb-3 text-xs text-muted">{{ $t('emailLibrary.log.templatePreviewNote') }}</p>
        <iframe v-if="preview?.html" :srcdoc="preview.html" sandbox="" :title="$t('emailLibrary.log.sentEmail')" class="h-[75vh] w-full rounded-lg border border-default bg-white" />
        <USkeleton v-else class="h-[75vh] w-full rounded-lg" />
      </template>
    </UModal>
  </div>
</template>
