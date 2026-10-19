<template>
  <div class="space-y-3">
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-10" /></div>
    <template v-else-if="!connections.length">
      <p class="text-[13px] text-muted">{{ configured ? 'Connect a GitHub account first.' : 'GitHub isn\'t set up on this server.' }}</p>
      <UButton v-if="configured" size="xs" color="neutral" variant="outline" icon="i-lucide-github" @click="settingsTab = 'github'">Connect GitHub</UButton>
    </template>
    <template v-else>
      <ul v-if="repos.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
        <li v-for="repo in repos" :key="repo.id" class="flex min-h-10 items-center gap-3 px-4 py-1.5">
          <UIcon name="i-lucide-git-branch" class="size-4 shrink-0 text-muted" />
          <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-highlighted">{{ repo.fullName }}</span>
          <span class="text-xs text-muted">{{ repo.defaultBranch }}</span>
          <UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-x" class="text-muted" aria-label="Remove repo" :disabled="saving" @click="save(repos.filter(r => r.id !== repo.id))" />
        </li>
      </ul>
      <p v-else class="text-[13px] text-muted">No repos yet.</p>
      <div v-if="repos.length < 10" class="flex items-center gap-2">
        <USelectMenu v-model="connection" :items="connections.map(c => ({ label: c.account, value: c.id }))" value-key="value" class="w-40" aria-label="GitHub account" @update:model-value="load" />
        <USelectMenu v-model="pick" :items="choices" value-key="value" :loading="listing" placeholder="Add a repo" searchable class="min-w-0 flex-1" aria-label="Repo" :disabled="saving" @update:model-value="add" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { GithubInstallationView } from './GithubConnection.vue'

type Repo = { installationId: string, id: number, fullName: string, defaultBranch: string }
type Available = { id: number, fullName: string, private: boolean, defaultBranch: string }

const props = defineProps<{ projectId: string }>()
const { api } = useAgent()
const settingsTab = useState('settings-tab', () => '')
const connections = ref<GithubInstallationView[]>([])
const configured = ref(true)
const repos = ref<Repo[]>([])
const available = ref<Available[]>([])
const connection = ref('')
const pick = ref<number>()
const loading = ref(true)
const listing = ref(false)
const saving = ref(false)
const error = ref('')

const choices = computed(() => available.value.filter(a => !repos.value.some(r => r.id === a.id)).map(a => ({ label: `${a.fullName}${a.private ? ' (private)' : ''}`, value: a.id })))

async function load() {
  listing.value = true
  error.value = ''
  try { available.value = (await api<{ repos: Available[] }>(`/admin/github/installations/${connection.value}/repos`)).repos } catch (cause: any) { available.value = []; error.value = cause.message || 'Could not list the repos' } finally { listing.value = false }
}

async function save(next: Array<{ installationId: string, id: number }>) {
  saving.value = true
  error.value = ''
  try { repos.value = (await api<{ repos: Repo[] }>(`/admin/projects/${props.projectId}/repos`, { method: 'PUT', body: { repos: next.map(({ installationId, id }) => ({ installationId, id })) } })).repos } catch (cause: any) { error.value = cause.message || 'Could not save the repos' } finally { saving.value = false }
}

async function add(id: number) {
  pick.value = undefined
  await save([...repos.value, { installationId: connection.value, id }])
}

onMounted(async () => {
  try {
    const [github, mine] = await Promise.all([api<{ configured: boolean, installations: GithubInstallationView[] }>('/admin/github'), api<{ repos: Repo[] }>(`/admin/projects/${props.projectId}/repos`)])
    configured.value = github.configured; connections.value = github.installations; repos.value = mine.repos
    connection.value = connections.value[0]?.id || ''
    if (connection.value) await load()
  } catch (cause: any) { error.value = cause.message || 'Could not load GitHub' } finally { loading.value = false }
})
</script>
