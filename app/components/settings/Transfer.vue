<template>
  <div v-if="!demo" class="space-y-2">
    <p class="section-label">{{ projectId ? $t('workspaceSettings.transfer.projectTitle') : $t('workspaceSettings.transfer.title') }}</p>

    <div class="flex items-center gap-3 rounded-xl border border-default px-4 py-3">
      <div class="min-w-0 flex-1">
        <p class="text-[13px] font-medium text-highlighted">{{ projectId ? $t('workspaceSettings.transfer.downloadProject') : $t('workspaceSettings.transfer.downloadWorkspace') }}</p>
        <p class="text-xs text-muted">{{ $t('workspaceSettings.transfer.downloadHint') }}</p>
      </div>
      <UButton :label="$t('workspaceSettings.transfer.download')" icon="i-lucide-download" color="neutral" variant="outline" size="sm" class="shrink-0" :loading="downloading" @click="download" />
    </div>

    <div class="space-y-3 rounded-xl border border-default px-4 py-3">
      <UFormField :label="$t('workspaceSettings.transfer.filesLabel')" :hint="$t('workspaceSettings.transfer.filesHint')">
        <USelect v-model="files" class="w-full" :items="filesItems" />
      </UFormField>
      <UCheckbox v-model="secrets" :label="$t('workspaceSettings.transfer.secretsLabel')" :description="$t('workspaceSettings.transfer.secretsHint')" />
    </div>

    <template v-if="!projectId">
      <div class="flex items-center gap-3 rounded-xl border border-default px-4 py-3">
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-medium text-highlighted">{{ $t('workspaceSettings.transfer.importTitle') }}</p>
          <p class="text-xs text-muted">{{ $t('workspaceSettings.transfer.importHint') }}</p>
        </div>
        <div class="flex shrink-0 gap-2">
          <UButton :label="$t('workspaceSettings.transfer.fromFile')" icon="i-lucide-upload" color="neutral" variant="outline" size="sm" :loading="uploading" :disabled="busy" @click="fileInput?.click()" />
          <UButton :label="$t('workspaceSettings.transfer.fromInstance')" icon="i-lucide-cloud-download" color="neutral" variant="outline" size="sm" :disabled="busy" @click="openConnect" />
        </div>
        <input ref="fileInput" type="file" accept=".gz,.jsonl,.ndjson,application/gzip" class="hidden" @change="upload">
      </div>

      <ul v-if="transfers.length" class="divide-y divide-default rounded-xl border border-default">
        <li v-for="item in transfers" :key="item.id" class="space-y-1 px-4 py-3">
          <div class="flex items-center gap-2 text-[13px]">
            <UIcon :name="icon(item.status)" class="size-4 shrink-0" :class="[item.status === 'failed' ? 'text-error' : item.status === 'done' ? 'text-success' : 'animate-pulse text-muted']" />
            <span class="font-medium text-highlighted">{{ item.source === 'file' ? $t('workspaceSettings.transfer.aFile') : $t('workspaceSettings.transfer.aHost', { host: item.host }) }}</span>
            <span class="text-xs text-muted">{{ item.scope === 'project' ? $t('workspaceSettings.transfer.oneProject') : $t('workspaceSettings.transfer.wholeWorkspace') }} · {{ timeAgo(item.createdAt) }}</span>
          </div>
          <p v-if="item.status === 'queued'" class="text-xs text-muted">{{ $t('workspaceSettings.transfer.queued') }}</p>
          <p v-else-if="item.status === 'running'" class="text-xs text-muted">{{ item.progress ? $t('workspaceSettings.transfer.runningOn', { class: item.progress.className, count: total(item.progress.rows) }) : $t('workspaceSettings.transfer.running') }}</p>
          <p v-else-if="item.status === 'failed'" class="text-xs text-error">{{ item.error }} {{ $t('workspaceSettings.transfer.nothingKept') }}</p>
          <div v-else-if="item.summary" class="space-y-1 text-xs text-muted">
            <p>{{ $t('workspaceSettings.transfer.done', { rows: total(item.summary.rows), projects: item.summary.projects.length }) }}</p>
            <p v-for="project in item.summary.projects.filter(p => !p.keptKey)" :key="project.publicKey" class="text-warning">{{ $t('workspaceSettings.transfer.newKey', { name: project.name, key: project.publicKey }) }}</p>
            <p v-if="item.summary.files">{{ $t('workspaceSettings.transfer.filesStored', { count: item.summary.files.stored, size: megabytes(item.summary.files.bytes) }) }}</p>
            <p v-if="item.summary.notes.includes('fileLinks')">{{ $t('workspaceSettings.transfer.fileLinks') }}</p>
            <p v-if="item.summary.projects.some(p => p.keptSecret === false)">{{ $t('workspaceSettings.transfer.secrets') }}</p>
            <p v-if="item.summary.projects.length && !item.secrets">{{ $t('workspaceSettings.transfer.connectionsAgain') }}</p>
            <p v-if="item.summary.notes.includes('sequences')">{{ $t('workspaceSettings.transfer.sequencesPaused') }}</p>
            <p v-for="(skipped, name) in item.summary.skipped" :key="name">{{ $t('workspaceSettings.transfer.skipped', { count: skipped.count, class: name, reason: skipped.reason }) }}</p>
          </div>
        </li>
      </ul>
    </template>

    <UModal v-model:open="connectOpen" :title="$t('workspaceSettings.transfer.connectTitle')" :ui="{ content: 'sm:max-w-md' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="found ? start() : inspect()">
          <p class="text-[13px] text-muted">{{ $t('workspaceSettings.transfer.connectHint') }}</p>
          <UFormField :label="$t('workspaceSettings.transfer.address')">
            <UInput v-model="source.url" class="w-full" type="url" placeholder="https://help.example.com" autocomplete="off" required :disabled="!!found" />
          </UFormField>
          <template v-if="!found">
            <div class="flex gap-1 rounded-lg bg-elevated p-1 text-[13px]">
              <button v-for="mode in ['key', 'login'] as const" :key="mode" type="button" class="flex-1 rounded-md px-2 py-1" :class="auth === mode ? 'bg-default font-medium text-highlighted shadow-sm' : 'text-muted'" @click="auth = mode">{{ $t(`workspaceSettings.transfer.auth.${mode}`) }}</button>
            </div>
            <UFormField v-if="auth === 'key'" :label="$t('workspaceSettings.transfer.apiKey')" :hint="$t('workspaceSettings.transfer.apiKeyHint')">
              <UInput v-model="source.apiKey" class="w-full" type="password" placeholder="ak_…" autocomplete="off" required />
            </UFormField>
            <template v-else>
              <UFormField :label="$t('workspaceSettings.transfer.login')"><UInput v-model="source.login" class="w-full" autocomplete="off" required /></UFormField>
              <UFormField :label="$t('workspaceSettings.transfer.password')"><UInput v-model="source.password" class="w-full" type="password" autocomplete="off" required /></UFormField>
            </template>
          </template>
          <template v-else>
            <p class="rounded-lg bg-elevated px-3 py-2 text-[13px]">{{ $t('workspaceSettings.transfer.connected', { host: found.host, workspace: found.workspace.name }) }}</p>
            <UFormField v-if="found.workspaces.length > 1" :label="$t('workspaceSettings.transfer.sourceWorkspace')">
              <USelect v-model="source.workspaceId" class="w-full" :items="found.workspaces.map(w => ({ label: w.name, value: w.id }))" @update:model-value="inspect" />
            </UFormField>
            <UFormField :label="$t('workspaceSettings.transfer.whatToImport')">
              <USelect v-model="projectId" class="w-full" :items="[{ label: $t('workspaceSettings.transfer.everything'), value: '' }, ...found.projects.map(p => ({ label: p.name, value: p.id }))]" />
            </UFormField>
            <UFormField :label="$t('workspaceSettings.transfer.filesLabel')" :hint="$t('workspaceSettings.transfer.filesPullHint')">
              <USelect v-model="files" class="w-full" :items="filesItems" />
            </UFormField>
            <UCheckbox v-model="secrets" :label="$t('workspaceSettings.transfer.secretsLabel')" :description="$t('workspaceSettings.transfer.secretsHint')" />
            <p class="text-xs text-muted">{{ $t('workspaceSettings.transfer.willCreate') }}</p>
          </template>
          <p v-if="connectError" class="text-[13px] text-error">{{ connectError }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="connectOpen = false">{{ $t('common.cancel') }}</UButton>
            <UButton v-if="found" color="neutral" variant="ghost" @click="found = null">{{ $t('workspaceSettings.transfer.back') }}</UButton>
            <UButton type="submit" :loading="connecting">{{ found ? $t('workspaceSettings.transfer.startImport') : $t('workspaceSettings.transfer.connect') }}</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { TransferStatus, TransferSummary } from '#shared/transfer'

const props = defineProps<{ projectId?: string }>()

type Transfer = { id: string, source: 'file' | 'instance', host: string, files: 'urls' | 'binary', secrets: boolean, scope: 'workspace' | 'project', status: TransferStatus, progress: { className: string, rows: Record<string, number> } | null, summary: TransferSummary | null, error: string, createdAt: string }
type Found = { host: string, workspace: { id: string, name: string }, workspaces: { id: string, name: string }[], projects: { id: string, name: string }[] }

const { api, agentHeaders, demo } = useAgent()
const toast = useToast()
const { t } = useI18n()

// What goes into an export or a pull: uploaded files as links or the files themselves, and whether credentials come along.
const files = ref<'urls' | 'binary'>('urls')
const secrets = ref(false)
const filesItems = computed(() => (['urls', 'binary'] as const).map(value => ({ label: t(`workspaceSettings.transfer.files.${value}`), value })))
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const total = (rows: Record<string, number>) => Object.values(rows).reduce((sum, n) => sum + n, 0)
const icon = (status: TransferStatus) => status === 'done' ? 'i-lucide-circle-check' : status === 'failed' ? 'i-lucide-circle-alert' : 'i-lucide-loader'

// ---- download ------------------------------------------------------------------

const downloading = ref(false)

async function download() {
  downloading.value = true
  try {
    const response = await fetch(`/v1/admin/transfers/export?${new URLSearchParams({ ...(props.projectId ? { project: props.projectId } : {}), files: files.value, ...(secrets.value ? { secrets: '1' } : {}) })}`, { headers: agentHeaders() })
    if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { statusMessage?: string }).statusMessage || t('workspaceSettings.transfer.downloadFailed'))
    const link = document.createElement('a')
    link.href = URL.createObjectURL(await response.blob())
    link.download = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || 'helpbites-export.jsonl.gz'
    link.click()
    URL.revokeObjectURL(link.href)
  } catch (e: any) {
    toast.add({ title: e?.message || t('workspaceSettings.transfer.downloadFailed'), color: 'error' })
  } finally {
    downloading.value = false
  }
}

// ---- recent imports -------------------------------------------------------------

const transfers = ref<Transfer[]>([])
const busy = computed(() => transfers.value.some(item => item.status === 'queued' || item.status === 'running'))
let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  transfers.value = (await api<{ transfers: Transfer[] }>('/admin/transfers').catch(() => null))?.transfers || transfers.value
}

watch(busy, (on) => {
  clearInterval(timer)
  if (on) timer = setInterval(load, 3000)
})
onMounted(() => { if (!props.projectId) load() })
onBeforeUnmount(() => clearInterval(timer))

// ---- from a file ----------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    const response = await fetch('/v1/admin/transfers/upload', { method: 'POST', headers: { ...agentHeaders(), 'Content-Type': 'application/octet-stream' }, body: file })
    if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { statusMessage?: string }).statusMessage || t('workspaceSettings.transfer.importFailed'))
    toast.add({ title: t('workspaceSettings.transfer.started') })
    await load()
  } catch (e: any) {
    toast.add({ title: e?.message || t('workspaceSettings.transfer.importFailed'), color: 'error' })
  } finally {
    uploading.value = false
  }
}

// ---- from another HelpBites -------------------------------------------------------

const connectOpen = ref(false)
const auth = ref<'key' | 'login'>('key')
const source = reactive({ url: '', apiKey: '', login: '', password: '', workspaceId: '' })
const found = ref<Found | null>(null)
const projectId = ref('')
const connecting = ref(false)
const connectError = ref('')

function openConnect() {
  Object.assign(source, { url: '', apiKey: '', login: '', password: '', workspaceId: '' })
  found.value = null
  projectId.value = ''
  connectError.value = ''
  connectOpen.value = true
}

/** The credentials for the chosen way of signing in, nothing else. */
const credentials = () => ({ url: source.url, workspaceId: source.workspaceId, ...(auth.value === 'key' ? { apiKey: source.apiKey } : { login: source.login, password: source.password }) })

async function inspect() {
  connecting.value = true
  connectError.value = ''
  projectId.value = ''
  try {
    found.value = await api<Found>('/admin/transfers/inspect', { method: 'POST', body: credentials() })
    source.workspaceId = found.value.workspace.id
  } catch (e: any) {
    connectError.value = e?.message || t('workspaceSettings.transfer.connectFailed')
  } finally {
    connecting.value = false
  }
}

async function start() {
  connecting.value = true
  connectError.value = ''
  try {
    await api('/admin/transfers', { method: 'POST', body: { source: credentials(), projectId: projectId.value, files: files.value, secrets: secrets.value } })
    // The login is kept on the server only until the import ends; none stays in this page.
    Object.assign(source, { apiKey: '', password: '' })
    connectOpen.value = false
    toast.add({ title: t('workspaceSettings.transfer.started') })
    await load()
  } catch (e: any) {
    connectError.value = e?.message || t('workspaceSettings.transfer.importFailed')
  } finally {
    connecting.value = false
  }
}
</script>
