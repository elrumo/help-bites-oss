<script setup lang="ts">
/**
 * One campaign: what it sends (a template, an optional subject), to whom (a
 * segment, a topic), when — and, once it goes, how it did. The preview is the
 * send API's own render, with the first matching contact's values.
 */
import { watchDebounced } from '@vueuse/core'
import type { Campaign } from '#shared/marketing'
import type { ContactSegment } from '#shared/segments'
import type { EmailTemplate } from '~~/server/utils/emails'
import CampaignsTabs from '~/components/campaigns/CampaignsTabs.vue'
import { CAMPAIGN_STATUS, percent } from '~/utils/campaignStatus'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const { api, agent, projects, loadProjects } = useAgent()
const toast = useToast()
const { t } = useI18n()

const projectId = computed(() => String(route.params.id))
const id = computed(() => String(route.params.campaignId))
const project = computed(() => projects.value.find(p => p.id === projectId.value) || null)

const campaign = ref<Campaign | null>(null)
const audienceCount = ref<number | null>(null)
const problems = ref<string[]>([])
const templates = ref<EmailTemplate[]>([])
const segments = ref<ContactSegment[]>([])
const preview = ref('')
const busy = ref(false)

const form = reactive({ name: '', template: '', subject: '', segment: '', topic: '', testMode: false })
const editable = computed(() => campaign.value?.status === 'draft' || campaign.value?.status === 'scheduled')
const started = computed(() => Boolean(campaign.value?.startedAt))

async function load() {
  const res = await api<{ campaign: Campaign, audienceCount: number | null, problems: string[] }>(`/campaigns/${id.value}`, { query: { project: projectId.value } })
  campaign.value = res.campaign
  audienceCount.value = res.audienceCount
  problems.value = res.problems
  Object.assign(form, { name: res.campaign.name, template: res.campaign.template, subject: res.campaign.subject, segment: res.campaign.audience.segment, topic: res.campaign.audience.topic, testMode: res.campaign.testMode })
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
  if (!project.value) loadProjects().catch(() => {})
  try {
    await load()
    api<{ templates: EmailTemplate[] }>('/admin/emails', { query: { project: projectId.value } }).then(r => { templates.value = r.templates }).catch(() => {})
    api<{ segments: ContactSegment[] }>('/segments', { query: { project: projectId.value } }).then(r => { segments.value = r.segments }).catch(() => {})
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.campaign.loadError'), color: 'error' })
  }
  // Numbers move while it sends, and for days after as opens come in.
  timer = setInterval(() => { if (campaign.value?.status === 'sending' || campaign.value?.status === 'scheduled') load().catch(() => {}) }, 5000)
})
onBeforeUnmount(() => clearInterval(timer))

async function save(extra: Record<string, unknown> = {}) {
  busy.value = true
  try {
    const body = editable.value
      ? { project: projectId.value, name: form.name, template: form.template, subject: form.subject, audience: { segment: form.segment, topic: form.topic }, testMode: form.testMode, ...extra }
      : { project: projectId.value, ...extra }
    await api(`/campaigns/${id.value}`, { method: 'PATCH', body })
    await load()
    return true
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.campaign.saveError'), color: 'error' })
    return false
  } finally {
    busy.value = false
  }
}
// Autosave: only what the operator changed, not what a reload put back.
watchDebounced(() => [form.name, form.template, form.subject, form.segment, form.topic, form.testMode], () => {
  const c = campaign.value
  if (!c || !editable.value) return
  const same = form.name === c.name && form.template === c.template && form.subject === c.subject && form.segment === c.audience.segment && form.topic === c.audience.topic && form.testMode === c.testMode
  if (!same) save()
}, { debounce: 800 })

async function renderPreview() {
  if (!form.template) { preview.value = ''; return }
  try {
    const res = await api<{ html: string }>('/emails/render', { method: 'POST', body: { project: projectId.value, template: form.template, subject: form.subject || undefined, variables: { unsubscribeUrl: '#', preferencesUrl: '#' } } })
    preview.value = res.html
  } catch {
    preview.value = ''
  }
}
watchDebounced(() => [form.template, form.subject], renderPreview, { debounce: 400, immediate: true })

const scheduleOpen = ref(false)
const scheduleAt = ref('')
async function schedule() {
  if (await save({ status: 'scheduled', scheduledAt: new Date(scheduleAt.value).toISOString() })) scheduleOpen.value = false
}
async function sendNow() {
  const audience = audienceCount.value?.toLocaleString() ?? t('projectTools.campaign.everyone')
  if (!window.confirm(t('projectTools.campaign.sendConfirm', { name: form.name, audience, note: form.testMode ? t('projectTools.campaign.testModeNote') : '' }))) return
  await save({ status: 'sending' })
}
const move = (status: string) => save({ status })

const testOpen = ref(false)
const testTo = ref('')
async function sendTest() {
  busy.value = true
  try {
    const res = await api<{ sent: number, failed: string[] }>(`/campaigns/${id.value}/test`, { method: 'POST', body: { project: projectId.value, to: testTo.value.split(/[\s,]+/).filter(Boolean) } })
    toast.add({ title: res.failed.length ? t('projectTools.campaign.failedFor', { list: res.failed.join(', ') }) : t('projectTools.campaign.testSent', { sent: res.sent }), color: res.failed.length ? 'error' : 'success' })
    testOpen.value = false
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.campaign.testError'), color: 'error' })
  } finally {
    busy.value = false
  }
}
function openTest() {
  testTo.value ||= agent.value?.email || ''
  testOpen.value = true
}

async function remove() {
  if (!window.confirm(t('projectTools.campaign.deleteConfirm'))) return
  try {
    await api(`/campaigns/${id.value}`, { method: 'DELETE', query: { project: projectId.value } })
    await navigateTo(`/projects/${projectId.value}/campaigns`)
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.campaign.deleteError'), color: 'error' })
  }
}

const templateItems = computed(() => templates.value.map(t => ({ label: t.master?.name || t.name, value: t.key || t.id })))
const segmentItems = computed(() => segments.value.map(s => ({ label: s.name, value: s.id })))
const topicItems = computed(() => (project.value?.marketing.topics || []).map(t => ({ label: t.name, value: t.key })))
const stat = computed(() => campaign.value?.stats)
const tiles = computed(() => stat.value
  ? [
      { label: t('projectTools.campaign.audience'), value: stat.value.audience.toLocaleString() },
      { label: t('projectTools.campaign.statSent'), value: stat.value.sent.toLocaleString() },
      { label: t('projectTools.campaign.statDelivered'), value: percent(stat.value.delivered, stat.value.sent) },
      { label: t('projectTools.campaign.statOpened'), value: percent(stat.value.opened, stat.value.delivered || stat.value.sent) },
      { label: t('projectTools.campaign.statClicked'), value: percent(stat.value.clicked, stat.value.delivered || stat.value.sent) },
      { label: t('projectTools.campaign.statUnsubscribed'), value: stat.value.unsubscribed.toLocaleString() },
      { label: t('projectTools.campaign.statBounced'), value: stat.value.bounced.toLocaleString() },
      { label: t('projectTools.campaign.statSkipped'), value: (stat.value.suppressed + stat.value.failed).toLocaleString() }
    ]
  : [])
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="projectId" :title="campaign?.name || $t('projectTools.campaign.fallbackTitle')" :crumbs="[{ label: $t('sections.campaigns'), to: `/projects/${projectId}/campaigns` }]">
      <template #title><CampaignsTabs current="campaigns" /></template>
      <template v-if="campaign" #actions>
        <UBadge :icon="CAMPAIGN_STATUS[campaign.status].icon" :label="CAMPAIGN_STATUS[campaign.status].label" :color="CAMPAIGN_STATUS[campaign.status].color" variant="subtle" />
        <UButton v-if="editable || campaign.status === 'paused'" icon="i-lucide-flask-conical" :label="$t('projectTools.campaign.test')" size="sm" color="neutral" variant="outline" :disabled="!form.template" @click="openTest" />
        <template v-if="editable">
          <UButton v-if="campaign.status === 'scheduled'" :label="$t('projectTools.campaign.unschedule')" size="sm" color="neutral" variant="ghost" :loading="busy" @click="move('draft')" />
          <UButton v-else icon="i-lucide-calendar-clock" :label="$t('projectTools.campaign.schedule')" size="sm" color="neutral" variant="outline" :disabled="problems.length > 0" @click="scheduleOpen = true" />
          <UButton icon="i-lucide-send" :label="$t('projectTools.campaign.sendNow')" size="sm" :loading="busy" :disabled="problems.length > 0" @click="sendNow" />
        </template>
        <UButton v-else-if="campaign.status === 'sending'" icon="i-lucide-pause" :label="$t('projectTools.campaign.pause')" size="sm" color="neutral" variant="outline" :loading="busy" @click="move('paused')" />
        <UButton v-else-if="campaign.status === 'paused'" icon="i-lucide-play" :label="$t('projectTools.campaign.resume')" size="sm" :loading="busy" @click="move('sending')" />
        <UDropdownMenu :items="[[...(campaign.status === 'sending' || campaign.status === 'paused' || campaign.status === 'scheduled' ? [{ label: $t('projectTools.campaign.cancelCampaign'), icon: 'i-lucide-x', onSelect: () => move('canceled') }] : []), ...(campaign.status !== 'sending' ? [{ label: $t('projectTools.shared.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: remove }] : [])]]">
          <UButton icon="i-lucide-ellipsis" size="sm" color="neutral" variant="ghost" square :aria-label="$t('projectTools.shared.more')" />
        </UDropdownMenu>
      </template>
    </PageHeader>

    <div v-if="!campaign" class="space-y-2 p-6"><USkeleton v-for="i in 5" :key="i" class="h-10" /></div>
    <div v-else class="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,26rem)_1fr] lg:overflow-hidden">
      <div class="space-y-6 border-default p-6 text-[13px] lg:overflow-y-auto lg:border-r">
        <UAlert v-if="campaign.lastError" icon="i-lucide-triangle-alert" color="error" variant="soft" :description="campaign.lastError" />
        <UAlert v-if="editable && problems.length" icon="i-lucide-shield-alert" color="warning" variant="soft" :title="$t('projectTools.campaign.beforeItCanGo')">
          <template #description><ul class="list-disc space-y-1 pl-4"><li v-for="p in problems" :key="p">{{ p }}</li></ul></template>
        </UAlert>
        <p v-if="campaign.status === 'scheduled' && campaign.scheduledAt" class="text-muted">{{ $t('projectTools.campaign.goesOut', { date: new Date(campaign.scheduledAt).toLocaleString() }) }}</p>

        <section v-if="started" class="space-y-3">
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div v-for="t in tiles" :key="t.label" class="rounded-lg border border-default p-3">
              <div class="text-lg font-semibold tabular-nums text-highlighted">{{ t.value }}</div>
              <div class="text-xs text-muted">{{ t.label }}</div>
            </div>
          </div>
          <UProgress v-if="campaign.status === 'sending'" :model-value="stat!.sent + stat!.suppressed + stat!.failed" :max="Math.max(stat!.audience, 1)" />
          <UButton icon="i-lucide-list" :label="$t('projectTools.campaign.seeEveryRecipient')" size="sm" color="neutral" variant="outline" :to="`/projects/${projectId}/email?view=log&batch=cm_${campaign.id}`" />
        </section>

        <fieldset :disabled="!editable" class="space-y-4">
          <UFormField :label="$t('common.name')"><UInput v-model="form.name" class="w-full" /></UFormField>
          <UFormField :label="$t('projectTools.campaign.template')" :hint="$t('projectTools.campaign.templateHint')">
            <USelect v-model="form.template" :items="templateItems" value-key="value" :placeholder="$t('projectTools.campaign.pickTemplate')" class="w-full" />
          </UFormField>
          <UFormField :label="$t('projectTools.campaign.subject')" :hint="$t('projectTools.campaign.subjectHint')">
            <UInput v-model="form.subject" :placeholder="$t('projectTools.campaign.subjectPlaceholder', { firstName: '{{firstName}}' })" class="w-full" />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('projectTools.campaign.audience')"><OptionalSelect v-model="form.segment" :items="segmentItems" :none-label="$t('projectTools.campaign.allSubscribers')" class="w-full" /></UFormField>
            <UFormField :label="$t('projectTools.campaign.topic')"><OptionalSelect v-model="form.topic" :items="topicItems" :none-label="$t('projectTools.campaign.anyTopic')" class="w-full" :disabled="!project?.marketing.topics.length" /></UFormField>
          </div>
          <p v-if="audienceCount !== null" class="text-muted"><span class="font-medium text-highlighted">{{ audienceCount.toLocaleString() }}</span> {{ $t('projectTools.campaign.wouldGetIt', audienceCount) }}</p>
          <UCheckbox v-model="form.testMode" :label="$t('projectTools.campaign.testMode')" :description="$t('projectTools.campaign.testModeDescription')" />
        </fieldset>
      </div>

      <div class="min-h-[28rem] bg-elevated/40 p-4 lg:overflow-y-auto">
        <iframe v-if="preview" :srcdoc="preview" sandbox="" :title="$t('projectTools.campaign.previewTitle')" class="h-full min-h-[40rem] w-full rounded-lg border border-default bg-white" />
        <EmptyState v-else-if="!form.template" icon="i-lucide-mail" :title="$t('projectTools.campaign.pickTemplate')" :description="$t('projectTools.campaign.pickTemplateDescription')" />
        <EmptyState v-else icon="i-lucide-eye-off" :title="$t('projectTools.campaign.noPreview')" :description="$t('projectTools.campaign.noPreviewDescription')" />
      </div>
    </div>

    <UModal v-model:open="scheduleOpen" :title="$t('projectTools.campaign.schedule')" :description="$t('projectTools.campaign.scheduleDescription')">
      <template #body>
        <form class="space-y-4" @submit.prevent="schedule">
          <UInput v-model="scheduleAt" type="datetime-local" class="w-full" required />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="scheduleOpen = false">{{ $t('common.cancel') }}</UButton>
            <UButton type="submit" :loading="busy" :disabled="!scheduleAt">{{ $t('projectTools.campaign.schedule') }}</UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="testOpen" :title="$t('projectTools.campaign.sendTestTitle')" :description="$t('projectTools.campaign.sendTestDescription')">
      <template #body>
        <form class="space-y-4" @submit.prevent="sendTest">
          <UInput v-model="testTo" placeholder="you@example.com" class="w-full" autofocus />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="testOpen = false">{{ $t('common.cancel') }}</UButton>
            <UButton type="submit" :loading="busy" :disabled="!testTo.trim()">{{ $t('projectTools.campaign.sendTestButton') }}</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
