<template>
  <UModal v-model:open="open" :title="settingsOnly ? 'Error tracking settings' : 'Connect error tracking'" :description="settingsOnly ? 'Where HelpBites reaches this project\'s tracker.' : 'Pick the Sentry-compatible tracker this project reports to. HelpBites creates the project there and turns new errors into inbox conversations.'">
    <template #body>
      <div v-if="connected?.errors.alertWebhookUrl" class="space-y-3">
        <p class="text-sm">Connected to {{ connected.errors.providerName }}. One step left: Bugsink can't add alert destinations through its API, so add this webhook by hand.</p>
        <ol class="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>In Bugsink, open <span class="text-default">Projects</span> and click the alerts (megaphone) icon next to {{ connected.name }}.</li>
          <li>Click <span class="text-default">Add</span>, set Kind to <span class="text-default">Custom</span> and paste this as the Webhook url.</li>
        </ol>
        <CodeBlock :code="connected.errors.alertWebhookUrl" lang="bash" />
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="soft" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" :label="copied ? 'Copied' : 'Copy URL'" @click="copy(connected.errors.alertWebhookUrl)" />
          <UButton label="Done" @click="open = false" />
        </div>
      </div>
      <form v-else class="space-y-4" @submit.prevent="submit">
        <p v-if="loading" class="text-sm text-muted">Checking which trackers are set up…</p>
        <div v-else class="grid gap-2" role="radiogroup" aria-label="Error tracker">
          <button v-for="provider in shown" :key="provider.id" type="button" role="radio" :aria-checked="selected === provider.id" class="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors" :class="selected === provider.id ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated'" @click="select(provider.id)">
            <UIcon :name="selected === provider.id ? 'i-lucide-circle-dot' : 'i-lucide-circle'" class="mt-0.5 size-4 shrink-0" :class="selected === provider.id ? 'text-primary' : 'text-dimmed'" />
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2"><span class="text-sm font-medium text-highlighted">{{ provider.name }}</span><UBadge :color="provider.configured ? 'success' : 'neutral'" variant="subtle" size="sm">{{ provider.configured ? sources[provider.source] : 'Not set up' }}</UBadge></span>
              <span class="mt-0.5 block text-xs text-muted">{{ blurbs[provider.id] }}</span>
            </span>
          </button>
        </div>
        <div v-if="current && editing" class="space-y-3">
          <UFormField label="Use for">
            <USelect v-model="scope" :items="scopeItems" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="URL" required :hint="saved ? 'Clear to remove' : undefined" description="The address people open, also used in DSNs.">
            <UInput v-model="form.url" type="url" :placeholder="`https://${current.id}.example.com`" class="w-full" />
          </UFormField>
          <UFormField v-if="current.required.includes('org')" label="Organisation slug" required>
            <UInput v-model="form.org" class="w-full" />
          </UFormField>
          <UFormField label="API token" :required="!saved?.hasToken" :description="tokenHelp[current.id]">
            <UInput v-model="form.token" type="password" autocomplete="off" :placeholder="saved?.hasToken ? 'Saved; leave blank to keep' : ''" class="w-full" />
          </UFormField>
          <UFormField label="API URL" hint="optional" :description="`Only when HelpBites reaches the tracker at another address, such as http://sb-${current.id}:8000 in Compose.`">
            <UInput v-model="form.apiUrl" type="url" class="w-full" />
          </UFormField>
        </div>
        <UButton v-else-if="current" color="neutral" variant="link" size="sm" class="px-0" label="Change URL or token" @click="editing = true" />
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
          <UButton type="submit" :loading="busy" :disabled="!current" :label="settingsOnly ? 'Save' : current ? `Connect ${current.name}` : 'Connect'" />
        </div>
      </form>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { AdminProject } from '~~/server/utils/projects'

type Scope = 'global' | 'project'
type Saved = { url: string, apiUrl: string, org: string, hasToken: boolean }
type Provider = { id: string, name: string, configured: boolean, source: '' | Scope | 'env', required: string[], manualAlerts: boolean, settings: Record<Scope, Saved | null> }

const open = defineModel<boolean>('open', { default: false })
/** With `provider`, the project is already connected: only its settings can change. */
const props = defineProps<{ projectId: string, provider?: string }>()
const emit = defineEmits<{ (event: 'connected', project: AdminProject): void }>()

const { api } = useAgent()
const blurbs: Record<string, string> = {
  glitchtip: 'Creates the project, DSN and an inbox alert automatically.',
  bugsink: 'Creates the project and DSN; you paste one alert webhook into Bugsink.'
}
const tokenHelp: Record<string, string> = {
  glitchtip: 'From /profile/auth-tokens, with org:read, team:write, project:admin and event:write.',
  bugsink: 'From Tokens in Bugsink, or bugsink-manage create_auth_token.'
}
const sources: Record<string, string> = { project: 'This project', global: 'All projects', env: 'Server env' }
const scopeItems = [{ label: 'All projects without their own settings', value: 'global' }, { label: 'Only this project', value: 'project' }]
const providers = ref<Provider[]>([])
const selected = ref('')
const editing = ref(false)
const scope = ref<Scope>('global')
const form = reactive({ url: '', org: '', token: '', apiUrl: '' })
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const connected = ref<AdminProject | null>(null)
const copied = ref(false)
const settingsOnly = computed(() => Boolean(props.provider))
const shown = computed(() => providers.value.filter(provider => !props.provider || provider.id === props.provider))
const current = computed(() => shown.value.find(provider => provider.id === selected.value))
const saved = computed(() => current.value?.settings[scope.value] || null)

function fill() {
  Object.assign(form, { url: saved.value?.url || '', org: saved.value?.org || '', token: '', apiUrl: saved.value?.apiUrl || '' })
}

function select(id: string) {
  selected.value = id
  const provider = current.value
  editing.value = settingsOnly.value || !provider?.configured
  scope.value = provider?.source === 'project' ? 'project' : 'global'
  fill()
}

watch(scope, fill)

watch(open, async (value) => {
  if (!value) return
  connected.value = null; copied.value = false; error.value = ''; loading.value = true
  try {
    providers.value = (await api<{ providers: Provider[] }>('/admin/errors/providers', { query: { project: props.projectId } })).providers
    select((shown.value.find(provider => provider.configured) || shown.value[0])?.id || '')
  } catch (cause: any) { error.value = cause.message || 'Could not load error trackers' } finally { loading.value = false }
}, { immediate: true })

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); copied.value = true } catch {}
}

async function submit() {
  busy.value = true; error.value = ''
  try {
    if (editing.value) {
      const body = { ...form, scope: scope.value, project: props.projectId }
      providers.value = (await api<{ providers: Provider[] }>(`/admin/errors/providers/${selected.value}`, { method: 'PUT', body })).providers
      editing.value = false
      if (settingsOnly.value) {
        open.value = false
        return
      }
    }
    const result = await api<{ project: AdminProject }>('/admin/errors/connect', { method: 'POST', body: { project: props.projectId, provider: selected.value } })
    emit('connected', result.project)
    if (result.project.errors.alertWebhookUrl) connected.value = result.project
    else open.value = false
  } catch (cause: any) { error.value = cause.message || 'Could not save error tracking' } finally { busy.value = false }
}
</script>
