<template>
  <div class="flex min-h-full items-center justify-center bg-default px-6 py-16">
    <div class="w-full max-w-[24rem]">
      <span class="mb-10 grid size-8 place-items-center rounded-lg bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-[18px]" /></span>

      <div v-if="loading" class="space-y-3"><USkeleton class="h-7 w-56" /><USkeleton class="h-20" /><USkeleton class="h-11" /></div>

      <template v-else-if="!preview">
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ $t('oauth.invalidTitle') }}</h1>
        <p class="mt-1 text-[15px] text-muted">{{ error || $t('oauth.invalid') }}</p>
        <UButton class="mt-8" to="/overview" color="neutral" variant="outline">{{ $t('oauth.backToPanel') }}</UButton>
      </template>

      <p v-else-if="redirecting" class="text-[15px] text-muted">{{ $t('oauth.redirecting', { client: preview.client.name }) }}</p>

      <form v-else @submit.prevent="approve">
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ $t('oauth.title', { client: preview.client.name }) }}</h1>
        <p class="mb-6 mt-1 text-[15px] text-muted">{{ $t('oauth.description', { client: preview.client.name }) }}</p>

        <UFormField v-if="workspaces.length > 1" :label="$t('oauth.workspace')" class="mb-4" :ui="{ label: 'font-normal text-muted' }">
          <USelect v-model="chosenWorkspace" :items="workspaces.map(w => ({ label: w.name, value: w.id }))" class="w-full" :aria-label="$t('oauth.workspace')" @update:model-value="load" />
        </UFormField>
        <p v-else class="mb-4 text-[13px] text-muted">{{ $t('oauth.workspace') }}: <span class="font-medium text-highlighted">{{ preview.workspace.name }}</span></p>

        <template v-if="preview.canApprove">
          <URadioGroup
            v-model="scope"
            class="mb-3"
            :items="[
              { label: $t('oauth.scopeAll'), value: 'all', description: $t('oauth.scopeAllDescription') },
              { label: $t('oauth.scopeProjects'), value: 'projects', description: $t('oauth.scopeProjectsDescription') }
            ]"
          />
          <UCheckboxGroup v-if="scope === 'projects'" v-model="picked" class="mb-3" :items="preview.projects.map(project => ({ label: project.name, value: project.id }))" :aria-label="$t('oauth.projects')" />
          <p class="mb-6 text-xs text-muted">{{ $t('oauth.redirectsTo', { host: preview.client.redirectHost }) }}</p>
        </template>
        <p v-else class="mb-6 text-[13px] text-error">{{ $t('oauth.notAllowed') }}</p>

        <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
        <div class="flex items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="lg" @click="deny">{{ $t('oauth.deny') }}</UButton>
          <UButton type="submit" size="lg" :loading="saving" :disabled="!preview.canApprove || (scope === 'projects' && !picked.length)">{{ $t('oauth.approve') }}</UButton>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
// Where an AI assistant's "sign in" lands (the authorization_endpoint in
// server/utils/mcp/metadata.ts): the operator is signed in to the panel as
// usual, checks what is being connected, and approves. The server then sends
// the browser back to the assistant with a one-use code.
definePageMeta({ layout: 'bare', middleware: 'agent' })

type Preview = { client: { name: string, redirectHost: string }, workspace: { id: string, name: string }, projects: Array<{ id: string, name: string }>, canApprove: boolean }

const route = useRoute()
const { agentHeaders, context, workspaceId } = useAgent()
const { t } = useI18n()
const param = (name: string) => String(Array.isArray(route.query[name]) ? route.query[name]![0] : route.query[name] || '')
const clientId = param('client_id')
const redirectUri = param('redirect_uri')
const challenge = param('code_challenge')
const state = param('state')
// Only the code flow with S256 PKCE is offered (the server's metadata says so); anything else is not a link to follow.
const wellFormed = param('response_type') === 'code' && Boolean(clientId && redirectUri) && /^[A-Za-z0-9_-]{43}$/.test(challenge) && param('code_challenge_method') === 'S256'

const workspaces = computed(() => context.value?.workspaces || [])
const chosenWorkspace = ref(workspaceId.value)
const preview = ref<Preview | null>(null)
const loading = ref(true)
const saving = ref(false)
const redirecting = ref(false)
const error = ref('')
const scope = ref<'all' | 'projects'>('all')
const picked = ref<string[]>([])

const headers = () => ({ ...agentHeaders(), ...(chosenWorkspace.value ? { 'X-Workspace': chosenWorkspace.value } : {}) })

async function load() {
  loading.value = !preview.value
  error.value = ''
  picked.value = []
  scope.value = 'all'
  if (!wellFormed) { loading.value = false; return }
  try {
    preview.value = await $fetch<Preview>('/v1/admin/oauth/authorize', { query: { client_id: clientId, redirect_uri: redirectUri }, headers: headers() })
  } catch (e: any) {
    preview.value = null
    error.value = e?.data?.statusMessage || ''
  } finally {
    loading.value = false
  }
}

async function approve() {
  saving.value = true
  error.value = ''
  try {
    const { redirectTo } = await $fetch<{ redirectTo: string }>('/v1/admin/oauth/authorize', {
      method: 'POST',
      headers: headers(),
      body: { clientId, redirectUri, codeChallenge: challenge, state, projectIds: scope.value === 'projects' ? picked.value : undefined }
    })
    redirecting.value = true
    window.location.href = redirectTo
  } catch (e: any) {
    error.value = e?.data?.statusMessage || t('oauth.failed')
    saving.value = false
  }
}

// Saying no is the assistant's to be told too (RFC 6749 4.1.2.1), to an address the server has just confirmed it registered.
function deny() {
  if (!preview.value) return
  const url = new URL(redirectUri)
  url.searchParams.set('error', 'access_denied')
  if (state) url.searchParams.set('state', state)
  redirecting.value = true
  window.location.href = url.toString()
}

onMounted(load)
</script>
