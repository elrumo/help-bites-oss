<template>
  <form class="space-y-3 rounded-xl border border-default p-4" @submit.prevent="submit">
    <UFormField v-if="!server" label="Tracker">
      <USelect v-model="form.provider" :items="providers.map(item => ({ label: item.name, value: item.id }))" value-key="value" class="w-full" />
    </UFormField>
    <UFormField label="Name" hint="optional"><UInput v-model="form.name" class="w-full" maxlength="60" placeholder="Production errors" /></UFormField>
    <UFormField label="URL" required description="The address people open, also used in DSNs."><UInput v-model="form.url" type="url" required :placeholder="`https://${form.provider}.example.com`" class="w-full" /></UFormField>
    <UFormField v-if="provider?.required.includes('org')" label="Organisation slug" required><UInput v-model="form.org" class="w-full" /></UFormField>
    <UFormField label="API token" :required="!server?.hasToken" :description="tokenHelp[form.provider]">
      <UInput v-model="form.token" type="password" autocomplete="off" :placeholder="server?.hasToken ? 'Saved; leave blank to keep' : ''" class="w-full" />
    </UFormField>
    <UFormField label="API URL" hint="optional" :description="`Only when HelpBites reaches the tracker at another address, such as http://sb-${form.provider}:8000 in Compose.`"><UInput v-model="form.apiUrl" type="url" class="w-full" /></UFormField>
    <p v-if="error" class="text-sm text-error">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <UButton v-if="cancellable" color="neutral" variant="ghost" @click="emit('cancel')">Cancel</UButton>
      <UButton type="submit" :loading="busy" :label="server ? 'Save' : 'Add server'" />
    </div>
  </form>
</template>

<script setup lang="ts">
export type ErrorServerView = { id: string, provider: string, providerName: string, name: string, url: string, apiUrl: string, org: string, hasToken: boolean, builtIn: boolean }
export type ErrorProviderView = { id: string, name: string, required: string[], manualAlerts: boolean }

const props = defineProps<{ providers: ErrorProviderView[], server?: ErrorServerView, cancellable?: boolean }>()
const emit = defineEmits<{ (event: 'saved', result: { id: string, servers: ErrorServerView[] }): void, (event: 'cancel'): void }>()

const { api } = useAgent()
const tokenHelp: Record<string, string> = {
  glitchtip: 'From /profile/auth-tokens, with org:read, team:write, project:admin and event:write.',
  bugsink: 'From Tokens in Bugsink, or bugsink-manage create_auth_token.'
}
const form = reactive({ provider: props.server?.provider || props.providers[0]?.id || 'glitchtip', name: props.server?.name || '', url: props.server?.url || '', org: props.server?.org || '', token: '', apiUrl: props.server?.apiUrl || '' })
const provider = computed(() => props.providers.find(item => item.id === form.provider))
const busy = ref(false)
const error = ref('')

async function submit() {
  busy.value = true; error.value = ''
  try {
    emit('saved', await api(props.server ? `/admin/errors/servers/${props.server.id}` : '/admin/errors/servers', { method: props.server ? 'PUT' : 'POST', body: { ...form } }))
  } catch (cause: any) { error.value = cause.message || 'Could not save the server' } finally { busy.value = false }
}
</script>
