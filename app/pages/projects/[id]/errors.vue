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
          </div>
          <UAlert v-if="project.errors.alertWebhookUrl" color="neutral" variant="subtle" icon="i-lucide-webhook" title="Send Bugsink alerts to the inbox" :description="`In Bugsink, open this project's alerts, click Add, set Kind to Custom and use this Webhook url: ${project.errors.alertWebhookUrl}`" />
          <p v-if="error" class="text-sm text-error">{{ error }}</p>
          <div class="overflow-hidden rounded-xl border border-default divide-y divide-default">
            <div v-for="issue in issues" :key="issue.id" class="flex items-center gap-3 p-4">
              <UIcon name="i-lucide-bug" :class="issue.level === 'error' || issue.level === 'fatal' ? 'text-error' : 'text-warning'" class="size-4 shrink-0" />
              <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium text-highlighted">{{ issue.title }}</p><p class="truncate text-xs text-muted">{{ issue.culprit || 'Unknown location' }} · {{ issue.count || 1 }} events</p></div>
              <UButton v-if="issue.conversationId" :to="`/inbox?c=${issue.conversationId}`" color="neutral" variant="ghost" size="xs" label="Conversation" />
              <UButton :to="issue.url" target="_blank" color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-up-right" :aria-label="`Open in ${project.errors.providerName}`" />
              <UDropdownMenu :items="[menu(issue)]"><UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-ellipsis" aria-label="Change status" /></UDropdownMenu>
            </div>
            <p v-if="!issues.length" class="p-8 text-center text-sm text-muted">No errors found.</p>
          </div>
          <UButton v-if="next" color="neutral" variant="soft" label="Load more" @click="load(next)" />
        </template>
        <ConnectErrorTrackingModal v-model:open="connectOpen" :project-id="id" @connected="onConnected" />
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
const error = ref('')
const statusItems = [{ label: 'Unresolved', value: 'unresolved' }, { label: 'Resolved', value: 'resolved' }, { label: 'Ignored', value: 'ignored' }]

async function load(cursor = '') {
  if (!project.value?.errors?.connected) return
  error.value = ''
  try {
    const result = await api<{ issues: any[], next: string }>('/admin/errors', { query: { project: id, status: status.value, q: search.value, cursor } })
    issues.value = cursor ? [...issues.value, ...result.issues] : result.issues
    next.value = result.next
  } catch (cause: any) { error.value = cause.message || 'Could not load errors' }
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
async function update(issue: any, value: string) { await api(`/admin/errors/${issue.id}`, { method: 'PUT', body: { project: id, status: value } }); await load() }
onMounted(async () => { if (!projects.value.length) await loadProjects(); await load() })
</script>
