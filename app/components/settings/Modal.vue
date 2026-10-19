<template>
  <UModal v-model:open="open" title="Settings" description="Your account, the panel's look, the workspace, its team, AI provider and API keys." :ui="{ content: 'sm:max-w-3xl overflow-hidden' }">
    <template #content="{ close }">
      <div class="flex h-[min(640px,88vh)] flex-col sm:flex-row">
        <nav class="flex shrink-0 gap-1 overflow-x-auto border-b border-default bg-muted p-2 sm:w-52 sm:flex-col sm:border-r sm:border-b-0 sm:p-3" aria-label="Settings">
          <p class="hidden px-2 pt-1 pb-2 text-xs font-medium text-muted sm:block">Settings</p>
          <button
            v-for="item in tabs"
            :key="item.key"
            type="button"
            class="flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium transition-colors"
            :class="item.key === current.key ? 'bg-black/[0.07] text-highlighted dark:bg-white/[0.07]' : 'text-default hover:bg-black/[0.045] dark:hover:bg-white/[0.045]'"
            :aria-current="item.key === current.key ? 'page' : undefined"
            @click="tab = item.key"
          >
            <UIcon :name="item.icon" class="size-4 shrink-0 text-muted" />{{ item.label }}
          </button>
        </nav>

        <section class="flex min-h-0 min-w-0 flex-1 flex-col">
          <header class="flex h-14 shrink-0 items-center gap-2 border-b border-default px-6">
            <h2 class="text-[15px] font-semibold text-highlighted">{{ current.label }}</h2>
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" square class="ml-auto text-muted" aria-label="Close settings" @click="close" />
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <!-- Account -->
            <form v-if="current.key === 'account'" class="space-y-6" @submit.prevent="saveProfile">
              <div class="flex items-center gap-4">
                <UAvatar :text="initials" size="xl" />
                <div class="min-w-0">
                  <p class="truncate text-[15px] font-semibold text-highlighted">{{ agent?.name || agent?.username }}</p>
                  <p class="truncate text-[13px] text-muted">Signed in as {{ agent?.username }}</p>
                </div>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField label="Name" hint="Shown to teammates"><UInput v-model="profile.name" class="w-full" maxlength="120" /></UFormField>
                <UFormField label="Email" hint="For password resets"><UInput v-model="profile.email" type="email" class="w-full" /></UFormField>
                <UFormField label="Username"><UInput :model-value="agent?.username" disabled class="w-full" /></UFormField>
              </div>
              <p v-if="profileError" class="text-[13px] text-error">{{ profileError }}</p>
              <div class="flex items-center gap-3">
                <UButton type="submit" :loading="savingProfile" :disabled="!profileDirty">Save profile</UButton>
                <span v-if="profileSaved && !profileDirty" class="text-[13px] text-muted">Saved</span>
                <UButton :label="demo ? 'Exit demo' : 'Sign out'" icon="i-lucide-log-out" color="neutral" variant="ghost" class="ml-auto" @click="logout()" />
              </div>
            </form>

            <!-- Appearance -->
            <div v-else-if="current.key === 'appearance'" class="space-y-3">
              <p class="section-label">Theme</p>
              <div class="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
                <button
                  v-for="theme in themes"
                  :key="theme.value"
                  type="button"
                  role="radio"
                  :aria-checked="colorMode.preference === theme.value"
                  class="group rounded-xl border p-1.5 text-left transition-colors"
                  :class="colorMode.preference === theme.value ? 'border-primary ring-1 ring-primary' : 'border-default hover:border-accented'"
                  @click="colorMode.preference = theme.value"
                >
                  <!-- A thumbnail of the panel: sidebar on the canvas, a page beside it. -->
                  <span class="relative block h-20 overflow-hidden rounded-lg">
                    <span v-for="(look, i) in theme.looks" :key="look" class="absolute inset-0 flex" :class="[looks[look], i ? '[clip-path:polygon(60%_0,100%_0,100%_100%,40%_100%)]' : '']">
                      <span class="w-1/3 space-y-1 p-1.5"><span class="block h-1.5 w-3/4 rounded-full bg-current opacity-25" /><span class="block h-1.5 w-1/2 rounded-full bg-current opacity-15" /><span class="block h-1.5 w-2/3 rounded-full bg-current opacity-15" /></span>
                      <span class="my-1.5 mr-1.5 flex-1 rounded-md bg-(--page) p-1.5"><span class="block h-1.5 w-1/2 rounded-full bg-current opacity-25" /></span>
                    </span>
                  </span>
                  <span class="mt-1.5 flex items-center gap-1.5 px-1 text-[13px] font-medium text-highlighted"><UIcon :name="theme.icon" class="size-3.5 text-muted" />{{ theme.label }}</span>
                </button>
              </div>
              <p class="text-xs text-muted">System follows your device. This only changes the panel; each project's widget sets its own colour in the project's settings.</p>
            </div>

            <!-- Projects -->
            <div v-else-if="current.key === 'projects'" class="space-y-4">
              <div class="flex items-center gap-3">
                <p class="min-w-0 flex-1 text-[13px] text-muted">Name, branding, colour and email sending live in each project's settings.</p>
                <UButton icon="i-lucide-plus" label="New project" color="neutral" variant="outline" size="sm" @click="newProject" />
              </div>
              <ul v-if="projects.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
                <li v-for="p in projects" :key="p.id">
                  <NuxtLink :to="`/projects/${p.id}/settings`" class="flex min-h-12 items-center gap-3 px-4 transition-colors hover:bg-elevated" @click="open = false">
                    <ProjectDot tile :project-id="p.id" :accent="p.theme?.accent" :name="p.name" :icon-url="p.iconUrl" class="!size-6 !rounded-md !text-xs" />
                    <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-highlighted">{{ p.name }}</span>
                    <span class="hidden truncate text-xs text-muted sm:block">{{ p.siteUrl }}</span>
                    <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
                  </NuxtLink>
                </li>
              </ul>
              <EmptyState v-else icon="i-lucide-boxes" title="No projects yet" description="Each app you connect is a project." class="rounded-xl border border-dashed border-default" />
            </div>

            <SettingsWorkspace v-else-if="current.key === 'workspace'" />
            <SettingsUsage v-else-if="current.key === 'usage'" />
            <SettingsTeam v-else-if="current.key === 'team'" />
            <SettingsWorkspaceAi v-else-if="current.key === 'ai'" />
            <SettingsErrorServers v-else-if="current.key === 'error-tracking'" />
            <SettingsApiKeys v-else-if="current.key === 'api-keys'" />
            <component :is="extra.component" v-else-if="extra" />
          </div>
        </section>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
// The panel's own settings, over whatever page you are on. `settings-tab` is
// the open tab; '' is closed, so anything can open it on a given tab.
const tab = useState('settings-tab', () => '')
const newProjectOpen = useState('new-project-open', () => false)
const { api, agent, projects, demo, context, logout } = useAgent()
const colorMode = useColorMode()

// Plan & usage only shows when the plan has limits, so never on a self-hosted install.
const coreTabs = computed(() => [
  { key: 'account', label: 'Account', icon: 'i-lucide-circle-user' },
  { key: 'appearance', label: 'Appearance', icon: 'i-lucide-sun-moon' },
  { key: 'workspace', label: 'Workspace', icon: 'i-lucide-building-2' },
  ...(context.value?.plan && !context.value.plan.unlimited ? [{ key: 'usage', label: 'Plan & usage', icon: 'i-lucide-gauge' }] : []),
  { key: 'projects', label: 'Projects', icon: 'i-lucide-boxes' },
  { key: 'team', label: 'Team', icon: 'i-lucide-users-round' },
  { key: 'ai', label: 'AI', icon: 'i-lucide-sparkles' },
  { key: 'error-tracking', label: 'Error tracking', icon: 'i-lucide-bug' },
  { key: 'api-keys', label: 'API keys', icon: 'i-lucide-key-round' }
])
// Tabs the cloud edition registers (app/utils/editionUi.ts) follow the core ones.
const { settingsTabs } = editionUi()
const tabs = computed(() => [...coreTabs.value, ...settingsTabs])
const current = computed(() => tabs.value.find(item => item.key === tab.value) || tabs.value[0]!)
const extra = computed(() => settingsTabs.find(item => item.key === current.value.key))
const open = computed({ get: () => !!tab.value, set: (value) => { tab.value = value ? (tab.value || 'account') : '' } })

// Thumbnails in each theme's own canvas, page and ink; System shows both, split.
const looks = { light: 'bg-[#f4f4f5] text-[#161719] [--page:#fcfcfc]', dark: 'bg-[#08090a] text-[#f7f8f8] [--page:#17181a]' }
const themes = [
  { value: 'system', label: 'System', icon: 'i-lucide-monitor', looks: ['light', 'dark'] as const },
  { value: 'light', label: 'Light', icon: 'i-lucide-sun', looks: ['light'] as const },
  { value: 'dark', label: 'Dark', icon: 'i-lucide-moon', looks: ['dark'] as const }
]

const profile = reactive({ name: '', email: '' })
const savingProfile = ref(false)
const profileSaved = ref(false)
const profileError = ref('')
const initials = computed(() => (agent.value?.name || agent.value?.username || '?').split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase())
const profileDirty = computed(() => profile.name !== (agent.value?.name || '') || profile.email !== (agent.value?.email || ''))
watch(open, () => {
  profile.name = agent.value?.name || ''
  profile.email = agent.value?.email || ''
  profileSaved.value = false
  profileError.value = ''
}, { immediate: true })

async function saveProfile() {
  savingProfile.value = true
  profileError.value = ''
  try {
    const result = await api<{ agent: NonNullable<typeof agent.value> }>('/admin/me', { method: 'PATCH', body: { ...profile } })
    agent.value = result.agent
    profileSaved.value = true
  } catch (e: any) {
    profileError.value = e?.message || 'Could not save your profile'
  } finally {
    savingProfile.value = false
  }
}

function newProject() {
  open.value = false
  newProjectOpen.value = true
}
</script>
