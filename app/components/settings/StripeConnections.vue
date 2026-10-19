<template>
  <div class="space-y-4">
    <p class="text-[13px] text-muted">{{ $t('workspaceSettings.stripe.intro') }}</p>
    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-12" /></div>
    <EmptyState v-else-if="!projects.length" icon="i-lucide-circle-dollar-sign" :title="$t('workspaceSettings.noProjects')" :description="$t('workspaceSettings.stripe.emptyDescription')" class="rounded-xl border border-dashed border-default" />
    <ul v-else class="space-y-2">
      <li v-for="p in projects" :key="p.id" class="rounded-xl border border-default px-4 py-2">
        <div class="flex min-h-8 items-center gap-3">
          <ProjectDot tile :project-id="p.id" :accent="p.theme?.accent" :name="p.name" :icon-url="p.iconUrl" class="!size-6 !rounded-md !text-xs" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-medium text-highlighted">{{ p.name }}</span>
            <span class="block truncate text-xs text-muted">
              <template v-if="state[p.id]?.connected">
                {{ state[p.id]!.accountName || 'Stripe' }} · {{ state[p.id]!.livemode ? $t('workspaceSettings.stripe.live') : $t('workspaceSettings.stripe.testMode') }}<template v-if="state[p.id]!.lastError"> · <span class="text-error">{{ $t('workspaceSettings.stripe.lastSyncFailed') }}</span></template><template v-else-if="state[p.id]!.lastRunAt"> · {{ $t('workspaceSettings.stripe.synced', { time: logTime(state[p.id]!.lastRunAt) }) }}</template>
              </template>
              <template v-else>{{ $t('workspaceSettings.notConnected') }}</template>
            </span>
          </span>
          <template v-if="state[p.id]?.connected">
            <UButton :to="`/projects/${p.id}/revenue`" size="sm" color="neutral" variant="ghost" :label="$t('workspaceSettings.stripe.revenue')" @click="$emit('navigate')" />
            <UTooltip :text="$t('workspaceSettings.disconnect')"><UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-unplug" class="text-muted" :aria-label="$t('workspaceSettings.stripe.disconnectAria')" @click="disconnect(p.id, p.name)" /></UTooltip>
          </template>
          <UButton v-else-if="adding !== p.id" icon="i-lucide-plus" :label="$t('workspaceSettings.connect')" size="sm" color="neutral" variant="outline" @click="adding = p.id; key = ''" />
        </div>
        <form v-if="adding === p.id" class="mt-2 space-y-2 border-t border-default pt-3" @submit.prevent="connect(p.id)">
          <UFormField :label="$t('workspaceSettings.stripe.restrictedKey')" :help="$t('workspaceSettings.stripe.keyHelp')">
            <UInput v-model="key" type="password" placeholder="rk_live_…" autocomplete="off" class="w-full" autofocus />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" size="sm" @click="adding = ''">{{ $t('common.cancel') }}</UButton>
            <UButton type="submit" size="sm" :loading="saving" :disabled="!key.trim()">{{ $t('workspaceSettings.stripe.connectStripe') }}</UButton>
          </div>
        </form>
      </li>
    </ul>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import type { StripeConnection } from '#shared/stripe'
import { logTime } from '~/utils/emailStatus'

defineEmits<{ navigate: [] }>()
const { api, projects } = useAgent()
const { t } = useI18n()
const state = reactive<Record<string, StripeConnection | undefined>>({})
const loading = ref(true)
const adding = ref('')
const key = ref('')
const saving = ref(false)
const error = ref('')

async function refresh(id: string) {
  const res = await api<{ connection: StripeConnection }>('/admin/stripe', { query: { project: id } })
  state[id] = res.connection
}

async function connect(id: string) {
  saving.value = true
  error.value = ''
  try {
    state[id] = (await api<{ connection: StripeConnection }>('/admin/stripe/connect', { method: 'POST', body: { project: id, apiKey: key.value } })).connection
    adding.value = ''
    key.value = ''
  } catch (cause: any) { error.value = cause.message || t('workspaceSettings.stripe.connectFailed') } finally { saving.value = false }
}

async function disconnect(id: string, name: string) {
  if (!confirm(t('workspaceSettings.stripe.disconnectConfirm', { name }))) return
  error.value = ''
  try {
    await api('/admin/stripe', { method: 'DELETE', query: { project: id } })
    await refresh(id)
  } catch (cause: any) { error.value = cause.message || t('workspaceSettings.disconnectFailed') }
}

onMounted(async () => {
  // A role that may not see revenue gets a 403 for a project: it just shows as not connected.
  await Promise.all(projects.value.map(p => refresh(p.id).catch(() => {})))
  loading.value = false
})
</script>
