<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <p class="min-w-0 flex-1 text-[13px] text-muted">GlitchTip and Bugsink servers every project in this workspace can report to. A project picks one when you connect error tracking.</p>
      <UButton v-if="!form" icon="i-lucide-plus" label="Add server" color="neutral" variant="outline" size="sm" @click="form = 'new'" />
    </div>
    <SettingsErrorServerForm v-if="form === 'new'" :providers="providers" cancellable @saved="saved" @cancel="form = ''" />
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-12" /></div>
    <EmptyState v-else-if="!servers.length && form !== 'new'" icon="i-lucide-bug" title="No error tracking servers" description="Add the URL and API token of your GlitchTip or Bugsink." class="rounded-xl border border-dashed border-default" />
    <ul v-else class="space-y-2">
      <li v-for="server in servers" :key="server.id">
        <SettingsErrorServerForm v-if="form === server.id" :providers="providers" :server="server" cancellable @saved="saved" @cancel="form = ''" />
        <div v-else class="flex min-h-12 items-center gap-3 rounded-xl border border-default px-4 py-2">
          <UIcon name="i-lucide-bug" class="size-4 shrink-0 text-muted" />
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2"><span class="truncate text-[13px] font-medium text-highlighted">{{ server.name }}</span><UBadge color="neutral" variant="subtle" size="sm">{{ server.providerName }}</UBadge></span>
            <span class="block truncate text-xs text-muted">{{ server.builtIn ? 'Set in this server\'s environment' : server.url }}</span>
          </span>
          <template v-if="!server.builtIn">
            <UTooltip text="Edit"><UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-pencil" class="text-muted" aria-label="Edit" @click="form = server.id" /></UTooltip>
            <UTooltip text="Remove"><UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-trash-2" class="text-muted" aria-label="Remove" @click="remove(server)" /></UTooltip>
          </template>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { ErrorProviderView, ErrorServerView } from './ErrorServerForm.vue'

const { api } = useAgent()
const servers = ref<ErrorServerView[]>([])
const providers = ref<ErrorProviderView[]>([])
const form = ref('')
const loading = ref(true)
const error = ref('')

function saved(result: { servers: ErrorServerView[] }) {
  servers.value = result.servers
  form.value = ''
}

async function remove(server: ErrorServerView) {
  if (!confirm(`Remove ${server.name}?`)) return
  error.value = ''
  try { servers.value = (await api<{ servers: ErrorServerView[] }>(`/admin/errors/servers/${server.id}`, { method: 'DELETE' })).servers } catch (cause: any) { error.value = cause.message || 'Could not remove the server' }
}

onMounted(async () => {
  try {
    const result = await api<{ servers: ErrorServerView[], providers: ErrorProviderView[] }>('/admin/errors/servers')
    servers.value = result.servers; providers.value = result.providers
  } catch (cause: any) { error.value = cause.message || 'Could not load error tracking servers' } finally { loading.value = false }
})
</script>
