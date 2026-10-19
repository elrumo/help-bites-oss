<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="projectId || undefined" :crumbs="projectId ? [{ label: 'Assistants', to: `/projects/${projectId}/assistants` }] : []" :title="form.name || 'Assistant'">
      <template #actions>
        <UButton icon="i-lucide-copy" label="Duplicate" color="neutral" variant="ghost" size="sm" @click="duplicate" />
        <UButton icon="i-lucide-trash-2" label="Delete" color="error" variant="ghost" size="sm" @click="remove" />
      </template>
    </PageHeader>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-2xl space-y-12 px-6 py-8">
        <!-- config -->
        <form class="space-y-4" @submit.prevent="save">
          <h2 class="text-[15px] font-semibold text-highlighted">Configuration</h2>
          <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Assistant ID</span>
            <code class="font-mono bg-elevated px-1.5 py-0.5 rounded select-all">{{ id }}</code>
            <UButton size="xs" variant="ghost" color="neutral" :icon="idCopied ? 'i-lucide-check' : 'i-lucide-clipboard'" aria-label="Copy assistant ID" @click="copyId" />
            <span>— the developer passes this to route chats to this assistant.</span>
          </div>
          <div class="grid sm:grid-cols-2 gap-4">
            <UFormField label="Name"><UInput v-model="form.name" class="w-full" required /></UFormField>
            <UFormField label="Status"><USelect v-model="form.status" :items="statusItems" class="w-full" /></UFormField>
          </div>
          <UFormField label="Description"><UInput v-model="form.description" class="w-full" /></UFormField>
          <UFormField label="System prompt" hint="Tone and boundaries. Retrieved knowledge is added automatically as reference data.">
            <UTextarea v-model="form.systemPrompt" class="w-full" :rows="4" placeholder="You are the WebBites support assistant. Be concise and friendly." />
          </UFormField>

          <details class="rounded-lg border border-default p-3">
            <summary class="cursor-pointer text-sm font-medium">Model & connection <span class="font-normal text-dimmed">— advanced</span></summary>
            <div class="mt-3 space-y-4">
              <div class="grid sm:grid-cols-2 gap-4">
                <UFormField label="Model" :hint="`default: ${DEFAULT_LLM_MODEL}`"><UInput v-model="form.model" class="w-full" :placeholder="DEFAULT_LLM_MODEL" /></UFormField>
                <UFormField label="Temperature"><UInput v-model.number="form.temperature" type="number" step="0.1" min="0" max="2" class="w-full" /></UFormField>
              </div>
              <UFormField label="Endpoint" hint="OpenAI-compatible base URL. Leave blank to use the default LiteLLM endpoint.">
                <UInput v-model="form.endpoint" class="w-full" placeholder="https://litellm.example.com" />
              </UFormField>
              <UFormField label="API key" :hint="hasApiKey ? 'A key is set. Type to replace it; leave blank to keep it.' : 'Leave blank to use the default endpoint\'s key.'">
                <UInput v-model="form.apiKey" type="password" class="w-full" :placeholder="hasApiKey ? '•••••••• (set)' : ''" autocomplete="off" />
              </UFormField>
              <p class="text-xs" :class="llm?.configured ? 'text-muted' : 'text-warning'">
                {{ llm?.configured ? `Ready — ${llm.model}${llm.usingDefaultEndpoint ? ' via default endpoint' : ' via custom endpoint'}.` : 'No LLM endpoint configured. Retrieval still works for answer suggestions; auto-reply will not run.' }}
              </p>
            </div>
          </details>

          <UFormField label="Fallback when unsure" hint="What to do when no knowledge matches"><USelect v-model="form.fallbackBehavior" :items="fallbackItems" class="w-full sm:w-64" /></UFormField>
          <div class="flex items-center gap-3">
            <USwitch v-model="form.autoReply" />
            <span class="text-sm">Automatically reply to this project's users<span class="text-dimmed"> — off by default; sends grounded answers as this assistant</span></span>
          </div>

          <div v-if="form.autoReply" class="space-y-4 rounded-lg border border-default p-3">
            <h3 class="text-[13px] font-medium text-highlighted">When to answer with AI</h3>
            <UFormField label="Minimum confidence" hint="Only send an AI answer when the best knowledge match is at least this sure. 0% = always try.">
              <div class="flex items-center gap-3">
                <input v-model.number="confidencePct" type="range" min="0" max="100" step="5" class="flex-1 accent-primary-600">
                <span class="w-12 text-right text-sm tabular-nums">{{ confidencePct }}%</span>
              </div>
            </UFormField>
            <UFormField label="When no rule matches" hint="Default for a message none of the rules below apply to.">
              <USelect v-model="form.defaultAction" :items="actionItems" class="w-full sm:w-64" />
            </UFormField>
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Rules</span>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addRule">Add rule</UButton>
              </div>
              <p class="text-xs text-muted">Checked top to bottom; the first match wins. Match by ticket type and/or keywords in the user's message.</p>
              <p v-if="!rules.length" class="text-sm text-muted border border-dashed border-accented rounded-lg p-4 text-center">No rules — every message uses the default above.</p>
              <div v-for="(rule, i) in rules" :key="i" class="flex flex-wrap items-end gap-2 rounded-lg bg-elevated/60 p-2">
                <UFormField label="Ticket type" class="w-40"><OptionalSelect v-model="rule.conversationType" :items="typeItems" none-label="Any type" class="w-full" /></UFormField>
                <UFormField label="Keywords" hint="comma separated" class="flex-1 min-w-[10rem]"><UInput v-model="rule.keywordsText" class="w-full" placeholder="refund, cancel" /></UFormField>
                <UFormField label="Then" class="w-44"><USelect v-model="rule.action" :items="actionItems" class="w-full" /></UFormField>
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" class="mb-1.5" aria-label="Remove rule" @click="removeRule(i)" />
              </div>
            </div>
          </div>

          <p v-if="error" class="text-sm text-error">{{ error }}</p>
          <div class="flex items-center gap-3">
            <UButton type="submit" color="primary" :loading="saving">Save</UButton>
            <span v-if="saved" class="text-sm text-muted">Saved</span>
          </div>
        </form>

        <!-- knowledge assignments -->
        <div class="space-y-3">
          <h2 class="text-[15px] font-semibold text-highlighted">Knowledge access</h2>
          <p v-if="!assignments.length" class="text-sm text-muted border border-dashed border-accented rounded-xl p-6 text-center">
            This assistant does not currently have access to any support knowledge.
          </p>
          <ul v-else class="divide-y divide-default border-y border-default">
            <li v-for="a in assignments" :key="a.id" class="flex items-center gap-2 py-2 text-sm">
              <UBadge size="xs" variant="subtle" :color="a.exclude ? 'error' : 'primary'">{{ a.exclude ? 'exclude' : a.scope }}</UBadge>
              <span class="truncate">{{ describeAssignment(a) }}</span>
              <UButton class="ml-auto" size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="removeAssignment(a.id)" />
            </li>
          </ul>

          <form class="flex flex-wrap items-end gap-2 rounded-lg bg-elevated/60 p-3" @submit.prevent="addAssignment">
            <UFormField label="Grant" class="w-28"><USelect v-model="assignForm.scope" :items="scopeItems" class="w-full" /></UFormField>
            <UFormField label="Model" class="flex-1 min-w-[10rem]"><USelect v-model="assignForm.modelId" :items="modelItems" class="w-full" @update:model-value="onAssignModel" /></UFormField>
            <UFormField v-if="assignForm.scope === 'path'" label="Path" class="flex-1 min-w-[10rem]"><USelect v-model="assignForm.nodeId" :items="assignNodeItems" class="w-full" /></UFormField>
            <UFormField v-if="assignForm.scope === 'faq'" label="FAQ" class="flex-1 min-w-[12rem]">
              <USelect v-model="assignForm.faqId" :items="assignFaqItems" class="w-full" />
            </UFormField>
            <div class="flex items-center gap-1"><UCheckbox v-model="assignForm.exclude" /><span class="text-xs text-muted">exclude</span></div>
            <UButton type="submit" size="sm" color="neutral" variant="soft" :loading="addingAssign">Add</UButton>
          </form>
          <p v-if="assignError" class="text-sm text-error">{{ assignError }}</p>
        </div>

        <!-- test retrieval -->
        <div class="space-y-3">
          <h2 class="text-[15px] font-semibold text-highlighted">Test retrieval</h2>
          <p class="text-xs text-muted">See exactly what knowledge this assistant would be given for a question — the same retrieval the support runtime uses.</p>
          <form class="flex gap-2" @submit.prevent="test">
            <UInput v-model="testQuery" class="flex-1" placeholder="How do I delete my account?" />
            <UButton type="submit" color="neutral" variant="soft" :loading="testing">Retrieve</UButton>
          </form>
          <p v-if="tested && !results.length" class="text-sm text-muted">No knowledge matched — check the assignments above and that FAQs are active.</p>
          <ul v-else-if="results.length" class="space-y-2">
            <li v-for="r in results" :key="r.faqId" class="rounded-lg border border-default p-3">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium truncate">{{ r.question }}</span>
                <span class="ml-auto text-xs text-dimmed">{{ (r.score * 100).toFixed(0) }}%</span>
              </div>
              <p class="text-xs text-dimmed">{{ r.pathCache || '(root)' }}<span v-if="r.source.section"> · {{ r.source.section }}</span></p>
              <div class="mt-1 line-clamp-3"><MarkdownBlock :text="r.answer" /></div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SUPPORT_AGENT_STATUSES, AGENT_FALLBACKS, AGENT_RULE_ACTIONS, ASSIGNMENT_SCOPES, DEFAULT_LLM_MODEL } from '#shared/knowledge'
import type { ConversationType } from '#shared/support'
import type { SupportAgent } from '~~/server/utils/supportAgents'
import type { KnowledgeAssignment } from '~~/server/utils/agentKnowledge'
import type { KnowledgeModel } from '~~/server/utils/knowledgeModels'
import type { KnowledgeNode } from '~~/server/utils/knowledgeNodes'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const id = String(route.params.id)
const { api } = useAgent()
const projectId = ref('')

const form = reactive({ name: '', description: '', status: 'draft', systemPrompt: '', model: '', endpoint: '', apiKey: '', temperature: 0.2, autoReply: false, fallbackBehavior: 'human', minConfidence: 0, defaultAction: 'auto' })
const hasApiKey = ref(false)
const llm = ref<{ configured: boolean, model: string, usingDefaultEndpoint: boolean } | null>(null)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const idCopied = ref(false)

// Rules are edited with keywords as a comma-separated string, converted to an array on save.
const rules = ref<{ conversationType: string, keywordsText: string, action: 'auto' | 'human' }[]>([])
const types = ref<ConversationType[]>([])
const confidencePct = computed({
  get: () => Math.round((form.minConfidence || 0) * 100),
  set: (v: number) => { form.minConfidence = Math.min(Math.max(Number(v) || 0, 0), 100) / 100 }
})

const statusItems = SUPPORT_AGENT_STATUSES.map(s => ({ label: s, value: s }))
const fallbackItems = AGENT_FALLBACKS.map(s => ({ label: s === 'human' ? 'Hand to a human' : 'Stay silent', value: s }))
const scopeItems = ASSIGNMENT_SCOPES.map(s => ({ label: s, value: s }))
const actionItems = AGENT_RULE_ACTIONS.map(a => ({ label: a === 'auto' ? 'Answer with AI' : 'Leave for a human', value: a }))
const typeItems = computed(() => types.value.map(t => ({ label: t.name, value: t.key })))
function addRule() { rules.value.push({ conversationType: '', keywordsText: '', action: 'human' }) }
function removeRule(index: number) { rules.value.splice(index, 1) }
async function copyId() { await navigator.clipboard?.writeText(id).catch(() => {}); idCopied.value = true; setTimeout(() => { idCopied.value = false }, 1500) }

async function load() {
  const res = await api<{ agent: SupportAgent, llm: typeof llm.value }>(`/admin/support-agents/${id}`)
  const a = res.agent
  Object.assign(form, { name: a.name, description: a.description, status: a.status, systemPrompt: a.systemPrompt, model: a.model, endpoint: a.endpoint, apiKey: '', temperature: a.temperature, autoReply: a.autoReply, fallbackBehavior: a.fallbackBehavior, minConfidence: a.minConfidence, defaultAction: a.defaultAction })
  rules.value = (a.rules || []).map(r => ({ conversationType: r.conversationType || '', keywordsText: (r.keywords || []).join(', '), action: r.action }))
  projectId.value = a.projectId
  hasApiKey.value = a.hasApiKey
  llm.value = res.llm
}

async function save() {
  saving.value = true
  error.value = ''
  saved.value = false
  const body: Record<string, unknown> = { ...form }
  body.rules = rules.value.map(r => ({ conversationType: r.conversationType, keywords: r.keywordsText.split(',').map(s => s.trim()).filter(Boolean), action: r.action }))
  if (!form.apiKey) delete body.apiKey // don't overwrite an existing key with blank
  try {
    await api(`/admin/support-agents/${id}`, { method: 'PATCH', body })
    form.apiKey = ''
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
    await load()
  } catch (e: any) { error.value = e?.message || 'Could not save' } finally { saving.value = false }
}

async function duplicate() {
  const { agent } = await api<{ agent: SupportAgent }>(`/admin/support-agents/${id}/duplicate`, { method: 'POST' })
  await navigateTo(`/assistants/${agent.id}`)
}
async function remove() {
  if (!confirm(`Delete “${form.name}”? Its knowledge assignments are removed too.`)) return
  await api(`/admin/support-agents/${id}`, { method: 'DELETE' })
  await navigateTo(projectId.value ? `/projects/${projectId.value}/assistants` : '/assistants')
}

// --- assignments ---
const assignments = ref<KnowledgeAssignment[]>([])
const models = ref<KnowledgeModel[]>([])
const assignNodes = ref<KnowledgeNode[]>([])
const assignFaqs = ref<{ id: string, question: string }[]>([])
const assignForm = reactive({ scope: 'model', modelId: '', nodeId: '', faqId: '', exclude: false })
const addingAssign = ref(false)
const assignError = ref('')

const modelItems = computed(() => models.value.map(m => ({ label: m.name, value: m.id })))
const assignNodeItems = computed(() => assignNodes.value.map(n => ({ label: n.pathCache, value: n.id })))
const assignFaqItems = computed(() => assignFaqs.value.map(f => ({ label: f.question, value: f.id })))
const modelName = (mid: string) => models.value.find(m => m.id === mid)?.name || 'model'

function describeAssignment(a: KnowledgeAssignment) {
  if (a.scope === 'model') return `Entire model: ${modelName(a.modelId)}`
  if (a.scope === 'path') return `Path: ${modelName(a.modelId)} › ${a.pathCache}`
  return `Single FAQ in ${modelName(a.modelId)}`
}

async function loadAssignments() { assignments.value = (await api<{ assignments: KnowledgeAssignment[] }>(`/admin/support-agents/${id}/assignments`)).assignments }
async function loadModels() { models.value = (await api<{ models: KnowledgeModel[] }>(`/admin/knowledge/models?projectId=${projectId.value}`)).models }
async function onAssignModel(modelId: string) {
  assignForm.nodeId = ''; assignForm.faqId = ''
  if (!modelId) { assignNodes.value = []; assignFaqs.value = []; return }
  assignNodes.value = (await api<{ nodes: KnowledgeNode[] }>(`/admin/knowledge/nodes?modelId=${modelId}`)).nodes
  assignFaqs.value = (await api<{ faqs: { id: string, question: string }[] }>(`/admin/knowledge/faqs?modelId=${modelId}&limit=100`)).faqs
}
async function addAssignment() {
  addingAssign.value = true
  assignError.value = ''
  try {
    await api(`/admin/support-agents/${id}/assignments`, { method: 'POST', body: { scope: assignForm.scope, modelId: assignForm.modelId, nodeId: assignForm.nodeId, faqId: assignForm.faqId, exclude: assignForm.exclude } })
    Object.assign(assignForm, { nodeId: '', faqId: '', exclude: false })
    await loadAssignments()
  } catch (e: any) { assignError.value = e?.message || 'Could not add access' } finally { addingAssign.value = false }
}
async function removeAssignment(assignmentId: string) {
  await api(`/admin/support-agents/${id}/assignments/${assignmentId}`, { method: 'DELETE' })
  await loadAssignments()
}

// --- test retrieval ---
const testQuery = ref('')
const testing = ref(false)
const tested = ref(false)
const results = ref<{ faqId: string, question: string, answer: string, pathCache: string, score: number, source: { section: string } }[]>([])
async function test() {
  testing.value = true
  try {
    results.value = (await api<{ results: typeof results.value }>(`/admin/support-agents/${id}/retrieve`, { method: 'POST', body: { query: testQuery.value } })).results
    tested.value = true
  } finally { testing.value = false }
}

async function loadTypes() { if (!projectId.value) return; try { types.value = (await api<{ types: ConversationType[] }>(`/admin/projects/${projectId.value}/types`)).types } catch { /* built-in support type still selectable as Any */ } }
onMounted(async () => { await load(); await Promise.all([loadAssignments(), loadModels(), loadTypes()]) })
</script>
