<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-12 shrink-0 items-center gap-1 px-3">
      <UDropdownMenu :items="accountItems" :content="{ align: 'start' }" :ui="{ content: 'w-60' }">
        <button type="button" class="-ml-1 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-[13px] font-semibold text-highlighted transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.045]">
          <span class="grid size-5 shrink-0 place-items-center rounded-[5px] bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-3.5" /></span>
          <span class="truncate">{{ context?.workspace?.name || 'HelpBites' }}</span>
          <UIcon name="i-lucide-chevron-down" class="size-3 shrink-0 text-muted" />
        </button>
      </UDropdownMenu>
      <UTooltip :text="$t('common.search')" :kbds="['meta', 'k']">
        <UButton icon="i-lucide-search" color="neutral" variant="ghost" size="sm" square class="ml-auto text-muted" :aria-label="$t('common.search')" @click="paletteOpen = true" />
      </UTooltip>
      <UTooltip :text="$t('nav.newConversation')" :kbds="['c']">
        <UButton icon="i-lucide-square-pen" color="neutral" variant="outline" size="sm" square :aria-label="$t('nav.newConversation')" @click="compose" />
      </UTooltip>
    </div>

    <nav class="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 pb-3" :aria-label="$t('nav.main')">
      <div class="space-y-px">
        <NuxtLink to="/overview" class="nav-item" active-class="nav-item-active"><UIcon name="i-lucide-house" class="size-4 shrink-0 text-muted" />{{ $t('nav.overview') }}</NuxtLink>
        <NuxtLink to="/inbox" class="nav-item" active-class="nav-item-active">
          <UIcon name="i-lucide-inbox" class="size-4 shrink-0 text-muted" />{{ $t('nav.inbox') }}
          <span v-if="totalUnread" class="ml-auto text-xs tabular-nums text-muted">{{ totalUnread }}</span>
        </NuxtLink>
        <NuxtLink to="/emails" class="nav-item" active-class="nav-item-active"><UIcon name="i-lucide-mail" class="size-4 shrink-0 text-muted" />{{ $t('nav.email') }}</NuxtLink>
      </div>

      <div>
        <div class="group/projects flex h-7 items-center px-2">
          <NuxtLink to="/projects" class="text-xs font-medium text-muted transition-colors hover:text-default">{{ $t('nav.projects') }}</NuxtLink>
          <UTooltip :text="$t('nav.newProject')">
            <UButton icon="i-lucide-plus" color="neutral" variant="ghost" size="xs" square class="ml-auto text-muted opacity-0 group-hover/projects:opacity-100 focus-visible:opacity-100" :aria-label="$t('nav.newProject')" @click="newProjectOpen = true" />
          </UTooltip>
        </div>
        <UCollapsible v-for="p in projects" :key="p.id" :open="isOpen(p.id)" @update:open="setOpen(p.id, $event)">
          <button type="button" class="nav-item">
            <ProjectDot tile :project-id="p.id" :accent="p.theme?.accent" :name="p.name" :icon-url="p.iconUrl" />
            <span class="truncate">{{ p.name }}</span>
            <UIcon name="i-lucide-chevron-down" class="size-3 shrink-0 text-muted transition-transform duration-200" :class="isOpen(p.id) ? '' : '-rotate-90'" />
          </button>
          <template #content>
            <div class="space-y-px pt-px pb-1 pl-5">
              <NuxtLink v-for="s in projectSections" :key="s.path" :to="`/projects/${p.id}/${s.path}`" class="nav-item pl-7" active-class="nav-item-active">
                <UIcon :name="s.icon" class="size-4 shrink-0 text-muted" />{{ $t('sections.' + s.path) }}
                <UIcon v-if="locked(s.feature)" name="i-lucide-lock" class="ml-auto size-3 shrink-0 text-dimmed" :title="$t('workspaceSettings.planLimit.notInPlan')" />
              </NuxtLink>
            </div>
          </template>
        </UCollapsible>
        <button v-if="!projects.length" type="button" class="nav-item text-muted" @click="newProjectOpen = true"><UIcon name="i-lucide-plus" class="size-4 shrink-0" />{{ $t('nav.addProject') }}</button>
      </div>

      <div class="space-y-px">
        <p class="flex h-7 items-center px-2 text-xs font-medium text-muted">{{ $t('nav.workspace') }}</p>
        <NuxtLink to="/developer" class="nav-item" active-class="nav-item-active"><UIcon name="i-lucide-code-xml" class="size-4 shrink-0 text-muted" />{{ $t('nav.developer') }}</NuxtLink>
        <button type="button" class="nav-item" @click="settingsTab = 'account'"><UIcon name="i-lucide-settings" class="size-4 shrink-0 text-muted" />{{ $t('nav.settings') }}</button>
      </div>

      <div v-if="editionItems.length" class="space-y-px">
        <NuxtLink v-for="item in editionItems" :key="item.key" :to="item.to" class="nav-item" active-class="nav-item-active"><UIcon :name="item.icon" class="size-4 shrink-0 text-muted" />{{ item.label }}</NuxtLink>
      </div>
    </nav>

    <div class="flex shrink-0 items-center px-3 pb-3">
      <UTooltip :text="isDark ? $t('nav.lightTheme') : $t('nav.darkTheme')">
        <UButton :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'" color="neutral" variant="outline" size="sm" square class="text-muted" :aria-label="isDark ? $t('nav.switchToLight') : $t('nav.switchToDark')" @click="colorMode.preference = isDark ? 'light' : 'dark'" />
      </UTooltip>
      <!-- The AGPL's offer of source: everyone using this deployment can get the code it runs. -->
      <a :href="meta.sourceCodeUrl" target="_blank" rel="noopener" class="ml-auto text-xs text-dimmed transition-colors hover:text-muted">{{ $t('common.sourceCode') }}</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { useLocalStorage } from '@vueuse/core'

// The layout owns the modals these open (this renders twice on phones: here
// and in the slide-over), so the sidebar only flips shared flags.
const paletteOpen = useState('palette-open', () => false)
const newProjectOpen = useState('new-project-open', () => false)
const composeOpen = useState('compose-open', () => false)
const totalUnread = useState<number>('inbox-total-unread', () => 0)
const settingsTab = useState('settings-tab', () => '')
const { locked } = usePlanLocks()

const { agent, projects, demo, context, logout, switchWorkspace } = useAgent()
const { t } = useI18n()
const meta = useMeta()
const newWorkspaceOpen = useState('new-workspace-open', () => false)
const route = useRoute()
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')
// Links the cloud edition registers (the staff console); none in community.
const { sidebarItems } = editionUi()
const editionItems = computed(() => sidebarItems.filter(item => !item.visible || item.visible()))

function compose() {
  composeOpen.value = true
  if (route.path !== '/inbox') navigateTo('/inbox')
}

// Projects open and close like Linear's teams; walking into one opens it.
const opened = useLocalStorage<string[]>('hb-sidebar-projects', [])
const currentProject = computed(() => route.path.startsWith('/projects/') ? String(route.params.id || '') : '')
function isOpen(id: string) { return opened.value.includes(id) }
function setOpen(id: string, open: boolean) {
  opened.value = open ? [...new Set([...opened.value, id])] : opened.value.filter(item => item !== id)
}
watch(currentProject, (id) => { if (id) setOpen(id, true) }, { immediate: true })

const themes = computed(() => [{ value: 'system', label: t('nav.system'), icon: 'i-lucide-monitor' }, { value: 'light', label: t('nav.light'), icon: 'i-lucide-sun' }, { value: 'dark', label: t('nav.dark'), icon: 'i-lucide-moon' }])
// The top-left menu: you, then your workspaces (switching starts the panel over), then the panel's own settings.
const workspaceItems = computed<DropdownMenuItem[]>(() => [
  ...(context.value?.workspaces || []).map(w => ({
    label: w.name,
    icon: 'i-lucide-building-2',
    type: 'checkbox' as const,
    checked: w.id === context.value?.workspace?.id,
    onSelect: () => switchWorkspace(w.id)
  })),
  ...(demo.value ? [] : [{ label: t('nav.newWorkspace'), icon: 'i-lucide-plus', onSelect: () => { newWorkspaceOpen.value = true } }])
])
const accountItems = computed<DropdownMenuItem[][]>(() => [
  [{ type: 'label', label: agent.value?.name || agent.value?.username || t('nav.signedIn'), avatar: { text: (agent.value?.name || agent.value?.username || '?').slice(0, 2).toUpperCase(), size: '2xs' } }],
  [{ type: 'label', label: t('nav.workspaces') }, ...workspaceItems.value],
  [{ label: t('nav.settings'), icon: 'i-lucide-settings', onSelect: () => { settingsTab.value = 'account' } }, {
    label: t('nav.theme'),
    icon: 'i-lucide-sun-moon',
    children: themes.value.map(theme => ({ label: theme.label, icon: theme.icon, type: 'checkbox' as const, checked: colorMode.preference === theme.value, onSelect: (e: Event) => { e.preventDefault(); colorMode.preference = theme.value } }))
  }],
  [{ label: demo.value ? t('nav.exitDemo') : t('nav.signOut'), icon: 'i-lucide-log-out', onSelect: () => logout() }]
])
</script>

<style scoped>
@reference "~/assets/css/main.css";
/* Sidebar rows sit on the canvas, so hover and selection darken whatever is under them. */
.nav-item { @apply flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium text-default transition-colors hover:bg-black/[0.045] dark:hover:bg-white/[0.045]; }
.nav-item-active { @apply bg-black/[0.07] text-highlighted hover:bg-black/[0.07] dark:bg-white/[0.07] dark:hover:bg-white/[0.07]; }
</style>
