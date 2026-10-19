<template>
  <UModal v-model:open="open" :title="document ? 'Answers and recompose' : 'New legal document'" :ui="{ content: 'sm:max-w-2xl', header: 'relative z-10 bg-default' }">
    <template #body>
      <div v-if="step === 0" class="space-y-5">
        <div>
          <p class="mb-2 text-[13px] font-medium text-highlighted">Which document?</p>
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
          <p class="mb-2 text-[13px] font-medium text-highlighted">How should it be written?</p>
          <div class="space-y-2">
            <button type="button" class="w-full rounded-lg border px-3 py-2.5 text-left transition-colors" :class="mode === 'template' ? 'border-primary bg-primary/5' : 'border-default'" @click="mode = 'template'">
              <span class="block text-[13px] font-medium text-highlighted">From reviewed clauses</span>
              <span class="block text-[13px] text-muted">Assembled from a library of clauses for the regions you pick. No AI, instant, and you can ask AI for help afterwards.</span>
            </button>
            <button type="button" class="w-full rounded-lg border px-3 py-2.5 text-left transition-colors" :class="mode === 'ai' ? 'border-primary bg-primary/5' : 'border-default'" @click="mode = 'ai'">
              <span class="block text-[13px] font-medium text-highlighted">Written by AI</span>
              <span class="block text-[13px] text-muted">The model drafts the whole document from your answers, starting from the clauses and the rules that apply. Needs an AI provider and can take a minute or two.</span>
            </button>
          </div>
        </div>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton label="Next" trailing-icon="i-lucide-arrow-right" :loading="loading" @click="start" />
        </div>
      </div>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <p class="text-[13px] text-muted">Answer what applies. Your saved company details are filled in already. This is a drafting tool, not legal advice.</p>
        <UFormField v-for="q in visible" :key="q.id" :label="q.label" :hint="q.required ? 'Required' : undefined" :help="q.help">
          <UInput v-if="q.kind === 'text'" :model-value="str(q.id)" :placeholder="q.placeholder" class="w-full" @update:model-value="answers[q.id] = $event" />
          <UTextarea v-else-if="q.kind === 'longtext'" :model-value="str(q.id)" :placeholder="q.placeholder" :rows="3" class="w-full" @update:model-value="answers[q.id] = $event" />
          <USwitch v-else-if="q.kind === 'boolean'" :model-value="answers[q.id] === true" @update:model-value="answers[q.id] = $event" />
          <USelect v-else-if="q.kind === 'select'" :model-value="str(q.id)" :items="q.options" placeholder="Choose…" class="w-full" @update:model-value="answers[q.id] = $event" />
          <USelectMenu v-else-if="q.id === 'regions'" :model-value="listOf(q.id)" multiple :items="q.options" value-key="value" placeholder="Select regions" class="w-full" @update:model-value="answers[q.id] = $event" />
          <UCheckboxGroup v-else :model-value="listOf(q.id)" :items="q.options" @update:model-value="answers[q.id] = $event" />
        </UFormField>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex items-center gap-2 pt-2">
          <UButton v-if="!document" color="neutral" variant="ghost" icon="i-lucide-arrow-left" label="Back" @click="step = 0" />
          <UButton class="ml-auto" color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton type="submit" :label="document ? 'Recompose' : mode === 'ai' ? 'Write it' : 'Create'" :loading="loading" />
        </div>
      </form>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { LEGAL_DOC_LABELS, LEGAL_DOC_TYPES, type LegalAnswers, type LegalDocType, type LegalQuestion } from '#shared/legal/types'
import { matches } from '#shared/legal/when'

// Renders the question schema from GET /v1/admin/legal/wizard/:type, the same
// one any API client gets. With `document` it re-asks and recomposes instead.
const props = defineProps<{ projectId: string, document?: { id: string, type: LegalDocType, answers: LegalAnswers } }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ done: [document: any] }>()

const { api } = useAgent()
const typeItems = LEGAL_DOC_TYPES.map(value => ({ value, label: LEGAL_DOC_LABELS[value] }))
const step = ref(0)
const type = ref<LegalDocType>('privacy')
const mode = ref<'template' | 'ai'>('template')
const questions = ref<LegalQuestion[]>([])
const answers = reactive<LegalAnswers>({})
const loading = ref(false)
const error = ref('')

const visible = computed(() => questions.value.filter(q => matches(q.showIf, answers)))
const str = (id: string) => (typeof answers[id] === 'string' ? answers[id] as string : '')
const listOf = (id: string) => (Array.isArray(answers[id]) ? answers[id] as string[] : [])

async function start() {
  loading.value = true
  error.value = ''
  try {
    const spec = await api<{ questions: LegalQuestion[], defaults: LegalAnswers }>(`/admin/legal/wizard/${type.value}`, { query: { project: props.projectId } })
    questions.value = spec.questions
    for (const key of Object.keys(answers)) delete answers[key]
    Object.assign(answers, spec.defaults, props.document?.answers || {})
    step.value = 1
  } catch (e: any) {
    error.value = e?.message || 'Could not load the questions'
  } finally {
    loading.value = false
  }
}

async function submit() {
  loading.value = true
  error.value = ''
  try {
    const result = props.document
      ? await api<{ document: any }>(`/admin/legal/documents/${props.document.id}/recompose`, { method: 'POST', body: { answers } })
      : await api<{ document: any }>('/admin/legal/documents', { method: 'POST', body: { project: props.projectId, type: type.value, mode: mode.value, answers } })
    open.value = false
    emit('done', result.document)
  } catch (e: any) {
    error.value = e?.message || 'Could not save'
  } finally {
    loading.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  step.value = 0
  if (props.document) {
    type.value = props.document.type
    void start()
  }
})
</script>
