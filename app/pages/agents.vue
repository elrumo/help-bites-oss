<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader title="Team">
      <template #actions>
        <UButton icon="i-lucide-user-plus" label="Add teammate" color="neutral" variant="outline" size="sm" @click="showTeammate = true" />
        <UButton icon="i-lucide-bot" label="New AI agent" size="sm" :disabled="!projects.length" @click="showAssistant = true" />
      </template>
    </PageHeader>
    <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-default px-4 py-2.5" role="tablist" aria-label="Agent type">
      <button v-for="item in tabs" :key="item.key" type="button" role="tab" :aria-selected="tab === item.key" class="chip h-6 px-2.5 text-xs" :class="tab === item.key ? 'chip-active' : ''" @click="tab = item.key">{{ item.label }}<span class="tabular-nums text-dimmed">{{ item.count }}</span></button>
      <UInput v-model="query" icon="i-lucide-search" size="sm" class="ml-auto w-52" placeholder="Search" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-5xl space-y-7 px-4 py-6 sm:px-8">
        <div v-if="loading" class="space-y-3"><USkeleton v-for="i in 5" :key="i" class="h-16 rounded-xl" /></div>
        <EmptyState v-else-if="!visibleRows.length" icon="i-lucide-users-round" title="No matching agents" description="Try a different filter, or add a teammate or AI agent." />
        <div v-else class="overflow-hidden rounded-xl border border-default">
          <div v-for="row in visibleRows" :key="`${row.kind}-${row.id}`" class="flex min-h-14 items-center gap-3 border-b border-default px-4 last:border-b-0">
            <span class="grid size-7 shrink-0 place-items-center rounded-full" :class="row.kind === 'ai' ? 'bg-primary/10 text-primary' : 'bg-elevated text-toned'"><UIcon v-if="row.kind === 'ai'" name="i-lucide-bot" class="size-4" /><span v-else class="text-[11px] font-semibold">{{ row.initials }}</span></span>
            <div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><NuxtLink v-if="row.kind === 'ai'" :to="`/assistants/${row.id}`" class="truncate font-semibold text-highlighted hover:text-primary">{{ row.name }}</NuxtLink><p v-else class="truncate font-semibold text-highlighted">{{ row.name }}</p><UBadge size="xs" :color="row.kind === 'ai' ? 'primary' : 'neutral'" variant="subtle">{{ row.kind === 'ai' ? 'AI agent' : 'Teammate' }}</UBadge><span v-if="row.isMe" class="text-xs text-muted">You</span></div><p class="mt-0.5 truncate text-sm text-muted">{{ row.detail }}</p></div>
            <div class="hidden text-right text-xs text-muted sm:block"><p>{{ row.project }}</p><p class="mt-1 capitalize">{{ row.status }}</p></div>
            <UButton v-if="row.kind === 'ai'" :to="`/assistants/${row.id}`" icon="i-lucide-arrow-up-right" color="neutral" variant="ghost" square aria-label="Configure AI agent" />
            <UButton v-else-if="!row.isMe" icon="i-lucide-trash-2" color="error" variant="ghost" square aria-label="Remove teammate" @click="removeTeammate(row)" />
          </div>
        </div>
      </div>
    </div>

    <UModal v-model:open="showTeammate" title="Add teammate" description="Create a teammate account for someone who will work in the support inbox.">
      <template #body><form class="space-y-4" @submit.prevent="createTeammate"><div class="grid gap-4 sm:grid-cols-2"><UFormField label="Name"><UInput v-model="teammateForm.name" class="w-full" /></UFormField><UFormField label="Email" hint="Optional"><UInput v-model="teammateForm.email" type="email" class="w-full" /></UFormField><UFormField label="Username"><UInput v-model="teammateForm.username" class="w-full" required autocomplete="off" /></UFormField><UFormField label="Password" hint="At least 8 characters"><UInput v-model="teammateForm.password" type="password" class="w-full" required minlength="8" autocomplete="new-password" /></UFormField></div><p v-if="error" class="text-sm text-error">{{ error }}</p><div class="flex justify-end gap-2"><UButton color="neutral" variant="ghost" @click="showTeammate = false">Cancel</UButton><UButton type="submit" :loading="saving">Add teammate</UButton></div></form></template>
    </UModal>

    <UModal v-model:open="showAssistant" title="New AI agent" description="Start with a focused project and configure its knowledge access afterwards.">
      <template #body><form class="space-y-4" @submit.prevent="createAssistant"><UFormField label="Project"><USelect v-model="assistantForm.projectId" :items="assistantProjectItems" class="w-full" /></UFormField><UFormField label="Name"><UInput v-model="assistantForm.name" class="w-full" required /></UFormField><UFormField label="Description" hint="Optional"><UTextarea v-model="assistantForm.description" class="w-full" :rows="3" /></UFormField><p v-if="error" class="text-sm text-error">{{ error }}</p><div class="flex justify-end gap-2"><UButton color="neutral" variant="ghost" @click="showAssistant = false">Cancel</UButton><UButton type="submit" :loading="saving">Create AI agent</UButton></div></form></template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { SupportAgent } from '~~/server/utils/supportAgents'

definePageMeta({ middleware: 'agent' })
type HumanAgent = { id: string, username: string, email: string, name: string }
type Tab = 'all' | 'human' | 'ai'
type Row = { id: string, kind: 'human' | 'ai', name: string, detail: string, project: string, status: string, initials: string, isMe?: boolean }

const { api, agent: me, projects, loadProjects } = useAgent()
const tab = ref<Tab>('all')
const query = ref('')
const humanAgents = ref<HumanAgent[]>([])
const aiAgents = ref<SupportAgent[]>([])
const loading = ref(true)
const showTeammate = ref(false)
const showAssistant = ref(false)
const saving = ref(false)
const error = ref('')
const teammateForm = reactive({ name: '', email: '', username: '', password: '' })
const assistantForm = reactive({ projectId: '', name: '', description: '' })

const projectsById = computed(() => Object.fromEntries(projects.value.map(project => [project.id, project])))
const allRows = computed<Row[]>(() => [
  ...humanAgents.value.map(agent => ({ id: agent.id, kind: 'human' as const, name: agent.name || agent.username, detail: [agent.username, agent.email].filter(Boolean).join(' · '), project: 'All projects', status: 'active', initials: (agent.name || agent.username || '?').slice(0, 2).toUpperCase(), isMe: agent.id === me.value?.id })),
  ...aiAgents.value.map(agent => ({ id: agent.id, kind: 'ai' as const, name: agent.name, detail: agent.description || agent.model || 'No description', project: projectsById.value[agent.projectId]?.name || 'No project', status: agent.status, initials: 'AI' }))
])
const tabs = computed(() => [{ key: 'all' as const, label: 'All', count: allRows.value.length }, { key: 'human' as const, label: 'People', count: humanAgents.value.length }, { key: 'ai' as const, label: 'AI', count: aiAgents.value.length }])
const visibleRows = computed(() => allRows.value.filter(row => (tab.value === 'all' || row.kind === tab.value) && `${row.name} ${row.detail} ${row.project}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const assistantProjectItems = computed(() => projects.value.map(project => ({ label: project.name, value: project.id })))

async function load() {
  loading.value = true
  try {
    const [humans, ai] = await Promise.all([api<{ agents: HumanAgent[] }>('/admin/agents'), api<{ agents: SupportAgent[] }>('/admin/support-agents')])
    humanAgents.value = humans.agents; aiAgents.value = ai.agents
  } finally { loading.value = false }
}
async function createTeammate() {
  saving.value = true; error.value = ''
  try { await api('/admin/agents', { method: 'POST', body: teammateForm }); Object.assign(teammateForm, { name: '', email: '', username: '', password: '' }); showTeammate.value = false; await load() }
  catch (cause: any) { error.value = cause?.message || 'Could not add teammate' } finally { saving.value = false }
}
async function createAssistant() {
  saving.value = true; error.value = ''
  try { const { agent } = await api<{ agent: SupportAgent }>('/admin/support-agents', { method: 'POST', body: assistantForm }); await navigateTo(`/assistants/${agent.id}`) }
  catch (cause: any) { error.value = cause?.message || 'Could not create AI agent' } finally { saving.value = false }
}
async function removeTeammate(row: Row) {
  if (!confirm(`Remove ${row.name}? They will be signed out everywhere.`)) return
  try { await api(`/admin/agents/${row.id}`, { method: 'DELETE' }); await load() } catch (cause: any) { error.value = cause?.message || 'Could not remove teammate' }
}
onMounted(async () => { await loadProjects(); assistantForm.projectId = projects.value[0]?.id || ''; await load() })
</script>

<style scoped>
@reference "~/assets/css/main.css";
</style>
