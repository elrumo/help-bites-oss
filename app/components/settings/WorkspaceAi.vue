<template>
  <div class="space-y-6">
    <p class="text-[13px] text-muted">
      Connect any OpenAI-compatible provider: OpenAI, Azure, OpenRouter or a LiteLLM of your own. Assistants without an endpoint of their own, the email designer and error notes then use it{{ state?.platform.available ? ' instead of the server\'s AI' : '' }}{{ state?.platform.metered ? ', and it uses no AI credits' : '' }}.
    </p>

    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 3" :key="i" class="h-12" /></div>
    <template v-else-if="state">
      <div class="flex min-h-14 items-center gap-3 rounded-xl border border-default px-4 py-2">
        <UIcon :name="status.icon" class="size-4 shrink-0 text-muted" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-medium text-highlighted">{{ status.title }}</span>
          <span class="block truncate text-xs text-muted">{{ status.detail }}</span>
        </span>
      </div>
      <div v-if="!state.allowed" class="flex items-center gap-3">
        <p class="min-w-0 flex-1 text-[13px] text-muted">The {{ context?.plan.name }} plan doesn't include your own AI provider.</p>
        <UButton v-if="upgrade" label="Upgrade" size="sm" @click="upgrade?.()" />
      </div>

      <form class="space-y-6" @submit.prevent="save">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Endpoint" hint="OpenAI-compatible" class="sm:col-span-2">
            <UInput v-model="form.endpoint" type="url" placeholder="https://api.openai.com/v1" class="w-full" :disabled="!editable" required />
          </UFormField>
          <UFormField label="Model" help="For the assistants, error notes and the designer">
            <UInput v-model="form.model" placeholder="gpt-4o-mini" class="w-full" :disabled="!editable" required maxlength="120" />
          </UFormField>
          <UFormField label="Ultra model" hint="Optional" help="For the designer's Ultra mode; blank uses the model">
            <UInput v-model="form.ultraModel" placeholder="Same as the model" class="w-full" :disabled="!editable" maxlength="120" />
          </UFormField>
          <UFormField label="API key" class="sm:col-span-2">
            <UInput v-model="form.apiKey" type="password" autocomplete="off" :placeholder="keyKept ? 'Saved; leave blank to keep' : ''" class="w-full" :disabled="!editable" />
          </UFormField>
        </div>

        <p v-if="result" class="flex items-start gap-2 text-[13px]" :class="result.ok ? 'text-success' : 'text-error'">
          <UIcon :name="result.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="mt-0.5 size-4 shrink-0" />
          <span class="min-w-0 break-words">{{ result.ok ? `It works: ${result.model} answered${result.reply ? ` “${result.reply}”` : ''}.` : result.error }}</span>
        </p>
        <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

        <div v-if="canEdit && (state?.allowed || state?.ai)" class="flex items-center gap-3">
          <template v-if="state?.allowed">
            <UButton type="submit" :loading="saving" :disabled="!dirty">Save</UButton>
            <UButton color="neutral" variant="outline" :loading="testing" :disabled="!form.endpoint.trim()" @click="test">Test</UButton>
            <span v-if="saved && !dirty" class="text-[13px] text-muted">Saved</span>
          </template>
          <UButton v-if="state?.ai" label="Turn off" icon="i-lucide-power" color="neutral" variant="ghost" class="ml-auto" :loading="turningOff" @click="turnOff" />
        </div>
        <p v-else-if="!canEdit" class="text-[13px] text-muted">Only admins and owners can change the workspace's settings.</p>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
import { can } from '#shared/roles'
import type { WorkspaceAiSettings } from '~~/server/utils/aiGateway'

// The workspace's own AI provider ("bring your own key"). The key is
// write-only: the server only says whether one is saved.
type State = { ai: WorkspaceAiSettings | null, platform: { available: boolean, metered: boolean }, allowed: boolean }
type TestResult = { ok: boolean, model: string, reply?: string, error?: string }

const { api, context } = useAgent()
const { upgrade } = editionUi()
const canEdit = computed(() => can(context.value?.role, 'workspace.settings'))
const state = ref<State | null>(null)
const editable = computed(() => canEdit.value && !!state.value?.allowed)
const form = reactive({ endpoint: '', model: '', ultraModel: '', apiKey: '' })
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const testing = ref(false)
const turningOff = ref(false)
const result = ref<TestResult | null>(null)
const error = ref('')

const sameEndpoint = (a: string, b: string) => a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '')
// A saved key only follows its own endpoint (the server drops it when the endpoint changes).
const keyKept = computed(() => !!state.value?.ai?.hasApiKey && sameEndpoint(form.endpoint, state.value.ai.endpoint))
const dirty = computed(() => {
  const ai = state.value?.ai
  return !!form.apiKey || form.endpoint.trim() !== (ai?.endpoint || '') || form.model.trim() !== (ai?.model || '') || form.ultraModel.trim() !== (ai?.ultraModel || '')
})

const status = computed(() => {
  const s = state.value
  if (s?.ai) {
    let host = s.ai.endpoint
    try { host = new URL(s.ai.endpoint).host } catch {}
    const detail = [host, s.ai.model].filter(Boolean).join(' · ')
    return s.allowed ? { icon: 'i-lucide-plug', title: 'Using your own provider', detail } : { icon: 'i-lucide-circle-pause', title: 'Saved, but not in use', detail }
  }
  if (s?.platform.available) return { icon: 'i-lucide-server', title: 'Using the server\'s AI', detail: s.platform.metered ? 'Each call uses AI credits from your plan.' : 'The AI this server is set up with.' }
  return { icon: 'i-lucide-circle-off', title: 'No AI set up', detail: 'Connect a provider to use the assistants, the email designer and error notes.' }
})

function reset() {
  const ai = state.value?.ai
  Object.assign(form, { endpoint: ai?.endpoint || '', model: ai?.model || '', ultraModel: ai?.ultraModel || '', apiKey: '' })
}

function body() {
  return { endpoint: form.endpoint.trim(), model: form.model.trim(), ultraModel: form.ultraModel.trim(), ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}) }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const { ai } = await api<{ ai: WorkspaceAiSettings | null }>('/admin/workspace/ai', { method: 'PUT', body: body() })
    state.value!.ai = ai
    reset()
    saved.value = true
  } catch (e: any) {
    error.value = e?.message || 'Could not save'
  } finally {
    saving.value = false
  }
}

async function test() {
  testing.value = true
  error.value = ''
  result.value = null
  try {
    result.value = await api<TestResult>('/admin/workspace/ai/test', { method: 'POST', body: body() })
  } catch (e: any) {
    error.value = e?.message || 'Could not test the provider'
  } finally {
    testing.value = false
  }
}

async function turnOff() {
  if (!confirm('Turn off your own AI provider? Its saved API key is removed too.')) return
  turningOff.value = true
  error.value = ''
  try {
    const { ai } = await api<{ ai: WorkspaceAiSettings | null }>('/admin/workspace/ai', { method: 'PUT', body: { endpoint: '' } })
    state.value!.ai = ai
    reset()
    result.value = null
    saved.value = false
  } catch (e: any) {
    error.value = e?.message || 'Could not turn it off'
  } finally {
    turningOff.value = false
  }
}

onMounted(async () => {
  try {
    state.value = await api<State>('/admin/workspace/ai')
    reset()
  } catch (e: any) {
    error.value = e?.message || 'Could not load the AI settings'
  }
  loading.value = false
})
</script>
