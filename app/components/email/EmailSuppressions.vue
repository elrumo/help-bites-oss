<script setup lang="ts">
/**
 * Addresses a project no longer mails: hard bounces and spam reports (from
 * Mailgun's webhook), unsubscribes, and addresses added here or through the
 * API. Sends skip them unless the call passes `ignoreSuppressions`. Removing
 * one mails it again.
 */
import { watchDebounced } from '@vueuse/core'
import type { EmailSuppression } from '~~/server/utils/emailLogs'
import type { AdminProject } from '~~/server/utils/projects'
import EmailTabs from '~/components/email/EmailTabs.vue'
import { EMAIL_SUPPRESSION_REASON_LABELS, logTime } from '~/utils/emailStatus'

const props = defineProps<{ project?: AdminProject | null }>()

const { api, projects, loadProjects } = useAgent()
const toast = useToast()
const { t } = useI18n()

const rows = ref<EmailSuppression[]>([])
const nextBefore = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const search = ref('')
const reason = ref('all')

const reasonItems = computed(() => [{ label: t('emailLibrary.suppressions.anyReason'), value: 'all' }, ...Object.entries(EMAIL_SUPPRESSION_REASON_LABELS).map(([value, label]) => ({ label, value }))])
const reasonColor = (r: string) => (r === 'bounce' || r === 'complaint' ? 'error' : r === 'unsubscribe' ? 'warning' : 'neutral') as 'error' | 'warning' | 'neutral'
const projectName = (id: string | null) => projects.value.find(p => p.id === id)?.name || t('emailLibrary.common.project')

const query = computed(() => ({ project: props.project?.id || undefined, q: search.value.trim() || undefined, reason: reason.value === 'all' ? undefined : reason.value }))

async function load() {
  try {
    const res = await api<{ suppressions: EmailSuppression[], nextBefore: string | null }>('/admin/email-suppressions', { query: query.value })
    rows.value = res.suppressions
    nextBefore.value = res.nextBefore
  } catch (e: any) {
    toast.add({ title: e?.message || t('emailLibrary.suppressions.loadError'), color: 'error' })
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loadingMore.value = true
  try {
    const res = await api<{ suppressions: EmailSuppression[], nextBefore: string | null }>('/admin/email-suppressions', { query: { ...query.value, before: nextBefore.value } })
    rows.value.push(...res.suppressions)
    nextBefore.value = res.nextBefore
  } finally {
    loadingMore.value = false
  }
}

onMounted(() => {
  load()
  if (!projects.value.length) loadProjects().catch(() => {})
})
watchDebounced(query, load, { debounce: 300, deep: true })

async function remove(row: EmailSuppression) {
  const confirmText = props.project ? t('emailLibrary.suppressions.confirmAgain', { email: row.email }) : t('emailLibrary.suppressions.confirmAgainFrom', { email: row.email, project: projectName(row.projectId) })
  if (!window.confirm(confirmText)) return
  try {
    await api(`/admin/email-suppressions/${row.id}`, { method: 'DELETE' })
    rows.value = rows.value.filter(r => r.id !== row.id)
  } catch (e: any) {
    toast.add({ title: e?.message || t('emailLibrary.suppressions.removeError'), color: 'error' })
  }
}

// ---- adding --------------------------------------------------------------------------
const addOpen = ref(false)
const adding = ref(false)
const form = reactive({ project: '', emails: '', reason: 'manual', detail: '' })
const projectItems = computed(() => projects.value.map(p => ({ label: p.name, value: p.id })))
const addReasonItems = computed(() => Object.entries(EMAIL_SUPPRESSION_REASON_LABELS).map(([value, label]) => ({ label, value })))

function openAdd() {
  form.project = props.project?.id || projects.value[0]?.id || ''
  form.emails = ''
  form.reason = 'manual'
  form.detail = ''
  addOpen.value = true
}

async function add() {
  adding.value = true
  try {
    const res = await api<{ added: EmailSuppression[], existing: number }>('/admin/email-suppressions', { method: 'POST', body: { ...form } })
    toast.add({ title: res.existing ? t('emailLibrary.suppressions.addedExisting', { added: res.added.length, existing: res.existing }) : t('emailLibrary.suppressions.added', { added: res.added.length }), color: 'success' })
    addOpen.value = false
    await load()
  } catch (e: any) {
    toast.add({ title: e?.message || t('emailLibrary.suppressions.addError'), color: 'error' })
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project?.id" :title="$t('nav.email')">
      <template #title><EmailTabs current="suppressions" :masters="!project" /></template>
      <template #actions>
        <UInput v-model="search" icon="i-lucide-search" :placeholder="$t('emailLibrary.suppressions.address')" size="sm" class="hidden w-44 sm:block" :aria-label="$t('emailLibrary.suppressions.filterByAddress')" />
        <USelect v-model="reason" :items="reasonItems" value-key="value" size="sm" class="hidden w-36 md:flex" :aria-label="$t('emailLibrary.suppressions.reason')" />
        <UButton icon="i-lucide-plus" :label="$t('emailLibrary.common.add')" size="sm" @click="openAdd" />
      </template>
    </PageHeader>
    <p class="shrink-0 border-b border-default px-6 py-2.5 text-[13px] text-muted">
      {{ $t('emailLibrary.suppressions.intro') }}
    </p>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="space-y-1 p-4"><USkeleton v-for="i in 6" :key="i" class="h-11" /></div>
      <EmptyState v-else-if="!rows.length" icon="i-lucide-mail-check" :title="query.q || query.reason ? $t('emailLibrary.suppressions.noMatch') : $t('emailLibrary.suppressions.emptyTitle')" :description="query.q || query.reason ? $t('emailLibrary.suppressions.noMatchDescription') : $t('emailLibrary.suppressions.emptyDescription')" />
      <ul v-else class="py-2" :aria-label="$t('emailLibrary.suppressions.listLabel')">
        <li v-for="row in rows" :key="row.id" class="group mx-2 flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] hover:bg-elevated">
          <UBadge :label="EMAIL_SUPPRESSION_REASON_LABELS[row.reason] || row.reason" :color="reasonColor(row.reason)" variant="subtle" size="sm" class="w-28 shrink-0 justify-center" />
          <span class="w-56 shrink-0 truncate font-medium text-highlighted" :title="row.email">{{ row.email }}</span>
          <span class="min-w-0 flex-1 truncate text-muted">{{ row.detail }}</span>
          <span v-if="!project" class="hidden w-32 shrink-0 truncate text-xs text-muted lg:block">{{ projectName(row.projectId) }}</span>
          <span class="hidden w-16 shrink-0 text-xs text-muted md:block">{{ row.source === 'webhook' ? 'Mailgun' : row.source === 'api' ? 'API' : $t('emailLibrary.suppressions.sourcePanel') }}</span>
          <span class="w-14 shrink-0 text-right text-xs text-muted">{{ logTime(row.createdAt) }}</span>
          <UTooltip :text="$t('emailLibrary.suppressions.emailItAgain')"><UButton icon="i-lucide-undo-2" size="xs" color="neutral" variant="ghost" square class="text-muted opacity-60 group-hover:opacity-100" :aria-label="$t('emailLibrary.suppressions.emailAgain', { email: row.email })" @click="remove(row)" /></UTooltip>
        </li>
      </ul>
      <div v-if="nextBefore && !loading" class="flex justify-center pb-6">
        <UButton :label="$t('emailLibrary.common.loadMore')" color="neutral" variant="outline" size="sm" :loading="loadingMore" @click="loadMore" />
      </div>
    </div>

    <UModal v-model:open="addOpen" :title="$t('emailLibrary.suppressions.addTitle')" :description="$t('emailLibrary.suppressions.addDescription')">
      <template #body>
        <form class="space-y-4" @submit.prevent="add">
          <UFormField v-if="!project" :label="$t('emailLibrary.common.project')"><USelect v-model="form.project" :items="projectItems" value-key="value" class="w-full" /></UFormField>
          <UFormField :label="$t('emailLibrary.suppressions.addresses')" :hint="$t('emailLibrary.suppressions.addressesHint')">
            <UTextarea v-model="form.emails" :rows="4" autoresize class="w-full font-mono text-xs" placeholder="someone@example.com" required />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="$t('emailLibrary.suppressions.reason')"><USelect v-model="form.reason" :items="addReasonItems" value-key="value" class="w-full" /></UFormField>
            <UFormField :label="$t('emailLibrary.suppressions.note')"><UInput v-model="form.detail" :placeholder="$t('emailLibrary.suppressions.optional')" class="w-full" /></UFormField>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="addOpen = false">{{ $t('common.cancel') }}</UButton>
            <UButton type="submit" :loading="adding" :disabled="!form.emails.trim() || !form.project">{{ $t('emailLibrary.common.add') }}</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
