<template>
  <UModal v-model:open="open" :title="document ? $t('legal.wizard.titleRecompose') : $t('legal.wizard.titleNew')" :ui="{ content: 'sm:max-w-2xl', header: 'relative z-10 bg-default' }">
    <template #body>
      <div v-if="step === 0" class="space-y-5">
        <div>
          <p class="mb-2 text-[13px] font-medium text-highlighted">{{ $t('legal.wizard.whichDocument') }}</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <button
              v-for="t in typeItems"
              :key="t.value"
              type="button"
              class="rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors"
              :class="type === t.value ? 'border-primary bg-primary/5 text-highlighted' : 'border-default text-muted hover:text-default'"
              @click="type = t.value"
            >{{ t.label }}</button>
          </div>
        </div>
        <div>
          <p class="mb-2 text-[13px] font-medium text-highlighted">{{ $t('legal.wizard.howWritten') }}</p>
          <div class="space-y-2">
            <button type="button" class="w-full rounded-lg border px-3 py-2.5 text-left transition-colors" :class="mode === 'template' ? 'border-primary bg-primary/5' : 'border-default'" @click="mode = 'template'">
              <span class="block text-[13px] font-medium text-highlighted">{{ $t('legal.wizard.modeTemplate') }}</span>
              <span class="block text-[13px] text-muted">{{ $t('legal.wizard.modeTemplateHint') }}</span>
            </button>
            <button type="button" class="w-full rounded-lg border px-3 py-2.5 text-left transition-colors" :class="mode === 'ai' ? 'border-primary bg-primary/5' : 'border-default'" @click="mode = 'ai'">
              <span class="block text-[13px] font-medium text-highlighted">{{ $t('legal.wizard.modeAi') }}</span>
              <span class="block text-[13px] text-muted">{{ $t('legal.wizard.modeAiHint') }}</span>
            </button>
          </div>
        </div>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="open = false" />
          <UButton :label="$t('legal.wizard.next')" trailing-icon="i-lucide-arrow-right" :loading="loading" @click="start" />
        </div>
      </div>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <p class="text-[13px] text-muted">{{ $t('legal.wizard.intro') }}</p>
        <div v-if="hasRepos" class="space-y-2 rounded-lg border border-default p-3">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <UButton size="sm" color="neutral" variant="subtle" icon="i-lucide-git-branch" :label="$t('legal.wizard.suggestFromRepos')" :loading="scanning" @click="suggest" />
            <USwitch v-if="type === 'privacy'" v-model="useAi" size="sm" :label="$t('legal.wizard.alsoAi')" />
          </div>
          <p v-if="suggestError" class="text-sm text-error">{{ suggestError }}</p>
          <template v-if="suggestion">
            <p v-if="!suggested.length" class="text-[13px] text-muted">{{ $t('legal.wizard.noServices', suggestion.repos.filter(r => r.read).length) }}</p>
            <template v-else>
              <p class="text-[13px] text-muted">{{ $t('legal.wizard.foundInCode') }}</p>
              <ul class="space-y-1.5">
                <li v-for="item in suggested" :key="item.id" class="text-[13px]">
                  <span class="font-medium text-highlighted">{{ item.label }}:</span> {{ item.shown }}
                  <span class="block text-xs text-muted">{{ item.evidence.join(' · ') }}</span>
                </li>
              </ul>
              <UButton size="sm" :label="$t('legal.wizard.useAnswers')" @click="apply" />
            </template>
            <p v-if="suggestion.repos.some(r => !r.read)" class="text-xs text-muted">{{ $t('legal.wizard.couldNotRead', { repos: suggestion.repos.filter(r => !r.read).map(r => r.repo).join(', ') }) }}</p>
          </template>
          <p v-else-if="filled" class="text-[13px] text-muted">{{ $t('legal.wizard.filled') }}</p>
        </div>
        <UFormField v-for="q in visible" :key="q.id" :label="q.label" :hint="q.required ? $t('legal.wizard.required') : undefined" :help="q.help">
          <UInput v-if="q.kind === 'text'" :model-value="str(q.id)" :placeholder="q.placeholder" class="w-full" @update:model-value="answers[q.id] = $event" />
          <UTextarea v-else-if="q.kind === 'longtext'" :model-value="str(q.id)" :placeholder="q.placeholder" :rows="3" class="w-full" @update:model-value="answers[q.id] = $event" />
          <USwitch v-else-if="q.kind === 'boolean'" :model-value="answers[q.id] === true" @update:model-value="answers[q.id] = $event" />
          <USelect v-else-if="q.kind === 'select'" :model-value="str(q.id)" :items="q.options" :placeholder="$t('legal.wizard.choose')" class="w-full" @update:model-value="answers[q.id] = $event" />
          <USelectMenu v-else-if="q.id === 'regions'" :model-value="listOf(q.id)" multiple :items="q.options" value-key="value" :placeholder="$t('legal.selectRegions')" class="w-full" @update:model-value="answers[q.id] = $event" />
          <UCheckboxGroup v-else :model-value="listOf(q.id)" :items="q.options" @update:model-value="answers[q.id] = $event" />
        </UFormField>
        <UFormField help="Off keeps them with this document only. Questions only this kind of document asks, like the refund window, are asked per document either way.">
          <USwitch v-model="saveAnswers" label="Reuse these answers for my other documents" />
        </UFormField>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex items-center gap-2 pt-2">
          <UButton v-if="!document" color="neutral" variant="ghost" icon="i-lucide-arrow-left" :label="$t('legal.wizard.back')" @click="step = 0" />
          <UButton class="ml-auto" color="neutral" variant="ghost" :label="$t('common.cancel')" @click="open = false" />
          <UButton type="submit" :label="document ? $t('legal.wizard.recompose') : mode === 'ai' ? $t('legal.wizard.writeIt') : $t('legal.wizard.create')" :loading="loading" />
        </div>
      </form>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { LEGAL_DOC_LABELS, LEGAL_DOC_TYPES, LEGAL_REGIONS, LEGAL_REGION_LABELS, type LegalAnswers, type LegalDocType, type LegalQuestion } from '#shared/legal/types'
import { matches } from '#shared/legal/when'

// Renders the question schema from GET /v1/admin/legal/wizard/:type, the same
// one any API client gets. With `document` it re-asks and recomposes instead.
const props = defineProps<{ projectId: string, document?: { id: string, type: LegalDocType, answers: LegalAnswers } }>()
const open = defineModel<boolean>('open', { default: false })
// `done` also says whether to analyse the document, which the document page then does.
const emit = defineEmits<{ done: [document: any, analyse?: boolean] }>()

const { api } = useAgent()
const { t } = useI18n()
const typeItems = LEGAL_DOC_TYPES.map(value => ({ value, label: LEGAL_DOC_LABELS[value] }))
const step = ref(0)
const type = ref<LegalDocType>('privacy')
const mode = ref<'template' | 'ai' | 'import'>('template')
const questions = ref<LegalQuestion[]>([])
const answers = reactive<LegalAnswers>({})
const loading = ref(false)
const error = ref('')
const hasRepos = ref(false)
const scanning = ref(false)
const useAi = ref(false)
const hasShared = ref(false)
const saveAnswers = ref(true)
const analyse = ref(false)
const importText = ref('')
const importTitle = ref('')
const importFormat = ref<'markdown' | 'html' | 'text' | undefined>()
const regionOptions = LEGAL_REGIONS.map(value => ({ value, label: LEGAL_REGION_LABELS[value] }))
const filled = ref(false)
const suggestError = ref('')
const suggestion = ref<{ answers: LegalAnswers, evidence: Record<string, string[]>, repos: Array<{ repo: string, read: boolean }> } | null>(null)

const visible = computed(() => questions.value.filter(q => matches(q.showIf, answers)))
const str = (id: string) => (typeof answers[id] === 'string' ? answers[id] as string : '')
const listOf = (id: string) => (Array.isArray(answers[id]) ? answers[id] as string[] : [])

const optionLabel = (q: LegalQuestion, value: string) => q.options?.find(o => o.value === value)?.label || value
const suggested = computed(() => questions.value.flatMap((q) => {
  const value = suggestion.value?.answers[q.id]
  if (value === undefined) return []
  const shown = Array.isArray(value) ? value.map(v => optionLabel(q, v)).join(', ') : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : q.kind === 'select' ? optionLabel(q, value) : value.replace(/\n/g, '; ')
  return [{ id: q.id, label: q.label, shown, evidence: suggestion.value?.evidence[q.id] || [] }]
}))

async function suggest() {
  scanning.value = true
  suggestError.value = ''
  suggestion.value = null
  filled.value = false
  try {
    suggestion.value = await api(`/admin/legal/wizard/${type.value}/suggest`, { method: 'POST', body: { project: props.projectId, ai: useAi.value && type.value === 'privacy' } })
  } catch (e: any) {
    suggestError.value = e?.message || t('legal.wizard.couldNotReadRepos')
  } finally {
    scanning.value = false
  }
}

/** Merges the suggestions into the form: lists are added to, text is appended, the rest is set. Still the person's to edit. */
function apply() {
  for (const [id, value] of Object.entries(suggestion.value?.answers || {})) {
    if (Array.isArray(value)) answers[id] = [...new Set([...listOf(id), ...value])]
    else if (id === 'processors_other') answers[id] = [...new Set([...str(id).split('\n').filter(Boolean), ...String(value).split('\n')])].join('\n')
    else answers[id] = value
  }
  suggestion.value = null
  filled.value = true
}

async function start() {
  loading.value = true
  error.value = ''
  try {
    const spec = await api<{ questions: LegalQuestion[], defaults: LegalAnswers, shared: boolean }>(`/admin/legal/wizard/${type.value}`, { query: { project: props.projectId } })
    questions.value = spec.questions
    for (const key of Object.keys(answers)) delete answers[key]
    Object.assign(answers, spec.defaults, props.document?.answers || {})
    suggestion.value = null
    suggestError.value = ''
    filled.value = false
    hasRepos.value = await api<{ repos: unknown[] }>(`/admin/projects/${props.projectId}/repos`).then(r => r.repos.length > 0, () => false)
    step.value = 1
  } catch (e: any) {
    error.value = e?.message || t('legal.wizard.couldNotLoadQuestions')
  } finally {
    loading.value = false
  }
}

async function submit() {
  loading.value = true
  error.value = ''
  try {
    const result = props.document
      ? await api<{ document: any }>(`/admin/legal/documents/${props.document.id}/recompose`, { method: 'POST', body: { answers, saveAnswers: saveAnswers.value } })
      : await api<{ document: any }>('/admin/legal/documents', { method: 'POST', body: { project: props.projectId, type: type.value, mode: mode.value, answers, saveAnswers: saveAnswers.value } })
    open.value = false
    emit('done', result.document)
  } catch (e: any) {
    error.value = e?.message || t('legal.couldNotSave')
  } finally {
    loading.value = false
  }
}

const FORMATS: Record<string, 'markdown' | 'html' | 'text'> = { md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', txt: 'text' }

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 500_000) { error.value = 'That file is too large. Policies are text; the limit is 500 KB.'; return }
  error.value = ''
  importText.value = await file.text()
  importFormat.value = FORMATS[file.name.split('.').pop()?.toLowerCase() || '']
  if (!importTitle.value) importTitle.value = file.name.replace(/\.[^.]+$/, '')
}

async function submitImport() {
  loading.value = true
  error.value = ''
  try {
    const result = await api<{ document: any }>('/admin/legal/documents', { method: 'POST', body: {
      project: props.projectId, type: type.value, mode: 'import', text: importText.value, format: importFormat.value, title: importTitle.value.trim() || undefined,
      answers: { regions: listOf('regions') }, saveAnswers: saveAnswers.value
    } })
    open.value = false
    emit('done', result.document, analyse.value)
  } catch (e: any) {
    error.value = e?.message || 'Could not import'
  } finally {
    loading.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  step.value = 0
  importText.value = ''
  importTitle.value = ''
  importFormat.value = undefined
  analyse.value = false
  if (props.document) {
    type.value = props.document.type
    void start()
  }
})
</script>
