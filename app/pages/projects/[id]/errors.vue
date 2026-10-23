<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.errors')" />
    <main class="min-h-0 flex-1 overflow-y-auto p-6">
      <div v-if="project" class="mx-auto max-w-4xl space-y-5">
        <EmptyState v-if="!project.errors?.connected" icon="i-lucide-bug" :title="$t('projectPages.errors.notConnected')" :description="$t('projectPages.errors.notConnectedDescription')">
          <UButton :label="$t('projectPages.errors.connect')" @click="connectOpen = true" />
        </EmptyState>
        <template v-else>
          <div class="flex flex-wrap items-center gap-3">
            <USelect v-model="status" :items="statusItems" class="w-40" @update:model-value="load()" />
            <UInput v-model="search" icon="i-lucide-search" :placeholder="$t('projectPages.errors.searchPlaceholder')" class="min-w-48 flex-1" @keyup.enter="load()" />
            <UButton color="neutral" variant="soft" icon="i-lucide-refresh-cw" :aria-label="$t('projectPages.errors.refreshErrors')" @click="load()" />
            <UFieldGroup>
              <UButton color="primary" variant="soft" icon="i-lucide-wand-sparkles" :label="$t('projectPages.errors.analyze')" :loading="analyzing" @click="analyzeAll()" />
              <UDropdownMenu :items="analyzeMenu" :content="{ align: 'end' }">
                <UButton color="primary" variant="soft" icon="i-lucide-chevron-down" :aria-label="$t('projectPages.errors.analyzeOptions')" />
              </UDropdownMenu>
            </UFieldGroup>
            <UButton color="neutral" variant="soft" icon="i-lucide-plus" :label="$t('projectPages.errors.new')" @click="connectOpen = true" />
            <UButton color="neutral" variant="soft" icon="i-lucide-bell" :label="$t('projectPages.errors.alerts')" :aria-label="$t('projectPages.errors.alertsAria')" @click="alertsOpen = true" />
            <UButton color="neutral" variant="soft" icon="i-lucide-settings-2" :label="$t('projectPages.errors.manage')" :aria-label="$t('projectPages.errors.manageAria')" @click="manageOpen = true" />
          </div>
          <div v-if="links.length > 1" class="flex flex-wrap gap-2" role="group" :aria-label="$t('projectPages.errors.filterByTracker')">
            <UButton v-for="pill in [{ id: '', label: $t('projectPages.errors.all') }, ...links]" :key="pill.id" size="xs" :color="linkFilter === pill.id ? 'primary' : 'neutral'" :variant="linkFilter === pill.id ? 'solid' : 'soft'" class="rounded-full" :aria-pressed="linkFilter === pill.id" :label="pill.label" @click="linkFilter = pill.id; load()" />
          </div>
          <UCard v-if="overview || overviewError">
            <p v-if="overviewError" class="text-sm text-error">{{ overviewError }}</p>
            <UCollapsible v-else v-model:open="overviewOpen">
              <UButton color="neutral" variant="ghost" size="sm" block class="justify-between" icon="i-lucide-sparkles" trailing-icon="i-lucide-chevron-down" :label="overview!.at ? $t('projectPages.errors.aiOverviewFrom', { date: new Date(overview!.at).toLocaleString() }) : $t('projectPages.errors.aiOverview')" />
              <template #content>
                <div class="pt-3">
                  <MarkdownBlock :text="overview!.text" />
                  <div class="mt-2 flex items-center gap-2">
                    <p class="min-w-0 flex-1 text-xs text-muted">{{ $t('projectPages.errors.basedOn', overview!.count) }}<template v-if="overview!.files.length"> {{ $t('projectPages.errors.readCode', { files: overview!.files.join(', ') }) }}</template></p>
                    <UButton color="neutral" variant="ghost" size="xs" :icon="copied === 'overview' ? 'i-lucide-check' : 'i-lucide-copy'" :label="$t('projectPages.errors.copyReport')" @click="copy(overview!.text, 'overview')" />
                  </div>
                </div>
              </template>
            </UCollapsible>
          </UCard>
          <!-- <UCollapsible v-if="links.length">
            <UButton color="neutral" variant="soft" size="sm" block class="justify-between" icon="i-lucide-key-round" trailing-icon="i-lucide-chevron-down" :label="`DSN to send errors from your app${links.length > 1 ? ` (${links.length})` : ''}`" />
            <template #content>
              <div class="flex flex-col gap-3 pt-3">
                <div v-for="item in links" :key="item.id" class="space-y-1">
                  <p v-if="links.length > 1" class="text-xs font-medium text-muted">{{ item.label }}</p>
                  <div class="flex items-start gap-1">
                    <code class="inline-code min-w-0 flex-1 break-all">{{ item.dsn }}</code>
                    <UButton color="neutral" variant="ghost" size="xs" :icon="copied === item.id ? 'i-lucide-check' : 'i-lucide-copy'" aria-label="Copy DSN" @click="copy(item.dsn, item.id)" />
                  </div>
                </div>
                <p class="text-xs text-muted">Pass it to any Sentry SDK as <code class="inline-code">dsn</code>.</p>
              </div>
            </template>
          </UCollapsible> -->
          <UCollapsible v-if="alerts.length">
            <UButton color="neutral" variant="soft" size="sm" block class="justify-between" icon="i-lucide-webhook" trailing-icon="i-lucide-chevron-down" :label="alerts.length > 1 ? $t('projectPages.errors.alertRulesCount', { count: alerts.length }) : $t('projectPages.errors.alertRules')" />
            <template #content>
              <div class="flex max-h-96 flex-col gap-3 overflow-y-auto pt-3">
                <UAlert v-for="item in alerts" :key="item.id" color="neutral" variant="subtle" icon="i-lucide-webhook" :title="links.length > 1 ? item.label : $t('projectPages.errors.alertWebhook')" :description="$t('projectPages.errors.alertDescription', { url: item.alertWebhookUrl })" />
              </div>
            </template>
          </UCollapsible>
          <p v-if="error" class="text-sm text-error">{{ error }}</p>
          <div v-if="loading" class="overflow-hidden rounded-xl border border-default divide-y divide-default" aria-busy="true" :aria-label="$t('projectPages.errors.loadingAria')">
            <div v-for="n in 3" :key="n" class="flex items-center gap-3 p-4">
              <USkeleton class="size-4 shrink-0 rounded" />
              <div class="min-w-0 flex-1 space-y-2"><USkeleton class="h-4 w-2/3" /><USkeleton class="h-3 w-1/3" /></div>
              <USkeleton class="h-6 w-20 shrink-0 rounded-full" />
            </div>
          </div>
          <div v-else class="overflow-hidden rounded-xl border border-default divide-y divide-default">
            <ErrorIssueCard v-for="issue in issues" :key="`${issue.linkId}:${issue.id}`" :issue="issue" :show-link="links.length > 1" :analyzed="analysisKey(issue) in analyses" @open="selected = issue" @status="update(issue, $event)" />
            <p v-if="!issues.length" class="p-8 text-center text-sm text-muted">{{ $t('projectPages.errors.noErrors') }}</p>
          </div>
          <UButton v-if="next" color="neutral" variant="soft" :label="$t('projectPages.errors.loadMore')" @click="load(next)" />
        </template>
        <ErrorDrawer v-model:issue="selected" :project-id="id" :saved="selected ? analyses[analysisKey(selected)] : undefined" @analyzed="(issue, result) => analyses[analysisKey(issue)] = result" />
        <ErrorReportsModal v-model:open="reportsOpen" :project-id="id" @changed="onReportsChanged" />
        <ConnectErrorTrackingModal v-model:open="connectOpen" :project-id="id" @connected="onConnected" />
        <ErrorAlertsModal v-model:open="alertsOpen" :project-id="id" :links="links" />
        <ManageErrorProjectsModal v-model:open="manageOpen" :project-id="id" @changed="onManaged" />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { REPORT_FREQUENCIES, type ReportFrequency } from '#shared/errorReports'
import type { SavedAnalysis } from '~~/server/utils/errorAi'
import type { AdminProject } from '~~/server/utils/projects'

definePageMeta({ middleware: 'agent' })
const { api, projects, loadProjects } = useAgent()
const { t } = useI18n()
const id = String(useRoute().params.id)
const project = computed(() => projects.value.find(item => item.id === id) || null)
const issues = ref<any[]>([])
const status = ref('unresolved')
const search = ref('')
const next = ref('')
const connectOpen = ref(false)
const manageOpen = ref(false)
const alertsOpen = ref(false)
const reportsOpen = ref(false)
const loading = ref(true)
const linkFilter = ref('')
const links = computed(() => project.value?.errorLinks || [])
const alerts = computed(() => links.value.filter(item => item.alertWebhookUrl && (!linkFilter.value || item.id === linkFilter.value)))
const error = ref('')
const copied = ref('')
// Saved AI write-ups, keyed like the server does (`link:provider:issue`), plus `overview`.
const analyses = ref<Record<string, SavedAnalysis>>({})
const analysisKey = (issue: any) => `${issue.linkId}:${issue.provider}:${issue.id}`
const selected = ref<any | null>(null)
const overview = computed(() => analyses.value.overview || null)
const overviewOpen = ref(true)
const overviewError = ref('')
const analyzing = ref(false)
async function analyzeAll() {
  analyzing.value = true; overviewError.value = ''
  try { analyses.value = { ...analyses.value, overview: await api('/admin/errors/analyze', { method: 'POST', body: { project: id } }) }; overviewOpen.value = true } catch (cause: any) { overviewError.value = cause.message || t('projectPages.errors.analyzeError') } finally { analyzing.value = false }
}
const frequencies = computed(() => REPORT_FREQUENCIES.map(value => ({ value, label: t(`projectPages.errors.schedule.${value}`) })))
const frequency = ref<ReportFrequency>('off')
const analyzeMenu = computed(() => [
  [{ label: t('projectPages.errors.viewReports'), icon: 'i-lucide-history', onSelect: () => { reportsOpen.value = true } }],
  [{ label: t('projectPages.errors.scheduleLabel'), type: 'label' as const }, ...frequencies.value.map(item => ({ label: item.label, icon: frequency.value === item.value ? 'i-lucide-check' : 'i-lucide-calendar-clock', onSelect: () => setFrequency(item.value) }))]
])
async function setFrequency(value: ReportFrequency) {
  const before = frequency.value
  frequency.value = value
  try { await api('/admin/errors/schedule', { method: 'PUT', body: { project: id, frequency: value } }) } catch (cause: any) { frequency.value = before; overviewError.value = cause.message || t('projectPages.errors.scheduleError') }
}
// Deleting the newest report makes the next one the overview, or none.
function onReportsChanged(latest: SavedAnalysis | null) {
  const { overview: _gone, ...rest } = analyses.value
  analyses.value = latest ? { ...rest, overview: latest } : rest
}
async function copy(text: string, key: string) {
  try { await navigator.clipboard.writeText(text); copied.value = key; setTimeout(() => { if (copied.value === key) copied.value = '' }, 1500) } catch {}
}
const statusItems = computed(() => [{ label: t('projectPages.errors.unresolved'), value: 'unresolved' }, { label: t('projectPages.errors.resolved'), value: 'resolved' }, { label: t('projectPages.errors.ignored'), value: 'ignored' }])

// Answers can arrive out of order when pills are clicked quickly; only the latest one counts.
let latest = 0
async function load(cursor = '') {
  if (!project.value?.errors?.connected) { loading.value = false; return }
  const mine = ++latest
  error.value = ''
  if (!cursor) loading.value = true
  try {
    const result = await api<{ issues: any[], next: string }>('/admin/errors', { query: { project: id, status: status.value, q: search.value, cursor, link: linkFilter.value } })
    if (mine !== latest) return
    issues.value = cursor ? [...issues.value, ...result.issues] : result.issues
    next.value = result.next
  } catch (cause: any) {
    if (mine === latest) { error.value = cause.message || t('projectPages.errors.loadError'); if (!cursor) issues.value = [] }
  } finally { if (mine === latest) loading.value = false }
}
async function onManaged(changed: AdminProject) {
  if (linkFilter.value && !changed.errorLinks.some(item => item.id === linkFilter.value)) linkFilter.value = ''
  if (!changed.errors.connected) return
  await load()
}
async function onConnected(connected: AdminProject) {
  projects.value = projects.value.map(item => item.id === id ? connected : item)
  await load()
}
async function update(issue: any, value: string) { await api(`/admin/errors/${issue.id}`, { method: 'PUT', body: { project: id, status: value, link: issue.linkId } }); await load() }
onMounted(async () => {
  if (!projects.value.length) await loadProjects()
  api<Record<string, SavedAnalysis>>('/admin/errors/analyses', { query: { project: id } }).then((saved) => { analyses.value = saved }).catch(() => {})
  api<{ frequency: ReportFrequency }>('/admin/errors/schedule', { query: { project: id } }).then((saved) => { frequency.value = saved.frequency }).catch(() => {})
  await load()
})
</script>
