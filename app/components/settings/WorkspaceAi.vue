<template>
  <div class="space-y-6">
    <p class="text-[13px] text-muted">
      Add keys for OpenAI, Anthropic, Gemini or any other OpenAI-compatible provider, and pick the one to use. Assistants without an endpoint of their own, the email designer and error notes then use it{{ state?.platform.available ? ' instead of the server\'s AI' : '' }}{{ state?.platform.metered ? ', and it uses no AI credits' : '' }}.
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

      <div v-if="providers.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
        <div v-for="p in providers" :key="p.id" class="flex min-h-14 items-center gap-3 px-4 py-2">
          <button
            type="button"
            role="radio"
            :aria-checked="p.id === state.ai.active"
            :aria-label="`Use ${label(p)}`"
            class="flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50"
            :class="p.id === state.ai.active ? 'border-primary bg-primary' : 'border-accented hover:border-primary'"
            :disabled="!editable || saving"
            @click="use(p)"
          >
            <span v-if="p.id === state.ai.active" class="size-1.5 rounded-full bg-white" />
          </button>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-medium text-highlighted">{{ label(p) }}</span>
            <span class="block truncate text-xs text-muted">{{ [host(p.endpoint), p.model, p.hasApiKey ? '' : 'No key'].filter(Boolean).join(' · ') }}</span>
          </span>
          <template v-if="editable">
            <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="sm" :aria-label="`Edit ${label(p)}`" @click="openForm(p)" />
            <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="sm" :aria-label="`Remove ${label(p)}`" :disabled="saving" @click="remove(p)" />
          </template>
        </div>
      </div>

      <form v-if="form" class="space-y-6 rounded-xl border border-default p-4" @submit.prevent="saveForm">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Provider">
            <USelect :model-value="form.kind" :items="presets" class="w-full" :disabled="!!form.id" @update:model-value="pickKind" />
          </UFormField>
          <UFormField label="Name" hint="Optional">
            <UInput v-model="form.name" :placeholder="preset?.label" class="w-full" maxlength="60" />
          </UFormField>
          <UFormField label="Endpoint" hint="OpenAI-compatible" class="sm:col-span-2">
            <UInput v-model="form.endpoint" type="url" placeholder="https://api.openai.com/v1" class="w-full" required />
          </UFormField>
          <UFormField label="Model" help="For the assistants, error notes and the designer">
            <UInput v-model="form.model" list="ai-models" :placeholder="preset?.models[0] || 'gpt-4o-mini'" class="w-full" required maxlength="120" />
          </UFormField>
          <UFormField label="Ultra model" hint="Optional" help="For the designer's Ultra mode; blank uses the model">
            <UInput v-model="form.ultraModel" list="ai-models" placeholder="Same as the model" class="w-full" maxlength="120" />
          </UFormField>
          <UFormField label="API key" class="sm:col-span-2">
            <UInput v-model="form.apiKey" type="password" autocomplete="off" :placeholder="keyKept ? 'Saved; leave blank to keep' : ''" class="w-full" />
          </UFormField>
        </div>
        <datalist id="ai-models"><option v-for="m in preset?.models" :key="m" :value="m" /></datalist>

        <p v-if="result" class="flex items-start gap-2 text-[13px]" :class="result.ok ? 'text-success' : 'text-error'">
          <UIcon :name="result.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="mt-0.5 size-4 shrink-0" />
          <span class="min-w-0 break-words">{{ result.ok ? `It works: ${result.model} answered${result.reply ? ` “${result.reply}”` : ''}.` : result.error }}</span>
        </p>
        <div class="flex items-center gap-3">
          <UButton type="submit" :loading="saving">{{ form.id ? 'Save' : 'Add provider' }}</UButton>
          <UButton color="neutral" variant="outline" :loading="testing" :disabled="!form.endpoint.trim()" @click="test">Test</UButton>
          <UButton color="neutral" variant="ghost" @click="form = null">Cancel</UButton>
        </div>
      </form>
      <UButton v-else-if="editable && providers.length < MAX_PROVIDERS" label="Add a provider" icon="i-lucide-plus" color="neutral" variant="outline" @click="openForm()" />

      <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
      <p v-if="!canEdit" class="text-[13px] text-muted">Only admins and owners can change the workspace's settings.</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { can } from '#shared/roles'
import { AI_PROVIDER_PRESETS } from '#shared/aiProviders'
import type { AiProviderSettings, WorkspaceAiSettings } from '~~/server/utils/aiGateway'

// The workspace's own AI providers ("bring your own key"): any number saved, one
// in use. Keys are write-only: the server only says whether one is saved. Every
// change (add, edit, remove, switch) is saved straight away.
type State = { ai: WorkspaceAiSettings, platform: { available: boolean, metered: boolean }, allowed: boolean }
type TestResult = { ok: boolean, model: string, reply?: string, error?: string }

const { api, context } = useAgent()
const { upgrade } = editionUi()
const canEdit = computed(() => can(context.value?.role, 'workspace.settings'))
const state = ref<State | null>(null)
const editable = computed(() => canEdit.value && !!state.value?.allowed)
const providers = computed(() => state.value?.ai.providers || [])
const active = computed(() => providers.value.find(p => p.id === state.value?.ai.active))
const presets = AI_PROVIDER_PRESETS.map(p => ({ label: p.label, value: p.kind }))
const MAX_PROVIDERS = 10

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const result = ref<TestResult | null>(null)
const error = ref('')

// The form: null when closed; `id` is set when editing a saved provider.
const blank = () => ({ id: '', kind: 'openai', name: '', endpoint: AI_PROVIDER_PRESETS[0]!.endpoint, model: '', ultraModel: '', apiKey: '' })
const form = ref<ReturnType<typeof blank> | null>(null)
const preset = computed(() => AI_PROVIDER_PRESETS.find(p => p.kind === form.value?.kind))
const label = (p: AiProviderSettings) => p.name || AI_PROVIDER_PRESETS.find(x => x.kind === p.kind)?.label || host(p.endpoint)
const keyKept = computed(() => !!form.value?.id && !!providers.value.find(p => p.id === form.value!.id)?.hasApiKey)

function host(endpoint: string) {
  try { return new URL(endpoint).host } catch { return endpoint }
}

const status = computed(() => {
  const s = state.value
  if (active.value) {
    const detail = [host(active.value.endpoint), active.value.model].filter(Boolean).join(' · ')
    return s?.allowed ? { icon: 'i-lucide-plug', title: `Using ${label(active.value)}`, detail } : { icon: 'i-lucide-circle-pause', title: 'Saved, but not in use', detail }
  }
  if (s?.platform.available) return { icon: 'i-lucide-server', title: 'Using the server\'s AI', detail: s.platform.metered ? 'Each call uses AI credits from your plan.' : 'The AI this server is set up with.' }
  return { icon: 'i-lucide-circle-off', title: 'No AI set up', detail: 'Connect a provider to use the assistants, the email designer and error notes.' }
})

function pickKind(kind: string) {
  const f = form.value!
  const next = AI_PROVIDER_PRESETS.find(p => p.kind === kind)!
  f.kind = kind
  f.endpoint = next.endpoint
  f.model = next.models[0] || ''
  f.ultraModel = ''
}

function openForm(p?: AiProviderSettings) {
  result.value = null
  error.value = ''
  form.value = p ? { id: p.id, kind: p.kind, name: p.name, endpoint: p.endpoint, model: p.model, ultraModel: p.ultraModel, apiKey: '' } : blank()
  if (!p) pickKind('openai')
}

const draft = () => {
  const f = form.value!
  return { id: f.id || undefined, kind: f.kind, name: f.name.trim(), endpoint: f.endpoint.trim(), model: f.model.trim(), ultraModel: f.ultraModel.trim(), ...(f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {}) }
}

// Saves the whole list; saved providers go without a key so the server keeps theirs.
async function persist(list: object[], activeId: string, failure = 'Could not save') {
  saving.value = true
  error.value = ''
  try {
    const { ai } = await api<{ ai: WorkspaceAiSettings }>('/admin/workspace/ai', { method: 'PUT', body: { providers: list, active: activeId } })
    state.value!.ai = ai
    return true
  } catch (e: any) {
    error.value = e?.message || failure
    return false
  } finally {
    saving.value = false
  }
}

const bare = (p: AiProviderSettings) => ({ id: p.id, kind: p.kind, name: p.name, endpoint: p.endpoint, model: p.model, ultraModel: p.ultraModel })

async function saveForm() {
  const f = draft()
  const editing = providers.value.some(p => p.id === f.id)
  const list = editing ? providers.value.map(p => p.id === f.id ? f : bare(p)) : [...providers.value.map(bare), { ...f, id: `p${Math.random().toString(36).slice(2, 10)}` }]
  // A new provider becomes the one in use when it is the first, or stays out of the way otherwise.
  const activeId = editing || providers.value.length ? state.value!.ai.active : list[list.length - 1]!.id
  if (await persist(list, activeId)) form.value = null
}

function use(p: AiProviderSettings) {
  if (p.id !== state.value?.ai.active) persist(providers.value.map(bare), p.id, 'Could not switch provider')
}

async function remove(p: AiProviderSettings) {
  if (!confirm(`Remove ${label(p)}? Its saved API key is removed too.`)) return
  const rest = providers.value.filter(x => x.id !== p.id).map(bare)
  if (await persist(rest, state.value!.ai.active === p.id ? rest[0]?.id || '' : state.value!.ai.active, 'Could not remove it') && form.value?.id === p.id) form.value = null
}

async function test() {
  testing.value = true
  error.value = ''
  result.value = null
  try {
    result.value = await api<TestResult>('/admin/workspace/ai/test', { method: 'POST', body: draft() })
  } catch (e: any) {
    error.value = e?.message || 'Could not test the provider'
  } finally {
    testing.value = false
  }
}

onMounted(async () => {
  try {
    state.value = await api<State>('/admin/workspace/ai')
  } catch (e: any) {
    error.value = e?.message || 'Could not load the AI settings'
  }
  loading.value = false
})
</script>
