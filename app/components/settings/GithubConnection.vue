<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <p class="min-w-0 flex-1 text-[13px] text-muted">{{ $t('workspaceSettings.github.intro') }}</p>
      <UButton v-if="configured" icon="i-lucide-plus" :label="$t('workspaceSettings.github.connect')" color="neutral" variant="outline" size="sm" :loading="starting" @click="connect" />
    </div>
    <p v-if="notice" class="flex items-start gap-2 text-[13px]" :class="notice === 'connected' ? 'text-success' : 'text-error'">
      <UIcon :name="notice === 'connected' ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="mt-0.5 size-4 shrink-0" />
      <span class="min-w-0 break-words">{{ notice === 'connected' ? $t('workspaceSettings.github.connected') : notice }}</span>
    </p>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-12" /></div>
    <EmptyState v-else-if="!configured" icon="i-lucide-github" :title="$t('workspaceSettings.github.notConfigured')" :description="$t('workspaceSettings.github.notConfiguredDescription')" class="rounded-xl border border-dashed border-default" />
    <EmptyState v-else-if="!installations.length" icon="i-lucide-github" :title="$t('workspaceSettings.github.noAccounts')" :description="$t('workspaceSettings.github.noAccountsDescription')" class="rounded-xl border border-dashed border-default" />
    <ul v-else class="space-y-2">
      <li v-for="item in installations" :key="item.id" class="flex min-h-12 items-center gap-3 rounded-xl border border-default px-4 py-2">
        <UAvatar :src="item.avatar" :alt="item.account" size="sm" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-medium text-highlighted">{{ item.account }}</span>
          <span class="block truncate text-xs text-muted">{{ item.type === 'Organization' ? $t('workspaceSettings.github.organisation') : $t('workspaceSettings.github.personalAccount') }}</span>
        </span>
        <UTooltip :text="$t('workspaceSettings.disconnect')"><UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-unplug" class="text-muted" :aria-label="$t('workspaceSettings.disconnect')" @click="remove(item)" /></UTooltip>
      </li>
    </ul>
    <p v-if="installations.length" class="text-xs text-muted">{{ $t('workspaceSettings.github.manageNote') }}</p>
  </div>
</template>

<script setup lang="ts">
export type GithubInstallationView = { id: string, account: string, type: string, avatar: string }

const { api } = useAgent()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const installations = ref<GithubInstallationView[]>([])
const configured = ref(true)
const loading = ref(true)
const starting = ref(false)
const error = ref('')
// What GitHub's return trip reported: "connected" or the reason it failed.
const notice = ref(String(route.query.github || ''))

async function connect() {
  starting.value = true
  error.value = ''
  try { window.location.href = (await api<{ url: string }>('/admin/github/install', { method: 'POST' })).url } catch (cause: any) { error.value = cause.message || t('workspaceSettings.github.connectFailed'); starting.value = false }
}

async function remove(item: GithubInstallationView) {
  if (!confirm(t('workspaceSettings.github.disconnectConfirm', { account: item.account }))) return
  error.value = ''
  try { installations.value = (await api<{ installations: GithubInstallationView[] }>(`/admin/github/installations/${item.id}`, { method: 'DELETE' })).installations } catch (cause: any) { error.value = cause.message || t('workspaceSettings.disconnectFailed') }
}

onMounted(async () => {
  if (route.query.github) router.replace({ query: { ...route.query, github: undefined } })
  try {
    const result = await api<{ configured: boolean, installations: GithubInstallationView[] }>('/admin/github')
    configured.value = result.configured; installations.value = result.installations
  } catch (cause: any) { error.value = cause.message || t('workspaceSettings.github.loadFailed') } finally { loading.value = false }
})
</script>
