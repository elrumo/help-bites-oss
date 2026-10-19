<template>
  <UModal v-model:open="open" title="Connect error tracking" description="Pick the GlitchTip or Bugsink server this project reports to. HelpBites creates the project there and turns new errors into inbox conversations.">
    <template #body>
      <div v-if="connected?.errors.alertWebhookUrl" class="space-y-3">
        <p class="text-sm">Connected to {{ connected.errors.providerName }}. One step left: Bugsink can't add alert destinations through its API, so add this webhook by hand.</p>
        <ol class="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>In Bugsink, open <span class="text-default">Projects</span>, find {{ connected.name }} (under <span class="text-default">Team Projects</span>, or <span class="text-default">Other Projects</span> if you aren't in its team) and click its alerts (megaphone) icon.</li>
          <li>Click <span class="text-default">Add</span>, set Kind to <span class="text-default">Slack</span> (HelpBites reads Slack-format alerts) and paste this as the Webhook url. Leave Discord and Mattermost alone.</li>
        </ol>
        <CodeBlock :code="connected.errors.alertWebhookUrl" lang="bash" />
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="soft" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" :label="copied ? 'Copied' : 'Copy URL'" @click="copy(connected.errors.alertWebhookUrl)" />
          <UButton label="Done" @click="open = false" />
        </div>
      </div>
      <!-- Not a <form>: the add-server form inside is one. -->
      <div v-else class="space-y-4">
        <p v-if="loading" class="text-sm text-muted">Loading error tracking servers…</p>
        <template v-else>
          <div v-if="servers.length" class="grid gap-2" role="radiogroup" aria-label="Error tracking server">
            <button v-for="server in servers" :key="server.id" type="button" role="radio" :aria-checked="selected === server.id" class="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors" :class="selected === server.id ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated'" @click="selected = server.id; adding = false">
              <UIcon :name="selected === server.id ? 'i-lucide-circle-dot' : 'i-lucide-circle'" class="mt-0.5 size-4 shrink-0" :class="selected === server.id ? 'text-primary' : 'text-dimmed'" />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2"><span class="truncate text-sm font-medium text-highlighted">{{ server.name }}</span><UBadge color="neutral" variant="subtle" size="sm">{{ server.providerName }}</UBadge></span>
                <span class="mt-0.5 block truncate text-xs text-muted">{{ blurbs[server.provider] }}</span>
              </span>
            </button>
          </div>
          <UFormField v-if="current?.provider === 'bugsink' && teams.length && !adding" label="Team" description="Pick a team you belong to so the project shows under Team Projects in Bugsink.">
            <USelect v-model="team" :items="teams" class="w-full" />
          </UFormField>
          <SettingsErrorServerForm v-if="adding || !servers.length" :providers="providers" :cancellable="servers.length > 0" @saved="added" @cancel="adding = false" />
          <UButton v-else color="neutral" variant="link" size="sm" class="px-0" icon="i-lucide-plus" label="Add another server" @click="adding = true" />
        </template>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
          <UButton :loading="busy" :disabled="!current || adding" :label="current ? `Connect ${current.name}` : 'Connect'" @click="submit" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { AdminProject } from '~~/server/utils/projects'
import type { ErrorProviderView, ErrorServerView } from '~/components/settings/ErrorServerForm.vue'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ (event: 'connected', project: AdminProject): void }>()

const { api } = useAgent()
const blurbs: Record<string, string> = {
  glitchtip: 'Creates the project, DSN and an inbox alert automatically.',
  bugsink: 'Creates the project and DSN; you paste one alert webhook into Bugsink.'
}
const servers = ref<ErrorServerView[]>([])
const providers = ref<ErrorProviderView[]>([])
const selected = ref('')
const adding = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const connected = ref<AdminProject | null>(null)
const copied = ref(false)
const teams = ref<string[]>([])
const team = ref('')
const current = computed(() => servers.value.find(server => server.id === selected.value))

watch(current, async (server) => {
  teams.value = []; team.value = ''
  if (server?.provider !== 'bugsink') return
  try {
    const result = await api<{ default: string, teams: string[] }>(`/admin/errors/servers/${encodeURIComponent(server.id)}/teams`)
    if (current.value?.id !== server.id) return
    teams.value = result.teams; team.value = result.default
  } catch {} // the default team is used and connecting reports any real problem
})

function added(result: { id: string, servers: ErrorServerView[] }) {
  servers.value = result.servers
  selected.value = result.id
  adding.value = false
}

watch(open, async (value) => {
  if (!value) return
  connected.value = null; copied.value = false; error.value = ''; adding.value = false; loading.value = true
  try {
    const result = await api<{ servers: ErrorServerView[], providers: ErrorProviderView[] }>('/admin/errors/servers')
    servers.value = result.servers; providers.value = result.providers
    selected.value = servers.value[0]?.id || ''
  } catch (cause: any) { error.value = cause.message || 'Could not load error tracking servers' } finally { loading.value = false }
}, { immediate: true })

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); copied.value = true } catch {}
}

async function submit() {
  busy.value = true; error.value = ''
  try {
    const result = await api<{ project: AdminProject }>('/admin/errors/connect', { method: 'POST', body: { project: props.projectId, server: selected.value, team: team.value } })
    emit('connected', result.project)
    if (result.project.errors.alertWebhookUrl) connected.value = result.project
    else open.value = false
  } catch (cause: any) { error.value = cause.message || 'Could not connect error tracking' } finally { busy.value = false }
}
</script>
