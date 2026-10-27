<template>
  <div class="space-y-5">
    <div>
      <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('workspaceSettings.apiKeys.title') }}</h2>
      <i18n-t keypath="workspaceSettings.apiKeys.intro" tag="p" class="mt-1 text-[13px] text-muted">
        <template #path><code class="font-mono text-xs">/v1/admin</code></template>
      </i18n-t>
    </div>

    <div class="space-y-3 rounded-xl border border-default p-4">
      <div class="flex items-start gap-3">
        <UIcon name="i-lucide-plug-zap" class="mt-0.5 size-4 shrink-0 text-muted" />
        <div class="min-w-0">
          <h3 class="text-[13px] font-medium text-highlighted">{{ $t('workspaceSettings.apiKeys.mcpTitle') }}</h3>
          <p class="mt-0.5 text-xs text-muted">{{ $t('workspaceSettings.apiKeys.mcpDescription') }}</p>
        </div>
      </div>
      <div class="flex gap-2">
        <UInput :model-value="mcpUrl" readonly class="min-w-0 flex-1 font-mono text-xs" :aria-label="$t('workspaceSettings.apiKeys.mcpAddress')" />
        <UButton icon="i-lucide-clipboard" color="neutral" variant="outline" @click="copyMcp">{{ mcpCopied ? $t('workspaceSettings.copied') : $t('workspaceSettings.copy') }}</UButton>
        <UButton to="/docs/mcp" target="_blank" icon="i-lucide-book-open" color="neutral" variant="ghost">{{ $t('workspaceSettings.apiKeys.mcpDocs') }}</UButton>
      </div>
    </div>

    <form class="space-y-3" @submit.prevent="create">
      <div class="flex gap-2">
        <UInput v-model="newName" class="flex-1" :placeholder="$t('workspaceSettings.apiKeys.namePlaceholder')" required maxlength="80" :aria-label="$t('workspaceSettings.apiKeys.newKeyName')" />
        <UButton type="submit" icon="i-lucide-plus" :loading="creating" :disabled="scope === 'projects' && !pickedProjects.length">{{ $t('workspaceSettings.apiKeys.create') }}</UButton>
      </div>
      <URadioGroup
        v-model="access"
        :items="[
          { label: $t('workspaceSettings.apiKeys.accessWrite'), value: 'write', description: $t('workspaceSettings.apiKeys.accessWriteDescription') },
          { label: $t('workspaceSettings.apiKeys.accessRead'), value: 'read', description: $t('workspaceSettings.apiKeys.accessReadDescription') }
        ]"
      />
      <URadioGroup
        v-model="scope"
        :items="[
          { label: $t('workspaceSettings.apiKeys.scopeAll'), value: 'all', description: $t('workspaceSettings.apiKeys.scopeAllDescription') },
          { label: $t('workspaceSettings.apiKeys.scopeProjects'), value: 'projects', description: $t('workspaceSettings.apiKeys.scopeProjectsDescription') }
        ]"
      />
      <UFormField :label="$t('workspaceSettings.apiKeys.expiry')" class="max-w-56"><USelect v-model="expiry" :items="expiryItems" class="w-full" :aria-label="$t('workspaceSettings.apiKeys.keyExpiry')" /></UFormField>
      <UCheckboxGroup v-if="scope === 'projects'" v-model="pickedProjects" :items="projects.map(project => ({ label: project.name, value: project.id }))" :aria-label="$t('workspaceSettings.apiKeys.projectsAccess')" />
    </form>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

    <!-- Shown once, in place: a second modal on top of the settings one would be one too many. -->
    <div v-if="createdKey" class="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div>
        <p class="text-[13px] font-medium text-highlighted">{{ $t('workspaceSettings.apiKeys.copyNow') }}</p>
        <p class="text-xs text-muted">{{ $t('workspaceSettings.apiKeys.copyNowDescription') }}</p>
      </div>
      <div class="flex gap-2">
        <UInput :model-value="createdKey" readonly class="min-w-0 flex-1 font-mono text-xs" :aria-label="$t('workspaceSettings.apiKeys.newKey')" />
        <UButton icon="i-lucide-clipboard" @click="copy">{{ copied ? $t('workspaceSettings.copied') : $t('workspaceSettings.copy') }}</UButton>
        <UButton color="neutral" variant="ghost" @click="createdKey = ''">{{ $t('workspaceSettings.done') }}</UButton>
      </div>
    </div>

    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-12" /></div>
    <EmptyState v-else-if="!keys.length" icon="i-lucide-key-round" :title="$t('workspaceSettings.apiKeys.emptyTitle')" :description="$t('workspaceSettings.apiKeys.emptyDescription')" class="rounded-xl border border-dashed border-default" />
    <ul v-else class="divide-y divide-default overflow-hidden rounded-xl border border-default">
      <li v-for="key in keys" :key="key.id" class="flex min-h-14 items-center gap-3 px-4 py-2">
        
        <template v-if="editingId === key.id">
          <UInput v-model="editingName" size="sm" class="flex-1" :aria-label="$t('workspaceSettings.apiKeys.keyNameAria')" autofocus @keydown.enter.prevent="rename(key.id)" @keydown.esc.stop="editingId = ''" />
          <UButton size="sm" @click="rename(key.id)">{{ $t('workspaceSettings.save') }}</UButton>
          <UButton size="sm" color="neutral" variant="ghost" @click="editingId = ''">{{ $t('common.cancel') }}</UButton>
        </template>

        <template v-else>
          <UIcon name="i-lucide-key-round" class="size-4 shrink-0 text-muted" />
          
          <span class="min-w-0 flex-1">
            <div class="flex flex-col gap-y-1">
              <span class="flex items-center gap-2">
                <span class="block truncate text-[13px] font-medium text-highlighted">{{ key.name }}</span>
                <UBadge v-if="key.readOnly" color="neutral" variant="subtle" size="sm">{{ $t('workspaceSettings.apiKeys.readOnly') }}</UBadge>
              </span>
              <span class="hidden truncate text-xs text-muted sm:block">{{ scopeLabel(key) }}</span>
            </div>

            <code class="block font-mono text-xs text-muted">{{ key.prefix }}…</code>
          </span>

          <div class="flex flex-col gap-1">
            <span class="hidden text-xs text-muted sm:block">{{ expiryLabel(key) }}</span>
            <span class="hidden text-xs text-muted sm:block">{{ $t('workspaceSettings.apiKeys.created', { date: new Date(key.createdAt || '').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }) }}</span>
          </div>

          <UTooltip :text="$t('workspaceSettings.apiKeys.rename')"><UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-pencil" class="text-muted" :aria-label="$t('workspaceSettings.apiKeys.rename')" @click="edit(key)" /></UTooltip>
          <UTooltip :text="$t('workspaceSettings.revoke')"><UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-trash-2" class="text-muted" :aria-label="$t('workspaceSettings.revoke')" @click="revoke(key)" /></UTooltip>
        </template>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
type ApiKey = { id: string, name: string, prefix: string, createdAt: string | null, expiresAt: string | null, lastUsedAt: string | null, projectIds: string[] | null, readOnly?: boolean }
const { api, projects, loadProjects } = useAgent()
const { t } = useI18n()
const appUrl = useAppUrl()
const mcpUrl = computed(() => `${appUrl.value}/mcp`)
const mcpCopied = ref(false)
const access = ref<'write' | 'read'>('write')
const scope = ref<'all' | 'projects'>('all')
const pickedProjects = ref<string[]>([])
const expiry = ref('90')
const expiryItems = computed(() => [
  { label: t('workspaceSettings.apiKeys.in30Days'), value: '30' },
  { label: t('workspaceSettings.apiKeys.in90Days'), value: '90' },
  { label: t('workspaceSettings.apiKeys.inAYear'), value: '365' },
  { label: t('workspaceSettings.apiKeys.never'), value: 'never' }
])
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
    const result = await api<{ apiKey: ApiKey, key: string }>('/admin/api-keys', { method: 'POST', body: { name: newName.value, projectIds: scope.value === 'projects' ? pickedProjects.value : undefined, readOnly: access.value === 'read' ? true : undefined, expiresInDays: expiry.value === 'never' ? null : Number(expiry.value) } })
    keys.value.unshift(result.apiKey)
    newName.value = ''
    access.value = 'write'
    scope.value = 'all'
    pickedProjects.value = []
    createdKey.value = result.key
    copied.value = false
  } catch (e: any) {
    error.value = e?.message || t('workspaceSettings.apiKeys.createFailed')
  } finally {
    creating.value = false
  }
}

function expiryLabel(key: ApiKey) {
  const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const expires = key.expiresAt ? (new Date(key.expiresAt).getTime() <= Date.now() ? t('workspaceSettings.apiKeys.expired', { date: date(key.expiresAt) }) : t('workspaceSettings.apiKeys.expiresOn', { date: date(key.expiresAt) })) : t('workspaceSettings.apiKeys.neverExpires')
  return key.lastUsedAt ? t('workspaceSettings.apiKeys.usedOn', { expires, date: date(key.lastUsedAt) }) : expires
}

function scopeLabel(key: ApiKey) {
  if (!key.projectIds) return t('workspaceSettings.apiKeys.allProjects')
  const names = key.projectIds.map(id => projects.value.find(project => project.id === id)?.name).filter(Boolean)
  return names.length ? names.join(', ') : t('workspaceSettings.apiKeys.projectCount', key.projectIds.length)
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
    error.value = e?.message || t('workspaceSettings.apiKeys.renameFailed')
  }
}

async function revoke(key: ApiKey) {
  if (!confirm(t('workspaceSettings.apiKeys.revokeConfirm', { name: key.name }))) return
  try {
    await api(`/admin/api-keys/${key.id}`, { method: 'DELETE' })
    keys.value = keys.value.filter(item => item.id !== key.id)
  } catch (e: any) {
    error.value = e?.message || t('workspaceSettings.apiKeys.revokeFailed')
  }
}

async function copyMcp() {
  await navigator.clipboard.writeText(mcpUrl.value)
  mcpCopied.value = true
  setTimeout(() => { mcpCopied.value = false }, 2000)
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
    error.value = e?.message || t('workspaceSettings.apiKeys.loadFailed')
  }
  loading.value = false
})
</script>
