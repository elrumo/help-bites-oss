<template>
  <UModal v-model:open="open" :title="$t('errors.connect.title')" :description="existing.length ? $t('errors.connect.addAnother') : $t('errors.connect.pickServer')">
    <template #body>
      <div v-if="link?.alertWebhookUrl" class="space-y-3">
        <p class="text-sm">{{ $t('errors.connect.connectedTo', { provider: link.providerName }) }}</p>
        <ol class="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>{{ $t('errors.connect.bugsinkStep1', { link: link.label }) }}</li>
          <li>{{ $t('errors.connect.bugsinkStep2') }}</li>
        </ol>
        <CodeBlock :code="link.alertWebhookUrl" lang="bash" />
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="soft" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" :label="copied ? $t('workspaceSettings.copied') : $t('errors.connect.copyUrl')" @click="copy(link.alertWebhookUrl)" />
          <UButton :label="$t('workspaceSettings.done')" @click="open = false" />
        </div>
      </div>
      <!-- Not a <form>: the add-server form inside is one. -->
      <div v-else class="space-y-4">
        <p v-if="loading" class="text-sm text-muted">{{ $t('errors.connect.loading') }}</p>
        <template v-else>
          <div v-if="servers.length" class="grid gap-2" role="radiogroup" :aria-label="$t('errors.connect.serverAria')">
            <button v-for="server in servers" :key="server.id" type="button" role="radio" :aria-checked="selected === server.id" class="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors" :class="selected === server.id ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated'" @click="selected = server.id; adding = false">
              <UIcon :name="selected === server.id ? 'i-lucide-circle-dot' : 'i-lucide-circle'" class="mt-0.5 size-4 shrink-0" :class="selected === server.id ? 'text-primary' : 'text-dimmed'" />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2"><span class="truncate text-sm font-medium text-highlighted">{{ server.name }}</span><UBadge color="neutral" variant="subtle" size="sm">{{ server.providerName }}</UBadge></span>
                <span class="mt-0.5 block truncate text-xs text-muted">{{ blurbs[server.provider] }}</span>
              </span>
            </button>
          </div>
          <UFormField v-if="current && !adding" :label="$t('errors.connect.projectName', { provider: current.providerName })" :description="existing.length ? $t('errors.connect.alreadyConnected', { list: existing.map(item => item.label).join(', ') }) : $t('errors.connect.createdIfNeeded')">
            <UInput v-model="name" class="w-full" :placeholder="project?.name" />
          </UFormField>
          <UFormField v-if="current?.provider === 'bugsink' && teams.length && !adding" :label="$t('errors.manage.team')" :description="$t('errors.connect.teamHelp')">
            <USelect v-model="team" :items="teams" class="w-full" />
          </UFormField>
          <SettingsErrorServerForm v-if="adding || !servers.length" :providers="providers" :cancellable="servers.length > 0" @saved="added" @cancel="adding = false" />
          <UButton v-else color="neutral" variant="link" size="sm" class="px-0" icon="i-lucide-plus" :label="$t('errors.connect.addServer')" @click="adding = true" />
        </template>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" @click="open = false">{{ $t('common.cancel') }}</UButton>
          <UButton :loading="busy" :disabled="!current || adding || (existing.length > 0 && !name.trim())" :label="current ? $t('errors.connect.connectName', { name: current.name }) : $t('workspaceSettings.connect')" @click="submit" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { AdminProject } from '~~/server/utils/projects'
import type { ErrorLinkView } from '~~/server/utils/errorTracking'
import type { ErrorProviderView, ErrorServerView } from '~/components/settings/ErrorServerForm.vue'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ (event: 'connected', project: AdminProject): void }>()

const { api, projects } = useAgent()
const { t } = useI18n()
const blurbs = computed<Record<string, string>>(() => ({
  glitchtip: t('errors.connect.blurbGlitchtip'),
  bugsink: t('errors.connect.blurbBugsink')
}))
const servers = ref<ErrorServerView[]>([])
const providers = ref<ErrorProviderView[]>([])
const selected = ref('')
const adding = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const link = ref<ErrorLinkView | null>(null)
const name = ref('')
const project = computed(() => projects.value.find(item => item.id === props.projectId))
const existing = computed(() => project.value?.errorLinks || [])
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
  link.value = null; copied.value = false; name.value = existing.value.length ? '' : project.value?.name || ''; error.value = ''; adding.value = false; loading.value = true
  try {
    const result = await api<{ servers: ErrorServerView[], providers: ErrorProviderView[] }>('/admin/errors/servers')
    servers.value = result.servers; providers.value = result.providers
    selected.value = servers.value[0]?.id || ''
  } catch (cause: any) { error.value = cause.message || t('errors.connect.loadFailed') } finally { loading.value = false }
}, { immediate: true })

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); copied.value = true } catch {}
}

async function submit() {
  busy.value = true; error.value = ''
  try {
    const result = await api<{ project: AdminProject, link: ErrorLinkView }>('/admin/errors/connect', { method: 'POST', body: { project: props.projectId, server: selected.value, team: team.value, name: name.value.trim() } })
    emit('connected', result.project)
    if (result.link.alertWebhookUrl) link.value = result.link
    else open.value = false
  } catch (cause: any) { error.value = cause.message || t('errors.connect.connectFailed') } finally { busy.value = false }
}
</script>
