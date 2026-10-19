<template>
  <form class="space-y-3 rounded-xl border border-default p-4" @submit.prevent="submit">
    <UFormField v-if="!server" :label="$t('workspaceSettings.errorServerForm.tracker')">
      <USelect v-model="form.provider" :items="providers.map(item => ({ label: item.name, value: item.id }))" value-key="value" class="w-full" />
    </UFormField>
    <UFormField :label="$t('common.name')" :hint="$t('workspaceSettings.optional')"><UInput v-model="form.name" class="w-full" maxlength="60" :placeholder="$t('workspaceSettings.errorServerForm.namePlaceholder')" /></UFormField>
    <UFormField label="URL" required :description="$t('workspaceSettings.errorServerForm.urlDescription')"><UInput v-model="form.url" type="url" required :placeholder="`https://${form.provider}.example.com`" class="w-full" /></UFormField>
    <UFormField v-if="provider?.required.includes('org')" :label="$t('workspaceSettings.errorServerForm.orgSlug')" required><UInput v-model="form.org" class="w-full" /></UFormField>
    <UFormField :label="$t('workspaceSettings.errorServerForm.apiToken')" :required="!server?.hasToken" :description="tokenHelp[form.provider]">
      <UInput v-model="form.token" type="password" autocomplete="off" :placeholder="server?.hasToken ? $t('workspaceSettings.keyKept') : ''" class="w-full" />
    </UFormField>
    <UFormField label="API URL" :hint="$t('workspaceSettings.optional')" :description="$t('workspaceSettings.errorServerForm.apiUrlDescription', { example: `http://sb-${form.provider}:8000` })"><UInput v-model="form.apiUrl" type="url" class="w-full" /></UFormField>
    <p v-if="error" class="text-sm text-error">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <UButton v-if="cancellable" color="neutral" variant="ghost" @click="emit('cancel')">{{ $t('common.cancel') }}</UButton>
      <UButton type="submit" :loading="busy" :label="server ? $t('workspaceSettings.save') : $t('workspaceSettings.errorServers.addServer')" />
    </div>
  </form>
</template>

<script setup lang="ts">
export type ErrorServerView = { id: string, provider: string, providerName: string, name: string, url: string, apiUrl: string, org: string, hasToken: boolean, builtIn: boolean }
export type ErrorProviderView = { id: string, name: string, required: string[], manualAlerts: boolean }

const props = defineProps<{ providers: ErrorProviderView[], server?: ErrorServerView, cancellable?: boolean }>()
const emit = defineEmits<{ (event: 'saved', result: { id: string, servers: ErrorServerView[] }): void, (event: 'cancel'): void }>()

const { api } = useAgent()
const { t } = useI18n()
const tokenHelp = computed<Record<string, string>>(() => ({
  glitchtip: t('workspaceSettings.errorServerForm.glitchtipTokenHelp'),
  bugsink: t('workspaceSettings.errorServerForm.bugsinkTokenHelp')
}))
const form = reactive({ provider: props.server?.provider || props.providers[0]?.id || 'glitchtip', name: props.server?.name || '', url: props.server?.url || '', org: props.server?.org || '', token: '', apiUrl: props.server?.apiUrl || '' })
const provider = computed(() => props.providers.find(item => item.id === form.provider))
const busy = ref(false)
const error = ref('')

async function submit() {
  busy.value = true; error.value = ''
  try {
    emit('saved', await api(props.server ? `/admin/errors/servers/${props.server.id}` : '/admin/errors/servers', { method: props.server ? 'PUT' : 'POST', body: { ...form } }))
  } catch (cause: any) { error.value = cause.message || t('workspaceSettings.errorServerForm.saveFailed') } finally { busy.value = false }
}
</script>
