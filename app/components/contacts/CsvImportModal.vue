<script setup lang="ts">
/**
 * Import people from a CSV file. The file is read and mapped here in the
 * browser, then sent a thousand rows at a time to POST /v1/contacts — the
 * same call the API offers, so an import behaves exactly like one.
 */
import { csvRecords, guessMapping, mapSourceRow, type ContactFieldMapping, type ContactInput } from '#shared/contacts'
import type { AdminProject } from '~~/server/utils/projects'
import { attributeKeyFor } from '~/utils/contactStatus'

const props = defineProps<{ project: AdminProject }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ imported: [] }>()

const { api } = useAgent()
const toast = useToast()
const { t } = useI18n()

const MAX_BYTES = 20 * 1024 * 1024
const BATCH = 1000

const fileName = ref('')
const columns = ref<string[]>([])
const records = ref<Record<string, string>[]>([])
const mapping = reactive<Required<Pick<ContactFieldMapping, 'email' | 'externalId' | 'name' | 'tags' | 'subscribed'>>>({ email: '', externalId: '', name: '', tags: '', subscribed: '' })
const asAttributes = ref<string[]>([])
const optedIn = ref(false)
const fillOnly = ref(true)

const importing = ref(false)
const done = ref(0)
const summary = ref<{ created: number, updated: number, unchanged: number, failed: number, errors: string[] } | null>(null)

watch(open, (value) => { if (!value && !importing.value) reset() })

function reset() {
  fileName.value = ''
  columns.value = []
  records.value = []
  Object.assign(mapping, { email: '', externalId: '', name: '', tags: '', subscribed: '' })
  asAttributes.value = []
  optedIn.value = false
  fillOnly.value = true
  done.value = 0
  summary.value = null
}

async function pick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > MAX_BYTES) { toast.add({ title: t('contacts.csv.tooBig'), color: 'error' }); return }
  const parsed = csvRecords(await file.text())
  if (!parsed.columns.length || !parsed.records.length) { toast.add({ title: t('contacts.csv.noRows'), color: 'error' }); return }
  fileName.value = file.name
  columns.value = parsed.columns
  records.value = parsed.records
  const guess = guessMapping(parsed.columns)
  Object.assign(mapping, { email: guess.email || '', externalId: guess.externalId || '', name: guess.name || '', tags: guess.tags || '', subscribed: guess.subscribed || '' })
  const used = new Set(Object.values(guess).filter(Boolean))
  asAttributes.value = parsed.columns.filter(c => !used.has(c))
}

const columnItems = computed(() => columns.value.map(c => ({ label: c, value: c })))
const fieldMapping = computed<ContactFieldMapping>(() => ({
  email: mapping.email || undefined,
  externalId: mapping.externalId || undefined,
  name: mapping.name || undefined,
  tags: mapping.tags || undefined,
  subscribed: mapping.subscribed || undefined,
  attributes: Object.fromEntries(asAttributes.value.filter(c => !Object.values(mapping).includes(c)).map(c => [attributeKeyFor(c), c]))
}))

const mapped = computed(() => {
  const out: ContactInput[] = []
  let skipped = 0
  for (const row of records.value) {
    const input = mapSourceRow(row, fieldMapping.value)
    if (!input) { skipped++; continue }
    // The whole file asserted as opted in, unless a column says it per row.
    if (optedIn.value && !mapping.subscribed) input.subscription = 'subscribed'
    out.push(input)
  }
  return { inputs: out, skipped }
})

async function run() {
  const inputs = mapped.value.inputs
  importing.value = true
  done.value = 0
  const total = { created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] as string[] }
  try {
    for (let i = 0; i < inputs.length; i += BATCH) {
      const res = await api<{ results: { index: number, status: string, error?: string }[], created: number, updated: number, unchanged: number, failed: number }>('/contacts', { method: 'POST', body: { project: props.project.id, contacts: inputs.slice(i, i + BATCH), fillOnly: fillOnly.value } })
      total.created += res.created
      total.updated += res.updated
      total.unchanged += res.unchanged
      total.failed += res.failed
      for (const r of res.results) if (r.error && total.errors.length < 5) total.errors.push(t('contacts.csv.rowError', { row: i + r.index + 2, error: r.error }))
      done.value = Math.min(i + BATCH, inputs.length)
    }
    summary.value = total
    emit('imported')
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.csv.stopped'), description: t('contacts.csv.stoppedDescription', { done: done.value, total: inputs.length }), color: 'error' })
    summary.value = total
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="$t('contacts.csv.title')" :description="$t('contacts.csv.description')" :dismissible="!importing" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <div v-if="summary" class="space-y-4 text-[13px]">
        <p class="text-highlighted">{{ $t('contacts.csv.imported', { file: fileName }) }}</p>
        <ul class="grid grid-cols-4 gap-2 text-center">
          <li class="rounded-lg border border-default p-3"><div class="text-lg font-semibold">{{ summary.created }}</div><div class="text-xs text-muted">{{ $t('contacts.csv.created') }}</div></li>
          <li class="rounded-lg border border-default p-3"><div class="text-lg font-semibold">{{ summary.updated }}</div><div class="text-xs text-muted">{{ $t('contacts.csv.updated') }}</div></li>
          <li class="rounded-lg border border-default p-3"><div class="text-lg font-semibold">{{ summary.unchanged }}</div><div class="text-xs text-muted">{{ $t('contacts.csv.unchanged') }}</div></li>
          <li class="rounded-lg border border-default p-3"><div class="text-lg font-semibold" :class="summary.failed ? 'text-error' : ''">{{ summary.failed }}</div><div class="text-xs text-muted">{{ $t('contacts.csv.failed') }}</div></li>
        </ul>
        <ul v-if="summary.errors.length" class="space-y-1 text-xs text-error"><li v-for="e in summary.errors" :key="e">{{ e }}</li></ul>
        <div class="flex justify-end"><UButton :label="$t('contacts.csv.done')" @click="open = false" /></div>
      </div>

      <div v-else-if="!columns.length" class="space-y-3">
        <label class="flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-default text-[13px] text-muted hover:bg-elevated">
          <UIcon name="i-lucide-file-spreadsheet" class="size-6" />
          {{ $t('contacts.csv.choose') }}
          <input type="file" accept=".csv,text/csv" class="sr-only" @change="pick">
        </label>
        <p class="text-xs text-muted">{{ $t('contacts.csv.help') }}</p>
      </div>

      <div v-else class="space-y-5 text-[13px]">
        <p class="text-muted"><span class="font-medium text-highlighted">{{ fileName }}</span> · {{ records.length }} rows, {{ columns.length }} columns</p>

        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="$t('contacts.form.email')"><OptionalSelect v-model="mapping.email" :items="columnItems" class="w-full" /></UFormField>
          <UFormField :label="$t('contacts.form.userId')" :hint="$t('contacts.form.userIdHint')"><OptionalSelect v-model="mapping.externalId" :items="columnItems" class="w-full" /></UFormField>
          <UFormField :label="$t('common.name')"><OptionalSelect v-model="mapping.name" :items="columnItems" class="w-full" /></UFormField>
          <UFormField :label="$t('contacts.form.tags')" :hint="$t('contacts.csv.tagsHint')"><OptionalSelect v-model="mapping.tags" :items="columnItems" class="w-full" /></UFormField>
          <UFormField :label="$t('contacts.csv.optedIn')" :hint="$t('contacts.csv.optedInHint')"><OptionalSelect v-model="mapping.subscribed" :items="columnItems" class="w-full" /></UFormField>
        </div>

        <UFormField :label="$t('contacts.csv.keepAsAttributes')" :hint="$t('contacts.csv.attributesHint')">
          <UCheckboxGroup v-model="asAttributes" :items="columns.filter(c => !Object.values(mapping).includes(c)).map(c => ({ label: `${c} → ${attributeKeyFor(c)}`, value: c }))" orientation="horizontal" class="flex-wrap" />
        </UFormField>

        <div class="space-y-2">
          <UCheckbox v-if="!mapping.subscribed" v-model="optedIn" :label="$t('contacts.csv.everyoneOptedIn')" :description="$t('contacts.csv.everyoneOptedInDescription')" />
          <UCheckbox v-model="fillOnly" :label="$t('contacts.csv.fillBlanks')" :description="$t('contacts.csv.fillBlanksDescription')" />
        </div>

        <p v-if="!mapping.email && !mapping.externalId" class="text-error">{{ $t('contacts.csv.pickColumn') }}</p>
        <p v-else class="text-muted">{{ $t('contacts.csv.toImport', { count: mapped.inputs.length }) }}<span v-if="mapped.skipped">{{ $t('contacts.csv.skipped', { count: mapped.skipped }) }}</span>.</p>

        <UProgress v-if="importing" :model-value="done" :max="mapped.inputs.length" />
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="importing" @click="reset">{{ $t('contacts.csv.another') }}</UButton>
          <UButton :loading="importing" :disabled="!mapped.inputs.length" :label="$t('contacts.csv.import', { count: mapped.inputs.length })" @click="run" />
        </div>
      </div>
    </template>
  </UModal>
</template>
