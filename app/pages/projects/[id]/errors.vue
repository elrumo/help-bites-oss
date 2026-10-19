<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" title="Errors" />
    <main class="min-h-0 flex-1 overflow-y-auto p-6">
      <div v-if="project" class="mx-auto max-w-4xl space-y-5">
        <EmptyState v-if="!project.errors?.connected" icon="i-lucide-bug" title="Error tracking isn't connected" description="Connect GlitchTip or Bugsink to turn new errors into inbox conversations.">
          <UButton label="Connect error tracking" @click="connectOpen = true" />
        </EmptyState>
        <template v-else>
          <div class="flex flex-wrap items-center gap-3">
            <USelect v-model="status" :items="statusItems" class="w-40" @update:model-value="load()" />
            <UInput v-model="search" icon="i-lucide-search" placeholder="Search errors" class="min-w-48 flex-1" @keyup.enter="load()" />
            <UButton color="neutral" variant="soft" icon="i-lucide-refresh-cw" aria-label="Refresh errors" @click="load()" />
            <UButton color="neutral" variant="soft" icon="i-lucide-plus" label="Connect another" @click="connectOpen = true" />
            <UButton color="neutral" variant="soft" icon="i-lucide-settings-2" label="Manage" aria-label="Manage tracker projects" @click="manageOpen = true" />
          </div>
          <div v-if="links.length > 1" class="flex flex-wrap gap-2" role="group" aria-label="Filter by tracker project">
            <UButton v-for="pill in [{ id: '', label: 'All' }, ...links]" :key="pill.id" size="xs" :color="linkFilter === pill.id ? 'primary' : 'neutral'" :variant="linkFilter === pill.id ? 'solid' : 'soft'" class="rounded-full" :aria-pressed="linkFilter === pill.id" :label="pill.label" @click="linkFilter = pill.id; load()" />
          </div>
          <UCollapsible v-if="alerts.length">
            <UButton color="neutral" variant="soft" size="sm" block class="justify-between" icon="i-lucide-webhook" trailing-icon="i-lucide-chevron-down" :label="`Send Bugsink alerts to the inbox${alerts.length > 1 ? ` (${alerts.length})` : ''}`" />
            <template #content>
              <div class="flex max-h-96 flex-col gap-3 overflow-y-auto pt-3">
                <UAlert v-for="item in alerts" :key="item.id" color="neutral" variant="subtle" icon="i-lucide-webhook" :title="links.length > 1 ? item.label : 'Alert webhook'" :description="`In Bugsink, open this project's alerts, click Add, set Kind to Slack and use this Webhook url: ${item.alertWebhookUrl}`" />
              </div>
            </template>
          </UCollapsible>
          <p v-if="error" class="text-sm text-error">{{ error }}</p>
          <div v-if="loading" class="overflow-hidden rounded-xl border border-default divide-y divide-default" aria-busy="true" aria-label="Loading errors">
            <div v-for="n in 3" :key="n" class="flex items-center gap-3 p-4">
              <USkeleton class="size-4 shrink-0 rounded" />
              <div class="min-w-0 flex-1 space-y-2"><USkeleton class="h-4 w-2/3" /><USkeleton class="h-3 w-1/3" /></div>
              <USkeleton class="h-6 w-20 shrink-0 rounded-full" />
            </div>
          </div>
          <div v-else class="overflow-hidden rounded-xl border border-default divide-y divide-default">
            <div v-for="issue in issues" :key="issue.id" class="flex items-center gap-3 p-4">
              <UIcon name="i-lucide-bug" :class="issue.level === 'error' || issue.level === 'fatal' ? 'text-error' : 'text-warning'" class="size-4 shrink-0" />
              <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-highlighted">{{ issue.title }}</p><p class="truncate text-xs text-muted">{{ issue.culprit || 'Unknown location' }} · {{ issue.count || 1 }} events</p></div>
              <UBadge v-if="links.length > 1" color="neutral" variant="subtle" size="sm" class="shrink-0 rounded-full">{{ issue.linkLabel }}</UBadge>
              <UButton v-if="issue.conversationId" :to="`/inbox?c=${issue.conversationId}`" color="neutral" variant="ghost" size="xs" label="Conversation" />
              <UButton :to="issue.url" target="_blank" color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-up-right" :aria-label="`Open in ${issue.providerName}`" />
              <UDropdownMenu :items="[menu(issue)]"><UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-ellipsis" aria-label="Change status" /></UDropdownMenu>
            </div>
            <p v-if="!issues.length" class="p-8 text-center text-sm text-muted">No errors found.</p>
          </div>
          <UButton v-if="next" color="neutral" variant="soft" label="Load more" @click="load(next)" />
        </template>
        <ConnectErrorTrackingModal v-model:open="connectOpen" :project-id="id" @connected="onConnected" />
        <ManageErrorProjectsModal v-model:open="manageOpen" :project-id="id" @changed="onManaged" />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { AdminProject } from '~~/server/utils/projects'

definePageMeta({ middleware: 'agent' })
const { api, projects, loadProjects } = useAgent()
const id = String(useRoute().params.id)
const project = computed(() => projects.value.find(item => item.id === id) || null)
const issues = ref<any[]>([])
const status = ref('unresolved')
const search = ref('')
const next = ref('')
const connectOpen = ref(false)
const manageOpen = ref(false)
const loading = ref(true)
const linkFilter = ref('')
const links = computed(() => project.value?.errorLinks || [])
const alerts = computed(() => links.value.filter(item => item.alertWebhookUrl && (!linkFilter.value || item.id === linkFilter.value)))
const error = ref('')
const statusItems = [{ label: 'Unresolved', value: 'unresolved' }, { label: 'Resolved', value: 'resolved' }, { label: 'Ignored', value: 'ignored' }]

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
    if (mine === latest) { error.value = cause.message || 'Could not load errors'; if (!cursor) issues.value = [] }
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
function menu(issue: any) { return [
  { label: 'Open', onSelect: () => update(issue, 'open') },
  { label: 'Resolve', onSelect: () => update(issue, 'resolved') },
  { label: 'Ignore', onSelect: () => update(issue, 'closed') }
] }
async function update(issue: any, value: string) { await api(`/admin/errors/${issue.id}`, { method: 'PUT', body: { project: id, status: value, link: issue.linkId } }); await load() }
onMounted(async () => { if (!projects.value.length) await loadProjects(); await load() })
</script>
