<script setup lang="ts">
/**
 * Rules over contacts — "plan is pro and seen in the last 30 days" — with a
 * live count of who matches. Edits a filter in place; the parent saves it.
 */
import { watchDebounced } from '@vueuse/core'
import type { Contact } from '#shared/contacts'
import { SEGMENT_FIELDS, SEGMENT_OP_LABELS, SEGMENT_OPS, segmentFieldKind, type SegmentFilter, type SegmentRule } from '#shared/segments'
import { SUBSCRIPTION_STATUS } from '~/utils/contactStatus'

const props = defineProps<{ projectId: string }>()
const filter = defineModel<SegmentFilter>({ required: true })

const { api } = useAgent()

const ATTRIBUTE = '__attribute'
const fieldItems = [...SEGMENT_FIELDS.map(f => ({ label: f.label, value: f.key })), { label: 'Attribute…', value: ATTRIBUTE }]
const matchItems = [{ label: 'all of', value: 'all' }, { label: 'any of', value: 'any' }]
const subscriptionItems = Object.entries(SUBSCRIPTION_STATUS).map(([value, s]) => ({ label: s.label, value }))

const fieldOf = (rule: SegmentRule) => (rule.field.startsWith('attributes.') ? ATTRIBUTE : rule.field)
const kindOf = (rule: SegmentRule) => segmentFieldKind(rule.field) || (rule.field.startsWith('attributes.') ? 'attribute' : 'text')
const opItems = (rule: SegmentRule) => SEGMENT_OPS[kindOf(rule)].map(op => ({ label: SEGMENT_OP_LABELS[op], value: op }))
const needsValue = (rule: SegmentRule) => rule.op !== 'exists' && rule.op !== 'not_exists'
const isDays = (rule: SegmentRule) => rule.op === 'within_days' || rule.op === 'not_within_days'
const isDate = (rule: SegmentRule) => rule.op === 'before' || rule.op === 'after'

function setField(rule: SegmentRule, value: string) {
  rule.field = value === ATTRIBUTE ? 'attributes.' : value
  if (!SEGMENT_OPS[kindOf(rule)].includes(rule.op)) rule.op = SEGMENT_OPS[kindOf(rule)][0]!
  rule.value = rule.field === 'subscription' ? 'subscribed' : ''
}

function addRule() {
  filter.value.rules.push({ field: 'tags', op: 'includes', value: '' })
}

const count = ref<number | null>(null)
const sample = ref<Contact[]>([])
const previewError = ref('')
async function preview() {
  previewError.value = ''
  const rules = filter.value.rules.filter(r => !needsValue(r) || String(r.value ?? '').trim())
  try {
    const res = await api<{ count: number, sample: Contact[] }>('/segments/preview', { method: 'POST', body: { project: props.projectId, filter: { ...filter.value, rules } } })
    count.value = res.count
    sample.value = res.sample
  } catch (e: any) {
    count.value = null
    previewError.value = e?.message || 'Could not count'
  }
}
watchDebounced(filter, preview, { debounce: 400, deep: true, immediate: true })
</script>

<template>
  <div class="space-y-3 text-[13px]">
    <div class="flex items-center gap-2 text-muted">
      Contacts matching
      <USelect v-model="filter.match" :items="matchItems" value-key="value" size="xs" class="w-24" />
      these rules
    </div>
    <p v-if="!filter.rules.length" class="text-xs text-dimmed">No rules: everyone in the project.</p>
    <div v-for="(rule, i) in filter.rules" :key="i" class="flex flex-wrap items-center gap-1.5">
      <USelect :model-value="fieldOf(rule)" :items="fieldItems" value-key="value" size="sm" class="w-36" aria-label="Field" @update:model-value="setField(rule, String($event))" />
      <UInput v-if="fieldOf(rule) === ATTRIBUTE" :model-value="rule.field.slice(11)" placeholder="plan" size="sm" class="w-28 font-mono" aria-label="Attribute key" @update:model-value="rule.field = `attributes.${String($event).trim()}`" />
      <USelect v-model="rule.op" :items="opItems(rule)" value-key="value" size="sm" class="w-40" aria-label="Condition" />
      <template v-if="needsValue(rule)">
        <USelect v-if="rule.field === 'subscription'" v-model="rule.value as string" :items="subscriptionItems" value-key="value" size="sm" class="w-40" aria-label="Value" />
        <UInput v-else-if="isDays(rule)" v-model.number="rule.value as number" type="number" min="1" placeholder="30" size="sm" class="w-24" aria-label="Days" />
        <UInput v-else-if="isDate(rule)" v-model="rule.value as string" type="date" size="sm" class="w-40" aria-label="Date" />
        <UInput v-else v-model="rule.value as string" placeholder="value" size="sm" class="min-w-0 flex-1" aria-label="Value" />
      </template>
      <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square aria-label="Remove rule" @click="filter.rules.splice(i, 1)" />
    </div>
    <UButton icon="i-lucide-plus" label="Rule" size="xs" color="neutral" variant="ghost" @click="addRule" />

    <div class="rounded-lg border border-default px-3 py-2">
      <p v-if="previewError" class="text-xs text-error">{{ previewError }}</p>
      <p v-else-if="count === null" class="text-xs text-muted">Counting…</p>
      <template v-else>
        <p class="font-medium text-highlighted">{{ count.toLocaleString() }} {{ count === 1 ? 'contact matches' : 'contacts match' }}</p>
        <p v-if="sample.length" class="mt-0.5 truncate text-xs text-muted">{{ sample.map(c => c.name || c.email || c.externalId).join(', ') }}</p>
      </template>
    </div>
  </div>
</template>
