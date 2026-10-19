<template>
  <div class="flex h-full min-h-0 flex-col bg-muted text-default md:flex-row">
    <!-- Phones get a top bar; the sidebar slides over from the left. -->
    <header class="flex h-12 shrink-0 items-center gap-1 border-b border-default bg-default px-2 md:hidden">
      <UButton icon="i-lucide-menu" color="neutral" variant="ghost" square aria-label="Open navigation" @click="navOpen = true" />
      <NuxtLink to="/inbox" class="flex items-center gap-2 px-1 text-[13px] font-semibold text-highlighted">
        <span class="grid size-5 place-items-center rounded-[5px] bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-3.5" /></span>
        HelpBites
      </NuxtLink>
      <span v-if="totalUnread" class="text-xs tabular-nums text-muted">{{ totalUnread }}</span>
      <UButton icon="i-lucide-search" color="neutral" variant="ghost" square class="ml-auto" aria-label="Search" @click="paletteOpen = true" />
    </header>

    <aside class="hidden w-60 shrink-0 md:block">
      <AppSidebar />
    </aside>

    <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-default md:my-2 md:mr-2 md:rounded-xl md:border md:border-default md:shadow-[0_1px_3px_rgb(0_0_0/0.04)]">
      <p v-if="demo" class="flex shrink-0 items-center gap-2 border-b border-default bg-elevated px-4 py-1.5 text-xs text-muted">
        <UIcon name="i-lucide-flask-conical" class="size-3.5 shrink-0" />
        <span class="min-w-0 truncate">Demo with sample data. Nothing you do here is saved.</span>
        <button type="button" class="ml-auto shrink-0 font-medium text-default hover:text-highlighted" @click="logout()">Exit demo</button>
      </p>
      <p v-if="closedWorkspace" class="flex shrink-0 items-center gap-2 border-b border-default bg-elevated px-4 py-1.5 text-xs text-muted">
        <UIcon name="i-lucide-lock" class="size-3.5 shrink-0" />
        <span class="min-w-0 truncate">{{ closedWorkspace }}</span>
      </p>
      <component :is="banner" v-for="(banner, i) in banners" :key="i" />
      <slot />
    </main>

    <USlideover v-model:open="navOpen" side="left" :ui="{ content: 'max-w-64 bg-muted' }">
      <template #content><AppSidebar /></template>
    </USlideover>

    <SettingsModal />

    <UModal v-model:open="paletteOpen" :ui="{ content: 'sm:max-w-xl' }">
      <template #content>
        <UCommandPalette :groups="paletteGroups" placeholder="Go to a page or project…" class="h-96" close @update:open="paletteOpen = $event" />
      </template>
    </UModal>

    <UModal v-model:open="newProjectOpen" title="New project" description="Name it after the app. You can set everything else afterwards.">
      <template #body>
        <form class="space-y-4" @submit.prevent="createProject">
          <UFormField label="Name"><UInput v-model="newName" class="w-full" autofocus required /></UFormField>
          <UFormField label="Site URL" hint="Where the widget will live; used in email links"><UInput v-model="newSite" placeholder="https://app.example.com" class="w-full" /></UFormField>
          <p v-if="createError" class="text-sm text-error">{{ createError }}</p>
          <div class="flex justify-end gap-2 pt-2"><UButton color="neutral" variant="ghost" @click="newProjectOpen = false">Cancel</UButton><UButton type="submit" :loading="creating">Create project</UButton></div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="newWorkspaceOpen" title="New workspace" description="A separate space with its own projects, inbox and team. You'll be its owner.">
      <template #body>
        <form class="space-y-4" @submit.prevent="createWorkspace">
          <UFormField label="Name"><UInput v-model="workspaceName" class="w-full" autofocus required maxlength="80" /></UFormField>
          <p v-if="workspaceError" class="text-sm text-error">{{ workspaceError }}</p>
          <div class="flex justify-end gap-2 pt-2"><UButton color="neutral" variant="ghost" @click="newWorkspaceOpen = false">Cancel</UButton><UButton type="submit" :loading="creatingWorkspace">Create workspace</UButton></div>
        </form>
      </template>
    </UModal>

    <PlanLimitModal />
  </div>
</template>

<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'

const { api, projects, demo, context, logout, loadProjects, switchWorkspace } = useAgent()
// Strips the cloud edition registers (plan and verification notices).
const { banners } = editionUi()
// A suspended or deleting workspace refuses everything but its settings: say why, once, above every page.
const closedWorkspace = computed(() => {
  const status = context.value?.workspace?.status
  if (status === 'suspended') return 'This workspace is suspended. Its data is safe; you can still export it from Settings → Workspace.'
  if (status === 'deleting') return 'This workspace is being deleted.'
  return ''
})
const route = useRoute()
const totalUnread = useState<number>('inbox-total-unread', () => 0)
const paletteOpen = useState('palette-open', () => false)
const newProjectOpen = useState('new-project-open', () => false)
const composeOpen = useState('compose-open', () => false)

const navOpen = ref(false)
watch(() => route.fullPath, () => { navOpen.value = false; paletteOpen.value = false })

const settingsTab = useState('settings-tab', () => '')

function go(to: string) { paletteOpen.value = false; return navigateTo(to) }
function openSettings(tab: string) { paletteOpen.value = false; settingsTab.value = tab }
const paletteGroups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [
  {
    id: 'pages',
    label: 'Pages',
    items: [
      { label: 'Inbox', icon: 'i-lucide-inbox', kbds: ['g', 'i'], onSelect: () => go('/inbox') },
      { label: 'Email templates', icon: 'i-lucide-mail', kbds: ['g', 'e'], onSelect: () => go('/emails?view=templates') },
      { label: 'Email log', icon: 'i-lucide-history', onSelect: () => go('/emails?view=log') },
      { label: 'Projects', icon: 'i-lucide-boxes', kbds: ['g', 'p'], onSelect: () => go('/projects') },
      { label: 'Developer', icon: 'i-lucide-code-xml', onSelect: () => go('/developer') }
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { label: 'Account', icon: 'i-lucide-circle-user', onSelect: () => openSettings('account') },
      { label: 'Appearance', icon: 'i-lucide-sun-moon', onSelect: () => openSettings('appearance') },
      ...(context.value?.plan && !context.value.plan.unlimited ? [{ label: 'Plan & usage', icon: 'i-lucide-gauge', onSelect: () => openSettings('usage') }] : []),
      { label: 'Team', icon: 'i-lucide-users-round', onSelect: () => openSettings('team') },
      { label: 'AI', icon: 'i-lucide-sparkles', onSelect: () => openSettings('ai') },
      { label: 'API keys', icon: 'i-lucide-key-round', onSelect: () => openSettings('api-keys') }
    ]
  },
  {
    id: 'projects',
    label: 'Projects',
    items: projects.value.flatMap(project => projectSections.map(section => ({
      label: section.path === 'overview' ? project.name : `${project.name} › ${section.label}`,
      suffix: section.path === 'overview' ? project.siteUrl : undefined,
      icon: section.icon,
      onSelect: () => go(`/projects/${project.id}/${section.path}`)
    })))
  }
])

// Linear's keys: ⌘K to jump, C to write, G then a letter to go.
defineShortcuts({
  meta_k: () => { paletteOpen.value = !paletteOpen.value },
  'meta_,': () => { settingsTab.value = settingsTab.value ? '' : 'account' },
  c: () => { composeOpen.value = true; if (route.path !== '/inbox') navigateTo('/inbox') },
  'g-i': () => navigateTo('/inbox'),
  'g-e': () => navigateTo('/emails?view=templates'),
  'g-p': () => navigateTo('/projects')
})

const newName = ref('')
const newSite = ref('')
const creating = ref(false)
const createError = ref('')
// The dev page shows a new project's secret once. It goes over in memory: in
// a URL, browser history and Sentry's navigation breadcrumbs would keep it.
const newProjectSecret = useState<{ id: string, secret: string } | null>('new-project-secret', () => null)
async function createProject() {
  creating.value = true
  createError.value = ''
  try {
    const result = await api<{ project: { id: string }, secret: string }>('/admin/projects', { method: 'POST', body: { name: newName.value, siteUrl: newSite.value, allowedOrigins: newSite.value ? [newSite.value] : [] } })
    newProjectOpen.value = false
    newName.value = ''
    newSite.value = ''
    await loadProjects().catch(() => {})
    newProjectSecret.value = { id: result.project.id, secret: result.secret }
    await navigateTo(`/projects/${result.project.id}/dev`)
  } catch (e: any) {
    createError.value = e?.message || 'Could not create the project'
  } finally {
    creating.value = false
  }
}

const newWorkspaceOpen = useState('new-workspace-open', () => false)
const workspaceName = ref('')
const creatingWorkspace = ref(false)
const workspaceError = ref('')
async function createWorkspace() {
  creatingWorkspace.value = true
  workspaceError.value = ''
  try {
    const { workspace } = await api<{ workspace: { id: string } }>('/admin/workspaces', { method: 'POST', body: { name: workspaceName.value } })
    await switchWorkspace(workspace.id)
  } catch (e: any) {
    workspaceError.value = e?.message || 'Could not create the workspace'
    creatingWorkspace.value = false
  }
}

onMounted(() => { loadProjects().catch(() => {}) })
</script>
