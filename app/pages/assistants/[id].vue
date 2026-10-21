<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="projectId || undefined" :crumbs="projectId ? [{ label: $t('assistants.breadcrumb'), to: `/projects/${projectId}/assistants` }] : []" :title="form.name || $t('assistants.defaultTitle')">
      <template #actions>
        <UButton icon="i-lucide-copy" :label="$t('assistants.duplicate')" color="neutral" variant="ghost" size="sm" @click="duplicate" />
        <UButton icon="i-lucide-trash-2" :label="$t('assistants.delete')" color="error" variant="ghost" size="sm" @click="remove" />
      </template>
    </PageHeader>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-2xl space-y-12 px-6 py-8">
        <AssistantReadiness v-if="readiness" :readiness="readiness" />

        <!-- config -->
        <form id="assistant-form" class="scroll-mt-6 space-y-4" @submit.prevent="save">
          <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('assistants.configuration') }}</h2>
          <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{{ $t('assistants.assistantId') }}</span>
            <code class="font-mono bg-elevated px-1.5 py-0.5 rounded select-all">{{ id }}</code>
            <UButton size="xs" variant="ghost" color="neutral" :icon="idCopied ? 'i-lucide-check' : 'i-lucide-clipboard'" :aria-label="$t('assistants.copyId')" @click="copyId" />
            <span>{{ $t('assistants.idHint') }}</span>
          </div>
          <div class="grid sm:grid-cols-2 gap-4">
            <UFormField :label="$t('common.name')"><UInput v-model="form.name" class="w-full" required /></UFormField>
            <UFormField :label="$t('assistants.status')"><USelect v-model="form.status" :items="statusItems" class="w-full" /></UFormField>
          </div>
          <UFormField :label="$t('assistants.description')"><UInput v-model="form.description" class="w-full" /></UFormField>
          <UFormField :label="$t('assistants.systemPrompt')" :hint="$t('assistants.systemPromptHint')">
            <UTextarea v-model="form.systemPrompt" class="w-full" :rows="4" :placeholder="$t('assistants.systemPromptPlaceholder')" />
          </UFormField>

          <details class="rounded-lg border border-default p-3">
            <summary class="cursor-pointer text-sm font-medium">{{ $t('assistants.modelConnection') }} <span class="font-normal text-dimmed">{{ $t('assistants.advanced') }}</span></summary>
            <div class="mt-3 space-y-4">
              <div class="grid sm:grid-cols-2 gap-4">
                <UFormField :label="$t('assistants.model')" :hint="$t('assistants.defaultModel', { model: DEFAULT_LLM_MODEL })"><UInput v-model="form.model" class="w-full" :placeholder="DEFAULT_LLM_MODEL" /></UFormField>
                <UFormField :label="$t('assistants.temperature')"><UInput v-model.number="form.temperature" type="number" step="0.1" min="0" max="2" class="w-full" /></UFormField>
              </div>
              <UFormField :label="$t('assistants.endpoint')" :hint="$t('assistants.endpointHint')">
                <UInput v-model="form.endpoint" class="w-full" placeholder="https://litellm.example.com" />
              </UFormField>
              <UFormField :label="$t('assistants.apiKey')" :hint="hasApiKey ? $t('assistants.apiKeySet') : $t('assistants.apiKeyBlank')">
                <UInput v-model="form.apiKey" type="password" class="w-full" :placeholder="hasApiKey ? $t('assistants.apiKeySetPlaceholder') : ''" autocomplete="off" />
              </UFormField>
              <p class="text-xs" :class="llm?.configured ? 'text-muted' : 'text-warning'">
                {{ llm?.configured ? $t('assistants.ready', { model: llm.model, endpoint: llm.usingDefaultEndpoint ? $t('assistants.defaultEndpoint') : $t('assistants.customEndpoint') }) : $t('assistants.notConfigured') }}
              </p>
            </div>
          </details>

          <UFormField :label="$t('assistants.fallback')" :hint="$t('assistants.fallbackHint')"><USelect v-model="form.fallbackBehavior" :items="fallbackItems" class="w-full sm:w-64" /></UFormField>
          <div class="flex items-center gap-3">
            <USwitch v-model="form.autoReply" />
            <span class="text-sm">{{ $t('assistants.autoReply') }}<span class="text-dimmed"> {{ $t('assistants.autoReplyHint') }}</span></span>
          </div>

          <div v-if="form.autoReply" class="space-y-4 rounded-lg border border-default p-3">
            <h3 class="text-[13px] font-medium text-highlighted">{{ $t('assistants.whenAi') }}</h3>
            <UFormField :label="$t('assistants.minConfidence')" :hint="$t('assistants.minConfidenceHint')">
              <div class="flex items-center gap-3">
                <input v-model.number="confidencePct" type="range" min="0" max="100" step="5" class="flex-1 accent-primary-600">
                <span class="w-12 text-right text-sm tabular-nums">{{ confidencePct }}%</span>
              </div>
            </UFormField>
            <UFormField :label="$t('assistants.noRuleMatches')" :hint="$t('assistants.noRuleMatchesHint')">
              <USelect v-model="form.defaultAction" :items="actionItems" class="w-full sm:w-64" />
            </UFormField>
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">{{ $t('assistants.rules') }}</span>
                <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-plus" @click="addRule">{{ $t('assistants.addRule') }}</UButton>
              </div>
              <p class="text-xs text-muted">{{ $t('assistants.rulesHint') }}</p>
              <p v-if="!rules.length" class="text-sm text-muted border border-dashed border-accented rounded-lg p-4 text-center">{{ $t('assistants.noRules') }}</p>
              <div v-for="(rule, i) in rules" :key="i" class="flex flex-wrap items-end gap-2 rounded-lg bg-elevated/60 p-2">
                <UFormField :label="$t('assistants.ticketType')" class="w-40"><OptionalSelect v-model="rule.conversationType" :items="typeItems" :none-label="$t('assistants.anyType')" class="w-full" /></UFormField>
                <UFormField :label="$t('assistants.keywords')" :hint="$t('assistants.commaSeparated')" class="flex-1 min-w-[10rem]"><UInput v-model="rule.keywordsText" class="w-full" :placeholder="$t('assistants.keywordsPlaceholder')" /></UFormField>
                <UFormField :label="$t('assistants.then')" class="w-44"><USelect v-model="rule.action" :items="actionItems" class="w-full" /></UFormField>
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" class="mb-1.5" :aria-label="$t('assistants.removeRule')" @click="removeRule(i)" />
              </div>
            </div>
          </div>

          <p v-if="error" class="text-sm text-error">{{ error }}</p>
          <div class="flex items-center gap-3">
            <UButton type="submit" color="primary" :loading="saving">{{ $t('assistants.save') }}</UButton>
            <span v-if="saved" class="text-sm text-muted">{{ $t('common.saved') }}</span>
          </div>
        </form>

        <!-- knowledge assignments -->
        <div id="knowledge-access" class="scroll-mt-6 space-y-3">
          <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('assistants.knowledgeAccess') }}</h2>
          <p v-if="!assignments.length" class="text-sm text-muted border border-dashed border-accented rounded-xl p-6 text-center">
            {{ $t('assistants.noAccess') }}
          </p>
          <ul v-else class="divide-y divide-default border-y border-default">
            <li v-for="a in assignments" :key="a.id" class="flex items-center gap-2 py-2 text-sm">
              <UBadge size="xs" variant="subtle" :color="a.exclude ? 'error' : 'primary'">{{ a.exclude ? $t('assistants.exclude') : $t(`assistants.scopes.${a.scope}`) }}</UBadge>
              <span class="truncate">{{ describeAssignment(a) }}</span>
              <UButton class="ml-auto" size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="removeAssignment(a.id)" />
            </li>
          </ul>

          <form class="flex flex-wrap items-end gap-2 rounded-lg bg-elevated/60 p-3" @submit.prevent="addAssignment">
            <UFormField :label="$t('assistants.grant')" class="w-28"><USelect v-model="assignForm.scope" :items="scopeItems" class="w-full" /></UFormField>
            <UFormField :label="$t('assistants.model')" class="flex-1 min-w-[10rem]"><USelect v-model="assignForm.modelId" :items="modelItems" class="w-full" @update:model-value="onAssignModel" /></UFormField>
            <UFormField v-if="assignForm.scope === 'path'" :label="$t('assistants.path')" class="flex-1 min-w-[10rem]"><USelect v-model="assignForm.nodeId" :items="assignNodeItems" class="w-full" /></UFormField>
            <UFormField v-if="assignForm.scope === 'faq'" :label="$t('assistants.faq')" class="flex-1 min-w-[12rem]">
              <USelect v-model="assignForm.faqId" :items="assignFaqItems" class="w-full" />
            </UFormField>
            <div class="flex items-center gap-1"><UCheckbox v-model="assignForm.exclude" /><span class="text-xs text-muted">{{ $t('assistants.exclude') }}</span></div>
            <UButton type="submit" size="sm" color="neutral" variant="soft" :loading="addingAssign">{{ $t('assistants.add') }}</UButton>
          </form>
          <p v-if="assignError" class="text-sm text-error">{{ assignError }}</p>
        </div>

        <!-- test answer -->
        <AssistantTestAnswer :assistant-id="id" :types="types" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SUPPORT_AGENT_STATUSES, AGENT_FALLBACKS, AGENT_RULE_ACTIONS, ASSIGNMENT_SCOPES, DEFAULT_LLM_MODEL, type AssistantReadiness } from '#shared/knowledge'
import type { ConversationType } from '#shared/support'
import type { SupportAgent } from '~~/server/utils/supportAgents'
import type { KnowledgeAssignment } from '~~/server/utils/agentKnowledge'
import type { KnowledgeModel } from '~~/server/utils/knowledgeModels'
import type { KnowledgeNode } from '~~/server/utils/knowledgeNodes'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const id = String(route.params.id)
const { api } = useAgent()
const { t } = useI18n()
const projectId = ref('')

const form = reactive({ name: '', description: '', status: 'draft', systemPrompt: '', model: '', endpoint: '', apiKey: '', temperature: 0.2, autoReply: false, fallbackBehavior: 'human', minConfidence: 0, defaultAction: 'auto' })
const hasApiKey = ref(false)
const llm = ref<{ configured: boolean, model: string, usingDefaultEndpoint: boolean } | null>(null)
const readiness = ref<AssistantReadiness | null>(null)
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

const statusItems = computed(() => SUPPORT_AGENT_STATUSES.map(s => ({ label: t(`assistants.statuses.${s}`), value: s })))
const fallbackItems = computed(() => AGENT_FALLBACKS.map(s => ({ label: t(s === 'human' ? 'assistants.fallbackHuman' : 'assistants.fallbackSilent'), value: s })))
const scopeItems = computed(() => ASSIGNMENT_SCOPES.map(s => ({ label: t(`assistants.scopes.${s}`), value: s })))
const actionItems = computed(() => AGENT_RULE_ACTIONS.map(a => ({ label: t(a === 'auto' ? 'assistants.actionAuto' : 'assistants.actionHuman'), value: a })))
const typeItems = computed(() => types.value.map(t => ({ label: t.name, value: t.key })))
function addRule() { rules.value.push({ conversationType: '', keywordsText: '', action: 'human' }) }
function removeRule(index: number) { rules.value.splice(index, 1) }
async function copyId() { await navigator.clipboard?.writeText(id).catch(() => {}); idCopied.value = true; setTimeout(() => { idCopied.value = false }, 1500) }

async function load() {
  const res = await api<{ agent: SupportAgent, llm: typeof llm.value, readiness: AssistantReadiness }>(`/admin/support-agents/${id}`)
  readiness.value = res.readiness
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
  } catch (e: any) { error.value = e?.message || t('assistants.couldNotSave') } finally { saving.value = false }
}

async function duplicate() {
  const { agent } = await api<{ agent: SupportAgent }>(`/admin/support-agents/${id}/duplicate`, { method: 'POST' })
  await navigateTo(`/assistants/${agent.id}`)
}
async function remove() {
  if (!confirm(t('assistants.deleteConfirm', { name: form.name }))) return
  await api(`/admin/support-agents/${id}`, { method: 'DELETE' })
  // There is no /assistants list: an assistant with no project goes back to the workspace's agents.
  await navigateTo(projectId.value ? `/projects/${projectId.value}/assistants` : '/agents')
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
const modelName = (mid: string) => models.value.find(m => m.id === mid)?.name || t('assistants.modelFallback')

function describeAssignment(a: KnowledgeAssignment) {
    if (a.scope === 'model') return t('assistants.entireModel', { model: modelName(a.modelId) })
  if (a.scope === 'path') return t('assistants.pathOf', { model: modelName(a.modelId), path: a.pathCache })
  return t('assistants.singleFaq', { model: modelName(a.modelId) })
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
    await Promise.all([loadAssignments(), refreshReadiness()])
  } catch (e: any) { assignError.value = e?.message || t('assistants.couldNotAddAccess') } finally { addingAssign.value = false }
}
async function removeAssignment(assignmentId: string) {
  await api(`/admin/support-agents/${id}/assignments/${assignmentId}`, { method: 'DELETE' })
  await Promise.all([loadAssignments(), refreshReadiness()])
}

// What the strip says depends on the knowledge assigned, so it reads again when that changes.
async function refreshReadiness() {
  readiness.value = (await api<{ readiness: AssistantReadiness }>(`/admin/support-agents/${id}`)).readiness
}

async function loadTypes() { if (!projectId.value) return; try { types.value = (await api<{ types: ConversationType[] }>(`/admin/projects/${projectId.value}/types`)).types } catch { /* built-in support type still selectable as Any */ } }
onMounted(async () => { await load(); await Promise.all([loadAssignments(), loadModels(), loadTypes()]) })
</script>
