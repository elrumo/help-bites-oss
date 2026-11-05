<template>
  <UModal v-model:open="open" :title="$t('settings.title')" :description="$t('settings.description')" :ui="{ content: 'sm:max-w-3xl overflow-hidden' }">
    <template #content="{ close }">
      <div class="flex h-[min(640px,88vh)] flex-col sm:flex-row">
        <nav class="flex shrink-0 gap-1 overflow-x-auto border-b border-default bg-muted p-2 sm:w-52 sm:flex-col sm:border-r sm:border-b-0 sm:p-3" :aria-label="$t('settings.title')">
          <p class="hidden px-2 pt-1 pb-2 text-xs font-medium text-muted sm:block">{{ $t('settings.title') }}</p>
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
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" square class="ml-auto text-muted" :aria-label="$t('settings.close')" @click="close" />
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
                <UFormField v-if="emailChanging" label="Current password" hint="Needed to change your email"><UInput v-model="profilePassword" type="password" autocomplete="current-password" class="w-full" /></UFormField>
                <UFormField label="Username"><UInput :model-value="agent?.username" disabled class="w-full" /></UFormField>
              </div>
              <p v-if="profileError" class="text-[13px] text-error">{{ profileError }}</p>
              <div class="flex items-center gap-3">
                <UButton type="submit" :loading="savingProfile" :disabled="!profileDirty">Save profile</UButton>
                <span v-if="profileSaved && !profileDirty" class="text-[13px] text-muted">Saved</span>
                <UButton :label="demo ? $t('nav.exitDemo') : $t('nav.signOut')" icon="i-lucide-log-out" color="neutral" variant="ghost" class="ml-auto" @click="logout()" />
              </div>
              <div class="flex items-center gap-3 border-t border-default pt-6">
                <div class="min-w-0 flex-1">
                  <p class="text-[13px] font-medium text-highlighted">{{ $t('welcomeTour.settingsTitle') }}</p>
                  <p class="text-xs text-muted">{{ $t('welcomeTour.settingsHint') }}</p>
                </div>
                <UButton type="button" icon="i-lucide-circle-play" color="neutral" variant="outline" size="sm" :label="$t('welcomeTour.replay')" @click="replayTour" />
              </div>
              <div class="flex items-center gap-3 border-t border-default pt-6">
                <div class="min-w-0 flex-1">
                  <p class="text-[13px] font-medium text-highlighted">HelpBites</p>
                  <p class="text-xs text-muted">{{ $t('settings.aboutHint') }}</p>
                </div>
                <AppVersion class="text-[13px]" />
                <UButton :to="README_URL" target="_blank" external color="neutral" variant="outline" size="sm" icon="i-lucide-book-open" :label="$t('common.readme')" />
                <UButton :to="DOCKER_HUB_URL" target="_blank" external color="neutral" variant="outline" size="sm" icon="i-lucide-container" :label="$t('common.dockerHub')" />
              </div>
            </form>

            <!-- Appearance -->
            <div v-else-if="current.key === 'appearance'" class="space-y-3">
              <p class="section-label">{{ $t('settings.theme') }}</p>
              <div class="grid grid-cols-3 gap-3" role="radiogroup" :aria-label="$t('settings.theme')">
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
              <p class="text-xs text-muted">{{ $t('settings.themeNote') }}</p>

              <p class="section-label pt-3">{{ $t('settings.language') }}</p>
              <USelect :model-value="locale" :items="localeItems" class="w-full sm:w-64" :aria-label="$t('settings.language')" @update:model-value="setLocale($event as any)" />
              <p class="text-xs text-muted">{{ $t('settings.languageNote') }}</p>
            </div>

            <!-- Projects -->
            <div v-else-if="current.key === 'projects'" class="space-y-4">
              <div class="flex items-center gap-3">
                <p class="min-w-0 flex-1 text-[13px] text-muted">Name, branding, colour and email sending live in each project's settings.</p>
                <UButton icon="i-lucide-plus" label="New project" color="neutral" variant="outline" size="sm" @click="newProject" />
              </div>
              <ul v-if="projects.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
                <li v-for="p in projects" :key="p.id">
                  <NuxtLink :to="`/projects/${p.id}/settings`" class="flex min-h-12 items-center gap-3 px-4 transition-colors hover:bg-elevated" @click.prevent="open = false; openProjectSettings(p.id)">
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
            <!-- Connections: the outside accounts the workspace reads from -->
            <div v-else-if="current.key === 'connections'" class="space-y-8">
              <section class="space-y-3"><h3 class="flex items-center gap-2 text-[13px] font-semibold text-highlighted"><UIcon name="i-lucide-github" class="size-4" />GitHub</h3><SettingsGithubConnection /></section>
              <section class="space-y-3"><h3 class="flex items-center gap-2 text-[13px] font-semibold text-highlighted"><UIcon name="i-lucide-circle-dollar-sign" class="size-4" />Stripe</h3><SettingsStripeConnections @navigate="open = false" /></section>
              <section class="space-y-3"><h3 class="flex items-center gap-2 text-[13px] font-semibold text-highlighted"><UIcon name="i-lucide-send" class="size-4" />Telegram</h3><SettingsTelegramConnections /></section>
              <section class="space-y-3"><h3 class="flex items-center gap-2 text-[13px] font-semibold text-highlighted"><UIcon name="i-lucide-bug" class="size-4" />Error tracking</h3><SettingsErrorServers /></section>
            </div>
            <SettingsApiKeys v-else-if="current.key === 'api-keys'" />
            <component :is="extra.component" v-else-if="extra" />
          </div>
        </section>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { DOCKER_HUB_URL, README_URL } from '#shared/docs'

// The panel's own settings, over whatever page you are on. `settings-tab` is
// the open tab; '' is closed, so anything can open it on a given tab.
const tab = useState('settings-tab', () => '')
const newProjectOpen = useState('new-project-open', () => false)
const tourOpen = useState('tour-open', () => false)
const { api, agent, projects, demo, context, logout } = useAgent()
const { openProjectSettings } = useProjectSettings()
const colorMode = useColorMode()
const { t, locale, locales, setLocale } = useI18n()
const localeItems = computed(() => locales.value.map(l => ({ label: l.name || l.code, value: l.code })))
// GitHub's install callback lands on /projects?github=…, which reopens the connections tab.
if (useRoute().query.github) tab.value = 'connections'

// Usage is on every edition (where storage goes); "Plan & usage" when the plan has limits.
const coreTabs = computed(() => [
  { key: 'account', label: t('settings.tabs.account'), icon: 'i-lucide-circle-user' },
  { key: 'appearance', label: t('settings.tabs.appearance'), icon: 'i-lucide-sun-moon' },
  { key: 'workspace', label: t('settings.tabs.workspace'), icon: 'i-lucide-building-2' },
  { key: 'usage', label: context.value?.plan && !context.value.plan.unlimited ? t('settings.tabs.usage') : t('settings.tabs.usageOnly'), icon: 'i-lucide-gauge' },
  { key: 'projects', label: t('settings.tabs.projects'), icon: 'i-lucide-boxes' },
  { key: 'team', label: t('settings.tabs.team'), icon: 'i-lucide-users-round' },
  { key: 'ai', label: t('settings.tabs.ai'), icon: 'i-lucide-sparkles' },
  { key: 'connections', label: t('settings.tabs.connections'), icon: 'i-lucide-plug-zap' },
  { key: 'api-keys', label: t('settings.tabs.apiKeys'), icon: 'i-lucide-key-round' }
])
// Tabs the cloud edition registers (app/utils/editionUi.ts) follow the core ones.
const { settingsTabs } = editionUi()
const tabs = computed(() => [...coreTabs.value, ...settingsTabs])
// GitHub and error tracking used to be tabs of their own; links that still open them land on Connections.
const key = computed(() => (tab.value === 'github' || tab.value === 'error-tracking' ? 'connections' : tab.value))
const current = computed(() => tabs.value.find(item => item.key === key.value) || tabs.value[0]!)
const extra = computed(() => settingsTabs.find(item => item.key === current.value.key))
const open = computed({ get: () => !!tab.value, set: (value) => { tab.value = value ? (tab.value || 'account') : '' } })

// Thumbnails in each theme's own canvas, page and ink; System shows both, split.
const looks = { light: 'bg-[#f4f4f5] text-[#161719] [--page:#fcfcfc]', dark: 'bg-[#08090a] text-[#f7f8f8] [--page:#17181a]' }
const themes = computed(() => [
  { value: 'system', label: t('nav.system'), icon: 'i-lucide-monitor', looks: ['light', 'dark'] as const },
  { value: 'light', label: t('nav.light'), icon: 'i-lucide-sun', looks: ['light'] as const },
  { value: 'dark', label: t('nav.dark'), icon: 'i-lucide-moon', looks: ['dark'] as const }
])

const profile = reactive({ name: '', email: '' })
const profilePassword = ref('')
const emailChanging = computed(() => profile.email !== (agent.value?.email || ''))
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
    const result = await api<{ agent: NonNullable<typeof agent.value> }>('/admin/me', { method: 'PATCH', body: { ...profile, ...(emailChanging.value ? { currentPassword: profilePassword.value } : {}) } })
    agent.value = result.agent
    profilePassword.value = ''
    profileSaved.value = true
  } catch (e: any) {
    profileError.value = e?.message || 'Could not save your profile'
  } finally {
    savingProfile.value = false
  }
}

function replayTour() {
  open.value = false
  tourOpen.value = true
}

function newProject() {
  open.value = false
  newProjectOpen.value = true
}
</script>
