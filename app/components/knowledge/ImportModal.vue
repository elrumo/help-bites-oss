<template>
  <UModal v-model:open="open" :title="$t('knowledge.import.title')" :description="step === 'upload' ? $t('knowledge.import.uploadDescription') : ''" :ui="{ content: 'max-w-3xl' }">
    <template #body>
      <!-- Step 1: upload -->
      <div v-if="step === 'upload'" class="space-y-4">
        <UFormField v-if="nodes.length" :label="$t('knowledge.import.destination')" :hint="$t('knowledge.import.destinationHint')">
          <OptionalSelect v-model="nodeId" :items="nodeItems" :none-label="$t('knowledge.modelRoot')" class="w-full" />
        </UFormField>
        <div
          class="rounded-xl border-2 border-dashed p-8 text-center transition-colors"
          :class="dragging ? 'border-primary-500 bg-primary-500/5' : 'border-accented'"
          @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop"
        >
          <UIcon name="i-lucide-file-up" class="size-8 text-dimmed mx-auto" />
          <p class="mt-2 text-sm text-muted">{{ $t('knowledge.import.dropStart') }} <code>.md</code> {{ $t('knowledge.import.dropOr') }} <code>.txt</code> {{ $t('knowledge.import.dropEnd') }}</p>
          <UButton class="mt-2" size="sm" color="neutral" variant="soft" @click="fileInput?.click()">{{ $t('knowledge.import.chooseFile') }}</UButton>
          <input ref="fileInput" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" class="hidden" @change="onPick">
          <p v-if="file" class="mt-3 text-sm">{{ file.name }} <span class="text-dimmed">({{ Math.ceil(file.size / 1024) }} KB)</span></p>
        </div>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">{{ $t('common.cancel') }}</UButton>
          <UButton color="primary" :disabled="!file" :loading="uploading" @click="upload">{{ $t('knowledge.import.parse') }}</UButton>
        </div>
      </div>

      <!-- Step 2: review -->
      <div v-else-if="step === 'review' && preview" class="space-y-4">
        <div class="flex flex-wrap gap-3 text-sm">
          <KnowledgeStat :n="preview.counts.faqs" :label="$t('knowledge.stats.faqs')" />
          <KnowledgeStat :n="preview.counts.nodes" :label="$t('knowledge.stats.paths')" />
          <KnowledgeStat :n="preview.counts.duplicates" :label="$t('knowledge.stats.duplicates')" :warn="preview.counts.duplicates > 0" />
          <KnowledgeStat :n="preview.counts.existing" :label="$t('knowledge.stats.alreadyImported')" :warn="preview.counts.existing > 0" />
          <KnowledgeStat :n="selectedCount" :label="$t('knowledge.stats.selected')" />
        </div>

        <details v-if="preview.warnings.length || preview.invalid.length" class="text-xs text-muted">
          <summary class="cursor-pointer">{{ $t('knowledge.import.warnings', preview.warnings.length + preview.invalid.length) }}</summary>
          <ul class="mt-1 space-y-0.5">
            <li v-for="(w, i) in preview.warnings" :key="`w${i}`">⚠︎ {{ w }}</li>
            <li v-for="(iv, i) in preview.invalid" :key="`i${i}`">⚠︎ {{ iv.section }} — {{ iv.reason }}</li>
          </ul>
        </details>

        <div class="flex items-center gap-2 text-xs">
          <UButton size="xs" variant="ghost" color="neutral" @click="setAll(true)">{{ $t('knowledge.import.selectAll') }}</UButton>
          <UButton size="xs" variant="ghost" color="neutral" @click="setAll(false)">{{ $t('knowledge.import.none') }}</UButton>
          <span class="text-dimmed">{{ $t('knowledge.import.editHint') }}</span>
        </div>

        <ul class="divide-y divide-default border-y border-default max-h-[45vh] overflow-y-auto">
          <li v-for="e in entries" :key="e.key" class="py-2 flex items-start gap-3">
            <UCheckbox v-model="e.include" class="mt-1" />
            <div class="min-w-0 flex-1">
              <UInput v-model="e.question" size="xs" class="w-full" :ui="{ base: 'font-medium' }" />
              <div class="mt-1 flex items-center gap-2 text-xs text-dimmed">
                <span class="truncate">{{ e.pathCache || $t('knowledge.root') }}</span>
                <UBadge v-if="e.duplicate" size="xs" variant="subtle" :color="dupColor(e.duplicate)">{{ dupLabel(e.duplicate) }}</UBadge>
              </div>
            </div>
          </li>
        </ul>

        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-between gap-2">
          <UButton color="neutral" variant="ghost" @click="reset">{{ $t('knowledge.back') }}</UButton>
          <UButton color="primary" :disabled="!selectedCount" :loading="committing" @click="commit">{{ $t('knowledge.import.importCount', selectedCount) }}</UButton>
        </div>
      </div>

      <!-- Step 3: processing / done -->
      <div v-else class="py-6 text-center space-y-3">
        <UIcon :name="doneOk ? 'i-lucide-circle-check' : failed ? 'i-lucide-triangle-alert' : 'i-lucide-refresh-cw'" class="size-8 mx-auto" :class="doneOk ? 'text-primary-500' : failed ? 'text-error' : 'text-dimmed animate-spin'" />
        <p class="text-sm">{{ statusText }}</p>
        <p v-if="stats" class="text-xs text-muted">{{ $t('knowledge.import.statsLine', { created: stats.created, updated: stats.updated, kept: stats.skippedDetached, outdated: stats.outdated }) }}</p>
        <div v-if="doneOk || failed" class="flex justify-center">
          <UButton color="primary" @click="finish">{{ $t('knowledge.done') }}</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { ImportPreview, ImportPreviewEntry } from '#shared/knowledge'
import type { KnowledgeNode } from '~~/server/utils/knowledgeNodes'

const props = defineProps<{ modelId: string, nodes: KnowledgeNode[], initialPreview?: ImportPreview | null }>()
const emit = defineEmits<{ imported: [] }>()
const open = defineModel<boolean>('open', { required: true })

const { api, agentHeaders } = useAgent()
const { t } = useI18n()
type ReviewEntry = ImportPreviewEntry & { include: boolean }

const step = ref<'upload' | 'review' | 'processing'>('upload')
const dragging = ref(false)
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const nodeId = ref('')
const uploading = ref(false)
const committing = ref(false)
const error = ref('')
const preview = ref<ImportPreview | null>(null)
const entries = ref<ReviewEntry[]>([])
const stats = ref<{ created: number, updated: number, skippedDetached: number, outdated: number } | null>(null)
const docStatus = ref('')

const nodeItems = computed(() => props.nodes.map(n => ({ label: n.pathCache, value: n.id })))
const selectedCount = computed(() => entries.value.filter(e => e.include).length)
const failed = computed(() => docStatus.value === 'failed')
const doneOk = computed(() => docStatus.value === 'processed')
const statusText = computed(() => failed.value ? t('knowledge.import.failed') : doneOk.value ? t('knowledge.import.indexed') : t('knowledge.import.indexing'))

watch(open, (isOpen) => {
  if (!isOpen) return
  reset()
  if (props.initialPreview) {
    preview.value = props.initialPreview
    entries.value = props.initialPreview.entries.map(e => ({ ...e, include: e.duplicate !== 'existing-detached' }))
    step.value = 'review'
  }
})

function reset() {
  step.value = 'upload'; file.value = null; nodeId.value = ''; error.value = ''; preview.value = null; entries.value = []; stats.value = null; docStatus.value = ''
}
function onPick(e: Event) { file.value = (e.target as HTMLInputElement).files?.[0] || null }
function onDrop(e: DragEvent) { dragging.value = false; file.value = e.dataTransfer?.files?.[0] || null }
function setAll(v: boolean) { entries.value.forEach(e => { e.include = v }) }
function dupColor(d: string) { return d === 'existing-detached' ? 'warning' : d === 'in-document' ? 'neutral' : 'info' }
function dupLabel(d: string) { return d === 'in-document' ? t('knowledge.import.dupInFile') : d === 'existing-detached' ? t('knowledge.import.dupEdited') : t('knowledge.import.dupUpdates') }

async function upload() {
  if (!file.value) return
  uploading.value = true
  error.value = ''
  try {
    const fd = new FormData()
    fd.append('file', file.value)
    const query = new URLSearchParams({ modelId: props.modelId, ...(nodeId.value ? { nodeId: nodeId.value } : {}) })
    const res = await $fetch<{ preview: ImportPreview }>(`/v1/admin/knowledge/imports/upload?${query}`, {
      method: 'POST', body: fd, headers: agentHeaders()
    })
    preview.value = res.preview
    entries.value = res.preview.entries.map(e => ({ ...e, include: e.duplicate !== 'existing-detached' }))
    step.value = 'review'
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || t('knowledge.import.couldNotParse')
  } finally {
    uploading.value = false
  }
}

async function commit() {
  if (!preview.value) return
  committing.value = true
  error.value = ''
  try {
    const included = entries.value.filter(e => e.include).map(e => ({ path: e.path, question: e.question, answer: e.answer }))
    const res = await api<{ stats: typeof stats.value }>(`/admin/knowledge/imports/${preview.value.documentId}/commit`, { method: 'POST', body: { entries: included } })
    stats.value = res.stats
    step.value = 'processing'
    poll(preview.value.documentId)
  } catch (e: any) {
    error.value = e?.message || t('knowledge.import.couldNotImport')
  } finally {
    committing.value = false
  }
}

async function poll(documentId: string) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1200))
    try {
      const { document } = await api<{ document: { status: string } }>(`/admin/knowledge/imports/${documentId}`)
      docStatus.value = document.status
      if (document.status === 'processed' || document.status === 'failed') return
    } catch { /* keep polling */ }
  }
}

function finish() { open.value = false; emit('imported') }
</script>
