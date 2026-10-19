<template>
  <div class="space-y-5">
    <div>
      <h2 class="text-[15px] font-semibold text-highlighted">Admin API keys</h2>
      <p class="mt-1 text-[13px] text-muted">A key acts as you, in this workspace only: it can do what you can here, through <code class="font-mono text-xs">/v1/admin</code>. Keep keys on your servers.</p>
    </div>

    <form class="space-y-3" @submit.prevent="create">
      <div class="flex gap-2">
        <UInput v-model="newName" class="flex-1" placeholder="Name it after where it runs, like “Production automation”" required maxlength="80" aria-label="New key name" />
        <UButton type="submit" icon="i-lucide-plus" :loading="creating" :disabled="scope === 'projects' && !pickedProjects.length">Create key</UButton>
      </div>
      <URadioGroup
        v-model="scope"
        :items="[
          { label: 'All projects and the main account', value: 'all', description: 'Every project, plus the team, API keys, assistants and settings of the workspace.' },
          { label: 'Only specific projects', value: 'projects', description: 'Just what happens inside the projects you pick. No access to the main account.' }
        ]"
      />
      <UFormField label="Expires" class="max-w-56"><USelect v-model="expiry" :items="expiryItems" class="w-full" aria-label="Key expiry" /></UFormField>
      <UCheckboxGroup v-if="scope === 'projects'" v-model="pickedProjects" :items="projects.map(project => ({ label: project.name, value: project.id }))" aria-label="Projects the key can access" />
    </form>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

    <!-- Shown once, in place: a second modal on top of the settings one would be one too many. -->
    <div v-if="createdKey" class="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div>
        <p class="text-[13px] font-medium text-highlighted">Copy this key now</p>
        <p class="text-xs text-muted">It won't be shown again. Store it where the service that uses it can read it.</p>
      </div>
      <div class="flex gap-2">
        <UInput :model-value="createdKey" readonly class="min-w-0 flex-1 font-mono text-xs" aria-label="New API key" />
        <UButton icon="i-lucide-clipboard" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</UButton>
        <UButton color="neutral" variant="ghost" @click="createdKey = ''">Done</UButton>
      </div>
    </div>

    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-12" /></div>
    <EmptyState v-else-if="!keys.length" icon="i-lucide-key-round" title="No API keys yet" description="Create one for each script or service that calls the admin API, so you can revoke them one at a time." class="rounded-xl border border-dashed border-default" />
    <ul v-else class="divide-y divide-default overflow-hidden rounded-xl border border-default">
      <li v-for="key in keys" :key="key.id" class="flex min-h-14 items-center gap-3 px-4 py-2">
        <template v-if="editingId === key.id">
          <UInput v-model="editingName" size="sm" class="flex-1" aria-label="API key name" autofocus @keydown.enter.prevent="rename(key.id)" @keydown.esc.stop="editingId = ''" />
          <UButton size="sm" @click="rename(key.id)">Save</UButton>
          <UButton size="sm" color="neutral" variant="ghost" @click="editingId = ''">Cancel</UButton>
        </template>
        <template v-else>
          <UIcon name="i-lucide-key-round" class="size-4 shrink-0 text-muted" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-medium text-highlighted">{{ key.name }}</span>
            <code class="block font-mono text-xs text-muted">{{ key.prefix }}…</code>
          </span>
          <span class="hidden truncate text-xs text-muted sm:block">{{ scopeLabel(key) }}</span>
          <span class="hidden text-xs text-muted sm:block">{{ expiryLabel(key) }}</span>
          <span class="hidden text-xs text-muted sm:block">Created {{ new Date(key.createdAt || '').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }}</span>
          <UTooltip text="Rename"><UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-pencil" class="text-muted" aria-label="Rename" @click="edit(key)" /></UTooltip>
          <UTooltip text="Revoke"><UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-trash-2" class="text-muted" aria-label="Revoke" @click="revoke(key)" /></UTooltip>
        </template>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
type ApiKey = { id: string, name: string, prefix: string, createdAt: string | null, expiresAt: string | null, lastUsedAt: string | null, projectIds: string[] | null }
const { api, projects, loadProjects } = useAgent()
const scope = ref<'all' | 'projects'>('all')
const pickedProjects = ref<string[]>([])
const expiry = ref('90')
const expiryItems = [
  { label: 'In 30 days', value: '30' },
  { label: 'In 90 days', value: '90' },
  { label: 'In a year', value: '365' },
  { label: 'Never', value: 'never' }
]
const keys = ref<ApiKey[]>([])
const newName = ref('')
const createdKey = ref('')
const loading = ref(true)
const creating = ref(false)
const editingId = ref('')
const editingName = ref('')
const error = ref('')
const copied = ref(false)

async function create() {
  creating.value = true
  error.value = ''
  try {
    const result = await api<{ apiKey: ApiKey, key: string }>('/admin/api-keys', { method: 'POST', body: { name: newName.value, projectIds: scope.value === 'projects' ? pickedProjects.value : undefined, expiresInDays: expiry.value === 'never' ? null : Number(expiry.value) } })
    keys.value.unshift(result.apiKey)
    newName.value = ''
    scope.value = 'all'
    pickedProjects.value = []
    createdKey.value = result.key
    copied.value = false
  } catch (e: any) {
    error.value = e?.message || 'Could not create the API key'
  } finally {
    creating.value = false
  }
}

function expiryLabel(key: ApiKey) {
  const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const expires = key.expiresAt ? (new Date(key.expiresAt).getTime() <= Date.now() ? `Expired ${date(key.expiresAt)}` : `Expires ${date(key.expiresAt)}`) : 'Never expires'
  return key.lastUsedAt ? `${expires} · used ${date(key.lastUsedAt)}` : expires
}

function scopeLabel(key: ApiKey) {
  if (!key.projectIds) return 'All projects'
  const names = key.projectIds.map(id => projects.value.find(project => project.id === id)?.name).filter(Boolean)
  return names.length ? names.join(', ') : `${key.projectIds.length} project${key.projectIds.length === 1 ? '' : 's'}`
}

function edit(key: ApiKey) {
  editingId.value = key.id
  editingName.value = key.name
}

async function rename(id: string) {
  try {
    const { apiKey } = await api<{ apiKey: ApiKey }>(`/admin/api-keys/${id}`, { method: 'PATCH', body: { name: editingName.value } })
    keys.value = keys.value.map(key => key.id === id ? apiKey : key)
    editingId.value = ''
  } catch (e: any) {
    error.value = e?.message || 'Could not rename the API key'
  }
}

async function revoke(key: ApiKey) {
  if (!confirm(`Revoke ${key.name}? This cannot be undone.`)) return
  try {
    await api(`/admin/api-keys/${key.id}`, { method: 'DELETE' })
    keys.value = keys.value.filter(item => item.id !== key.id)
  } catch (e: any) {
    error.value = e?.message || 'Could not revoke the API key'
  }
}

async function copy() {
  await navigator.clipboard.writeText(createdKey.value)
  copied.value = true
}

onMounted(async () => {
  if (!projects.value.length) await loadProjects().catch(() => {})
  try {
    keys.value = (await api<{ keys: ApiKey[] }>('/admin/api-keys')).keys
  } catch (e: any) {
    error.value = e?.message || 'Could not load API keys'
  }
  loading.value = false
})
</script>
