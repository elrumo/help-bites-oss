<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="model?.projectId" :crumbs="model ? [{ label: $t('sections.knowledge'), to: `/projects/${model.projectId}/knowledge` }] : []" :title="model?.name || $t('knowledge.model.fallbackTitle')">
      <template #title><StatusDot v-if="model" :status="model.status" class="ml-1" /></template>
      <template #actions>
        <UButton icon="i-lucide-sparkles" :label="$t('knowledge.model.test')" color="neutral" variant="ghost" size="sm" class="hidden sm:inline-flex" @click="openTester" />
        <UButton icon="i-lucide-file-up" :label="$t('knowledge.model.import')" color="neutral" variant="outline" size="sm" @click="showImport = true" />
        <UButton icon="i-lucide-plus" :label="$t('knowledge.newFaq')" size="sm" @click="openFaq('')" />
        <UDropdownMenu :items="modelMenu" :content="{ align: 'end' }">
          <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" square :aria-label="$t('knowledge.model.moreActions')" />
        </UDropdownMenu>
      </template>
    </PageHeader>

    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-default px-4 py-2.5">
      <UInput v-model="faqSearch" icon="i-lucide-search" :placeholder="$t('knowledge.model.searchPlaceholder')" size="sm" class="min-w-48 flex-1 sm:max-w-72" @keyup.enter="reloadFaqs" />
      <OptionalSelect v-model="faqStatus" :items="faqStatusItems" :none-label="$t('knowledge.model.allStatuses')" size="sm" class="w-32" :aria-label="$t('knowledge.statusLabel')" @update:model-value="reloadFaqs" />
      <OptionalSelect v-model="faqNode" :items="nodeItems" :none-label="$t('knowledge.model.allThemes')" size="sm" class="w-40" :aria-label="$t('knowledge.theme')" @update:model-value="reloadFaqs" />
      <div v-if="dashboard" class="ml-auto hidden flex-wrap items-center gap-x-4 gap-y-1 lg:flex">
        <KnowledgeStat :n="dashboard.faqsTotal" :label="$t('knowledge.stats.faqs')" />
        <KnowledgeStat :n="dashboard.faqsActive" :label="$t('knowledge.stats.active')" />
        <KnowledgeStat :n="dashboard.faqsDraft" :label="$t('knowledge.stats.draft')" />
        <KnowledgeStat :n="dashboard.faqsOutdated" :label="$t('knowledge.stats.outdated')" :warn="dashboard.faqsOutdated > 0" />
        <KnowledgeStat :n="dashboard.nodes" :label="$t('knowledge.stats.themes')" />
        <KnowledgeStat :n="dashboard.documents" :label="$t('knowledge.stats.documents')" />
        <KnowledgeStat :n="dashboard.agents" :label="$t('knowledge.stats.assistants')" />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-2">
      <p v-if="model?.description" class="px-6 pb-2 pt-1 text-[13px] text-muted">{{ model.description }}</p>
      <div v-if="faqsLoading && !faqs.length" class="space-y-1 px-4 py-2"><USkeleton v-for="i in 6" :key="i" class="h-9" /></div>
      <EmptyState v-else-if="!faqs.length" icon="i-lucide-message-circle-question" :title="$t('knowledge.model.emptyTitle')" :description="$t('knowledge.model.emptyDescription')">
        <UButton icon="i-lucide-file-up" :label="$t('knowledge.model.importDocument')" color="neutral" variant="outline" @click="showImport = true" />
        <UButton icon="i-lucide-plus" :label="$t('knowledge.newFaq')" @click="openFaq('')" />
      </EmptyState>
      <div
        v-for="f in faqs"
        v-else
        :key="f.id"
        class="group mx-2 flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors hover:bg-elevated"
        :class="selectedFaqs.has(f.id) ? 'bg-primary-500/8' : ''"
      >
        <UCheckbox :model-value="selectedFaqs.has(f.id)" :class="selectedFaqs.size ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'" :aria-label="$t('knowledge.model.selectFaq', { question: f.question })" @update:model-value="toggleSelect(f.id)" @click.stop />
        <UContextMenu :items="faqMenu(f)" class="min-w-0 flex-1">
          <button class="flex w-full min-w-0 items-baseline gap-2 text-left" @click="openFaq(f.id)">
            <span class="shrink-0 truncate font-medium text-highlighted sm:max-w-[60%]">{{ f.question }}</span>
            <span class="hidden truncate text-muted sm:inline">{{ f.pathCache || $t('knowledge.model.noTheme') }}</span>
          </button>
        </UContextMenu>
        <span class="hidden w-16 truncate text-xs text-dimmed sm:inline" :title="f.origin">{{ $t(`knowledge.origin.${f.origin}`) }}</span>
        <span class="hidden w-10 items-center gap-1 text-xs text-dimmed md:inline-flex" :title="$t('knowledge.units.assistant', f.agents?.length || 0)"><UIcon name="i-lucide-sparkles" class="size-3" />{{ f.agents?.length || 0 }}</span>
        <StatusDot :status="f.status" class="w-20" />
        <span class="hidden w-16 text-right text-xs text-muted lg:inline">{{ f.updatedAt ? new Date(f.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '' }}</span>
      </div>

      <div v-if="faqTotal > faqLimit" class="flex items-center justify-between px-6 pt-3 text-xs text-muted">
        <span class="tabular-nums">{{ $t('knowledge.model.pageRange', { from: faqSkip + 1, to: Math.min(faqSkip + faqLimit, faqTotal), total: faqTotal }) }}</span>
        <div class="flex gap-1">
          <UButton icon="i-lucide-chevron-left" size="xs" color="neutral" variant="outline" square :aria-label="$t('knowledge.model.previousPage')" :disabled="faqSkip === 0" @click="pageFaqs(-1)" />
          <UButton icon="i-lucide-chevron-right" size="xs" color="neutral" variant="outline" square :aria-label="$t('knowledge.model.nextPage')" :disabled="faqSkip + faqLimit >= faqTotal" @click="pageFaqs(1)" />
        </div>
      </div>
    </div>

    <!-- Linear's selection bar: floats over the list while FAQs are selected. -->
    <div v-if="selectedFaqs.size" class="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-default bg-default py-1.5 pl-3 pr-1.5 text-[13px] shadow-2xl">
      <span class="whitespace-nowrap font-medium tabular-nums text-highlighted">{{ $t('knowledge.selectedCount', { count: selectedFaqs.size }) }}</span>
      <USelect v-model="bulkStatus" :items="faqStatusItems" size="sm" class="w-32" :placeholder="$t('knowledge.model.setStatus')" @update:model-value="bulkSetStatus" />
      <USelect v-model="bulkNode" :items="nodeItems" size="sm" class="w-36" :placeholder="$t('knowledge.model.moveToTheme')" @update:model-value="bulkMove" />
      <UButton icon="i-lucide-trash-2" size="sm" color="error" variant="ghost" square :aria-label="$t('knowledge.model.deleteSelected')" @click="bulkDelete" />
      <UButton icon="i-lucide-x" size="sm" color="neutral" variant="ghost" square :aria-label="$t('knowledge.model.clearSelection')" @click="selectedFaqs.clear()" />
    </div>

    <!-- modals -->
    <KnowledgeImportModal v-model:open="showImport" :model-id="id" :nodes="nodes" :initial-preview="replacePreview" @imported="afterImport" />
    <KnowledgeFaqEditor v-model:open="showFaq" :model-id="id" :faq-id="editFaqId" :nodes="nodes" @saved="afterFaqSaved" />

    <!-- Themes (formerly the Tree tab) -->
    <UModal v-model:open="showThemes" :title="$t('knowledge.model.themes')" :description="$t('knowledge.model.themesDescription')">
      <template #body>
        <div class="grid sm:grid-cols-2 gap-5">
          <KnowledgeTree ref="treeRef" :model-id="id" @changed="onStructureChanged" @select="onThemeSelect" />
          <div class="min-w-0">
            <p v-if="!themeSelected" class="text-sm text-muted">{{ $t('knowledge.model.selectThemePrompt') }}</p>
            <template v-else>
              <div class="mb-2 flex items-center justify-between gap-2">
                <p class="min-w-0 truncate text-sm font-medium">{{ themeSelectedLabel }}</p>
                <UButton size="xs" variant="ghost" color="neutral" @click="filterByTheme">{{ $t('knowledge.model.showInList') }}</UButton>
              </div>
              <p v-if="!themeFaqs.length" class="text-xs text-muted">{{ $t('knowledge.model.noThemeFaqs') }}</p>
              <ul v-else class="max-h-72 divide-y divide-default overflow-y-auto border-y border-default">
                <li v-for="f in themeFaqs" :key="f.id" class="py-1.5">
                  <button class="w-full truncate text-left text-sm hover:text-primary-600" @click="openFaq(f.id)">{{ f.question }}</button>
                </li>
              </ul>
            </template>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Documents (formerly the Documents tab) -->
    <UModal v-model:open="showDocs" :title="$t('knowledge.model.sourceDocuments')" :description="$t('knowledge.model.documentsDescription')">
      <template #body>
        <div class="space-y-3">
          <div class="flex justify-end">
            <UButton color="primary" size="xs" icon="i-lucide-file-up" @click="showImport = true">{{ $t('knowledge.model.import') }}</UButton>
          </div>
          <p v-if="!documents.length && !docsLoading" class="text-sm text-muted border border-dashed border-accented rounded-xl p-8 text-center">
            {{ $t('knowledge.model.noDocumentsBefore') }} <code>SUPPORT_FAQ.md</code> {{ $t('knowledge.model.noDocumentsAfter') }}
          </p>
          <ul v-else class="divide-y divide-default border-y border-default">
            <li v-for="d in documents" :key="d.id" class="flex items-center gap-3 py-3">
              <UIcon name="i-lucide-file-text" class="size-5 text-dimmed shrink-0" />
              <div class="min-w-0 flex-1">
                <span class="block text-sm font-medium truncate">{{ d.originalFilename }} <span class="text-xs font-normal text-dimmed">v{{ d.version }}</span></span>
                <span class="block text-xs text-muted">{{ $t('knowledge.units.faq', d.faqCount) }} · {{ new Date(d.createdAt || Date.now()).toLocaleDateString() }}</span>
                <span v-if="d.status === 'failed' && d.processingError" class="block text-xs text-error truncate">{{ d.processingError }}</span>
              </div>
              <StatusDot :status="d.status" />
              <div class="flex items-center gap-1">
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-download" :aria-label="$t('knowledge.model.download')" @click="download(d)" />
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-refresh-cw" :aria-label="$t('knowledge.model.reprocess')" :loading="busyDoc === d.id" @click="reprocess(d)" />
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-upload" :aria-label="$t('knowledge.model.replace')" @click="pickReplace(d)" />
                <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-trash-2" :aria-label="$t('knowledge.delete')" @click="removeDoc(d)" />
              </div>
            </li>
          </ul>
          <input ref="replaceInput" type="file" accept=".md,.markdown,.txt" class="hidden" @change="doReplace">
        </div>
      </template>
    </UModal>

    <!-- Model settings + danger zone -->
    <UModal v-model:open="showEdit" :title="$t('knowledge.model.settings')">
      <template #body>
        <form class="space-y-4" @submit.prevent="saveEdit">
          <UFormField :label="$t('common.name')"><UInput v-model="editForm.name" class="w-full" required /></UFormField>
          <UFormField :label="$t('knowledge.description')"><UTextarea v-model="editForm.description" class="w-full" :rows="3" /></UFormField>
          <div class="grid grid-cols-2 gap-4">
            <UFormField :label="$t('knowledge.statusLabel')"><USelect v-model="editForm.status" :items="modelStatusItems" class="w-full" /></UFormField>
            <UFormField :label="$t('knowledge.model.defaultLanguage')"><UInput v-model="editForm.defaultLanguage" class="w-full" /></UFormField>
          </div>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="showEdit = false">{{ $t('common.cancel') }}</UButton>
            <UButton type="submit" color="primary" :loading="savingEdit">{{ $t('knowledge.save') }}</UButton>
          </div>
        </form>
        <div class="mt-4 border-t border-default pt-3 space-y-2">
          <p class="text-sm font-medium text-error">{{ $t('knowledge.model.dangerZone') }}</p>
          <div class="flex gap-2">
            <UButton size="sm" color="neutral" variant="soft" @click="archive">{{ $t('knowledge.model.archive') }}</UButton>
            <UButton size="sm" color="error" variant="soft" @click="removeModel">{{ $t('knowledge.model.deleteModel') }}</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Floating assistant tester -->
    <div v-if="showTester" class="fixed bottom-4 right-4 z-50 flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-2xl border border-default bg-default shadow-xl">
      <header class="flex items-center gap-2 border-b border-default px-3 py-2">
        <UIcon name="i-lucide-sparkles" class="size-4 text-primary-600" />
        <span class="text-sm font-medium">{{ $t('knowledge.model.testTitle') }}</span>
        <UButton class="ml-auto" size="xs" variant="ghost" color="neutral" icon="i-lucide-x" :aria-label="$t('knowledge.model.closeTester')" @click="showTester = false" />
      </header>
      <div class="space-y-3 overflow-y-auto p-3">
        <USelect v-model="testerAssistantId" :items="testerAssistantItems" :placeholder="$t('knowledge.model.pickAssistant')" class="w-full" />
        <p v-if="!testerAssistants.length" class="text-xs text-muted">{{ $t('knowledge.model.noAssistants') }}</p>
        <div v-if="testerLoading || testerAnswer" class="rounded-lg bg-elevated p-2.5 text-sm">
          <p v-if="testerLoading" class="text-muted">{{ $t('knowledge.model.thinking') }}</p>
          <MarkdownBlock v-else :text="testerAnswer" />
        </div>
        <div v-if="testerKnowledge.length" class="text-xs text-muted">
          <p class="mb-1 font-medium">{{ $t('knowledge.model.groundedIn', testerKnowledge.length) }}</p>
          <ul class="space-y-0.5">
            <li v-for="k in testerKnowledge" :key="k.faqId" class="truncate">· {{ k.question }} <span class="text-dimmed">{{ (k.score * 100).toFixed(0) }}%</span></li>
          </ul>
        </div>
        <p v-if="testerError" class="text-xs text-error">{{ testerError }}</p>
      </div>
      <form class="flex gap-2 border-t border-default p-2" @submit.prevent="runTester">
        <UInput v-model="testerQuery" :placeholder="$t('knowledge.model.askPlaceholder')" class="flex-1" :disabled="!testerAssistantId" />
        <UButton type="submit" size="sm" color="primary" square :loading="testerLoading" :disabled="!testerAssistantId || !testerQuery.trim()" icon="i-lucide-send" :aria-label="$t('knowledge.model.ask')" />
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import { FAQ_STATUSES, KNOWLEDGE_MODEL_STATUSES, type ImportPreview } from '#shared/knowledge'
import type { KnowledgeModel, ModelDashboard } from '~~/server/utils/knowledgeModels'
import type { KnowledgeNode } from '~~/server/utils/knowledgeNodes'
import type { Faq } from '~~/server/utils/faqs'
import type { KnowledgeDocument } from '~~/server/utils/knowledgeDocuments'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const id = String(route.params.id)
const { api, agentHeaders } = useAgent()
const { t } = useI18n()

type FaqRow = Faq & { agents: { id: string, name: string }[] }

const model = ref<KnowledgeModel | null>(null)
const dashboard = ref<ModelDashboard | null>(null)
const nodes = ref<KnowledgeNode[]>([])
const treeRef = ref<{ reload: () => void } | null>(null)


const modelStatusItems = computed(() => KNOWLEDGE_MODEL_STATUSES.map(s => ({ label: t(`knowledge.status.${s}`), value: s })))
const faqStatusItems = computed(() => FAQ_STATUSES.map(s => ({ label: t(`knowledge.status.${s}`), value: s })))
const nodeItems = computed(() => nodes.value.map(n => ({ label: n.pathCache, value: n.id })))

// --- loaders ---
async function loadModel() { model.value = (await api<{ model: KnowledgeModel }>(`/admin/knowledge/models/${id}`)).model }
async function loadDashboard() { dashboard.value = (await api<{ dashboard: ModelDashboard }>(`/admin/knowledge/models/${id}/dashboard`)).dashboard }
async function loadNodes() { nodes.value = (await api<{ nodes: KnowledgeNode[] }>(`/admin/knowledge/nodes?modelId=${id}`)).nodes }

// --- faqs ---
const faqs = ref<FaqRow[]>([])
const faqTotal = ref(0)
const faqsLoading = ref(false)
const faqSearch = ref('')
const faqStatus = ref('')
const faqNode = ref('')
const faqSkip = ref(0)
const faqLimit = 50
const selectedFaqs = reactive(new Set<string>())
const bulkStatus = ref('')
const bulkNode = ref('')

async function reloadFaqs() { faqSkip.value = 0; await loadFaqs() }
async function loadFaqs() {
  faqsLoading.value = true
  try {
    const params = new URLSearchParams({ modelId: id, limit: String(faqLimit), skip: String(faqSkip.value) })
    if (faqSearch.value.trim()) params.set('q', faqSearch.value.trim())
    if (faqStatus.value) params.set('status', faqStatus.value)
    if (faqNode.value) params.set('nodeId', faqNode.value)
    const res = await api<{ faqs: FaqRow[], total: number }>(`/admin/knowledge/faqs?${params}`)
    faqs.value = res.faqs
    faqTotal.value = res.total
  } finally { faqsLoading.value = false }
}
function pageFaqs(dir: number) { faqSkip.value = Math.max(0, faqSkip.value + dir * faqLimit); loadFaqs() }
function toggleSelect(faqId: string) { selectedFaqs.has(faqId) ? selectedFaqs.delete(faqId) : selectedFaqs.add(faqId) }

async function bulk(action: string, extra: Record<string, unknown> = {}) {
  await api('/admin/knowledge/faqs/bulk', { method: 'POST', body: { ids: [...selectedFaqs], action, ...extra } })
  selectedFaqs.clear()
  await Promise.all([loadFaqs(), loadDashboard()])
}
async function bulkSetStatus(status: string) { if (status) { await bulk('status', { status }); bulkStatus.value = '' } }
async function bulkMove(nodeId: string) { await bulk('move', { nodeId }); bulkNode.value = '' }
async function bulkDelete() { if (confirm(t('knowledge.model.bulkDeleteConfirm', selectedFaqs.size))) await bulk('delete') }

// --- per-FAQ actions (right-click context menu) ---
async function moveFaq(faqId: string, nodeId: string) {
  await api(`/admin/knowledge/faqs/${faqId}`, { method: 'PATCH', body: { nodeId } })
  await Promise.all([loadFaqs(), loadNodes(), loadDashboard()])
}
async function setFaqStatus(faqId: string, status: string) {
  await api(`/admin/knowledge/faqs/${faqId}`, { method: 'PATCH', body: { status } })
  await Promise.all([loadFaqs(), loadDashboard()])
}
async function deleteFaq(f: FaqRow) {
  if (!confirm(t('knowledge.model.deleteFaqConfirm', { question: f.question }))) return
  await api(`/admin/knowledge/faqs/${f.id}`, { method: 'DELETE' })
  await Promise.all([loadFaqs(), loadDashboard()])
}
function faqMenu(f: FaqRow): ContextMenuItem[][] {
  const themes: ContextMenuItem[] = [
    { label: t('knowledge.root'), onSelect: () => moveFaq(f.id, '') },
    ...nodes.value.map(n => ({ label: n.pathCache, onSelect: () => moveFaq(f.id, n.id) }))
  ]
  return [[
    { label: t('knowledge.model.edit'), icon: 'i-lucide-square-pen', onSelect: () => openFaq(f.id) },
    { label: t('knowledge.model.moveToTheme'), icon: 'i-lucide-circle-arrow-right', children: themes },
    { label: t('knowledge.model.setStatus'), icon: 'i-lucide-flag', children: FAQ_STATUSES.map(s => ({ label: t(`knowledge.status.${s}`), onSelect: () => setFaqStatus(f.id, s) })) }
  ], [
    { label: t('knowledge.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => deleteFaq(f) }
  ]]
}

// --- faq editor ---
const showFaq = ref(false)
const editFaqId = ref('')
function openFaq(faqId: string) { editFaqId.value = faqId; showFaq.value = true }
async function afterFaqSaved() { await Promise.all([loadFaqs(), loadDashboard(), loadNodes()]) }

// --- themes modal ---
const showThemes = ref(false)
const themeSelected = ref('')
const themeFaqs = ref<{ id: string, question: string }[]>([])
const themeSelectedLabel = computed(() => nodes.value.find(n => n.id === themeSelected.value)?.pathCache || t('knowledge.root'))
async function onThemeSelect(nodeId: string) {
  themeSelected.value = nodeId
  themeFaqs.value = []
  if (!nodeId) return
  try { themeFaqs.value = (await api<{ faqs: { id: string, question: string }[] }>(`/admin/knowledge/faqs?modelId=${id}&nodeId=${nodeId}&limit=100`)).faqs } catch { /* empty */ }
}
function filterByTheme() { faqNode.value = themeSelected.value; showThemes.value = false; reloadFaqs() }
async function onStructureChanged() { await Promise.all([loadNodes(), loadDashboard()]); if (themeSelected.value) await onThemeSelect(themeSelected.value) }

// --- documents modal ---
const showDocs = ref(false)
const documents = ref<(KnowledgeDocument & { faqCount: number })[]>([])
const docsLoading = ref(false)
const busyDoc = ref('')
const replaceInput = ref<HTMLInputElement | null>(null)
const replaceTarget = ref<KnowledgeDocument | null>(null)
const replacePreview = ref<ImportPreview | null>(null)

async function openDocs() { showDocs.value = true; if (!documents.value.length) await loadDocs() }
async function loadDocs() {
  docsLoading.value = true
  try { documents.value = (await api<{ documents: (KnowledgeDocument & { faqCount: number })[] }>(`/admin/knowledge/documents?modelId=${id}`)).documents } finally { docsLoading.value = false }
}
async function download(d: KnowledgeDocument) {
  const blob = await $fetch<Blob>(`/v1/admin/knowledge/documents/${d.id}/download`, { headers: agentHeaders(), responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = d.originalFilename; a.click(); URL.revokeObjectURL(url)
}
async function reprocess(d: KnowledgeDocument) {
  busyDoc.value = d.id
  try { await api(`/admin/knowledge/documents/${d.id}/reprocess`, { method: 'POST' }); await Promise.all([loadDocs(), loadFaqs(), loadDashboard()]) }
  catch (e: any) { alert(e?.message || t('knowledge.model.couldNotReprocess')) } finally { busyDoc.value = '' }
}
function pickReplace(d: KnowledgeDocument) { replaceTarget.value = d; replaceInput.value?.click() }
async function doReplace(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file || !replaceTarget.value) return
  const fd = new FormData(); fd.append('file', file)
  const res = await $fetch<{ preview: ImportPreview }>(`/v1/admin/knowledge/documents/${replaceTarget.value.id}/replace`, { method: 'POST', body: fd, headers: agentHeaders() })
  ;(e.target as HTMLInputElement).value = ''
  replacePreview.value = res.preview
  showImport.value = true
}
async function removeDoc(d: KnowledgeDocument) {
  const impact = await api<{ deleted: boolean, impact?: { faqs: number, note: string } }>(`/admin/knowledge/documents/${d.id}`, { method: 'DELETE' })
  if (!impact.deleted) {
    if (!confirm(t('knowledge.model.deleteDocConfirm', { name: d.originalFilename, note: impact.impact?.note || '', faqs: t('knowledge.units.faq', impact.impact?.faqs || 0) }))) return
    await api(`/admin/knowledge/documents/${d.id}?confirm=true`, { method: 'DELETE' })
  }
  await Promise.all([loadDocs(), loadFaqs(), loadDashboard()])
}

// --- import ---
const showImport = ref(false)
async function afterImport() { replacePreview.value = null; await Promise.all([loadDocs(), loadFaqs(), loadDashboard(), loadNodes()]) }
watch(showImport, (o) => { if (!o) replacePreview.value = null })

// --- test with assistant (floating) ---
const showTester = ref(false)
const testerAssistants = ref<{ id: string, name: string }[]>([])
const testerAssistantId = ref('')
const testerQuery = ref('')
const testerAnswer = ref('')
const testerKnowledge = ref<{ faqId: string, question: string, score: number }[]>([])
const testerLoading = ref(false)
const testerError = ref('')
const testerAssistantItems = computed(() => testerAssistants.value.map(a => ({ label: a.name, value: a.id })))
async function openTester() {
  showTester.value = true
  if (testerAssistants.value.length || !model.value?.projectId) return
  try {
    const { agents } = await api<{ agents: { id: string, name: string }[] }>(`/admin/support-agents?projectId=${model.value.projectId}`)
    testerAssistants.value = agents
    if (agents.length && !testerAssistantId.value) testerAssistantId.value = agents[0]!.id
  } catch { /* leave empty; the panel explains */ }
}
async function runTester() {
  if (!testerAssistantId.value || !testerQuery.value.trim()) return
  testerLoading.value = true; testerError.value = ''; testerAnswer.value = ''; testerKnowledge.value = []
  try {
    const res = await api<{ answer: string, knowledge: { faqId: string, question: string, score: number }[] }>(`/admin/support-agents/${testerAssistantId.value}/generate`, { method: 'POST', body: { query: testerQuery.value.trim() } })
    testerAnswer.value = res.answer
    testerKnowledge.value = res.knowledge
  } catch (e: any) {
    testerError.value = e?.message || t('knowledge.model.couldNotGenerate')
  } finally {
    testerLoading.value = false
  }
}

// --- model settings ---
const showEdit = ref(false)
const savingEdit = ref(false)
const editForm = reactive({ name: '', description: '', status: 'active', defaultLanguage: 'en' })
// Less-used model actions live behind the header's ⋯, as in Linear.
const modelMenu = computed(() => [[
  { label: t('knowledge.model.themes'), icon: 'i-lucide-folder-tree', onSelect: () => { showThemes.value = true } },
  { label: t('knowledge.model.sourceDocuments'), icon: 'i-lucide-file-text', onSelect: () => { void openDocs() } },
  { label: t('knowledge.model.reindex'), icon: 'i-lucide-refresh-cw', onSelect: () => { void reindex() } }
], [
  { label: t('knowledge.model.settings'), icon: 'i-lucide-settings-2', onSelect: openEdit }
]])

function openEdit() {
  if (!model.value) return
  Object.assign(editForm, { name: model.value.name, description: model.value.description, status: model.value.status, defaultLanguage: model.value.defaultLanguage })
  showEdit.value = true
}
async function saveEdit() {
  savingEdit.value = true
  try { await api(`/admin/knowledge/models/${id}`, { method: 'PATCH', body: { ...editForm } }); showEdit.value = false; await loadModel() } finally { savingEdit.value = false }
}
async function archive() { await api(`/admin/knowledge/models/${id}`, { method: 'PATCH', body: { status: 'archived' } }); await loadModel() }
async function removeModel() {
  const impact = await api<{ deleted: boolean, impact?: { faqs: number, nodes: number, documents: number, agents: number } }>(`/admin/knowledge/models/${id}`, { method: 'DELETE' })
  if (!impact.deleted) {
    const im = impact.impact!
    if (!confirm(t('knowledge.model.deleteModelConfirm', { faqs: t('knowledge.units.faq', im.faqs), nodes: t('knowledge.units.theme', im.nodes), documents: t('knowledge.units.document', im.documents), agents: t('knowledge.units.assistant', im.agents) }))) return
    const projectId = model.value?.projectId
    await api(`/admin/knowledge/models/${id}?confirm=true`, { method: 'DELETE' })
    await navigateTo(projectId ? `/projects/${projectId}/knowledge` : '/projects')
  }
}

const reindexing = ref(false)
async function reindex() {
  reindexing.value = true
  try { await api(`/admin/knowledge/models/${id}/reindex`, { method: 'POST' }); setTimeout(loadDashboard, 1500) } finally { reindexing.value = false }
}

onMounted(async () => { await Promise.all([loadModel(), loadDashboard(), loadNodes(), loadFaqs()]) })
</script>
