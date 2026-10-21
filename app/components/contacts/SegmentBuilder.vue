<script setup lang="ts">
/**
 * Rules over contacts — "plan is pro and seen in the last 30 days" — with a
 * live count of who matches. Edits a filter in place; the parent saves it.
 */
import { watchDebounced } from '@vueuse/core'
import { CONTACT_ORIGIN_TYPES, type Contact } from '#shared/contacts'
import { SEGMENT_FIELDS, SEGMENT_OPS, segmentFieldKind, type SegmentFilter, type SegmentRule } from '#shared/segments'
import { SUBSCRIPTION_STATUS } from '~/utils/contactStatus'

const props = defineProps<{ projectId: string }>()
const filter = defineModel<SegmentFilter>({ required: true })

const { api } = useAgent()
const { t } = useI18n()

const ATTRIBUTE = '__attribute'
const fieldItems = computed(() => [...SEGMENT_FIELDS.map(f => ({ label: t(`contacts.builder.field.${f.key}`), value: f.key })), { label: t('contacts.builder.attributeField'), value: ATTRIBUTE }])
const matchItems = computed(() => [{ label: t('contacts.builder.allOf'), value: 'all' }, { label: t('contacts.builder.anyOf'), value: 'any' }])
const subscriptionItems = computed(() => Object.keys(SUBSCRIPTION_STATUS).map(value => ({ label: t(`contacts.subscription.${value}.label`), value })))
const originItems = computed(() => CONTACT_ORIGIN_TYPES.map((value): { label: string, value: string } => ({ label: t(`contacts.origin.${value}`), value })))
// The project's lead forms, for "Lead form includes …": loaded once a rule needs them.
const forms = ref<{ id: string, name: string }[] | null>(null)
const formItems = computed(() => (forms.value || []).map(f => ({ label: f.name, value: f.id })))
watch(() => filter.value.rules.some(r => r.field === 'leadForms'), (needed) => {
  if (!needed || forms.value) return
  forms.value = []
  api<{ forms: { id: string, name: string }[] }>('/admin/lead-forms', { query: { project: props.projectId } }).then((r) => { forms.value = r.forms }).catch(() => {})
}, { immediate: true })

const fieldOf = (rule: SegmentRule) => (rule.field.startsWith('attributes.') ? ATTRIBUTE : rule.field)
const kindOf = (rule: SegmentRule) => segmentFieldKind(rule.field) || (rule.field.startsWith('attributes.') ? 'attribute' : 'text')
const opItems = (rule: SegmentRule) => SEGMENT_OPS[kindOf(rule)].map(op => ({ label: t(`contacts.builder.op.${op}`), value: op }))
const needsValue = (rule: SegmentRule) => rule.op !== 'exists' && rule.op !== 'not_exists'
const isDays = (rule: SegmentRule) => rule.op === 'within_days' || rule.op === 'not_within_days'
const isDate = (rule: SegmentRule) => rule.op === 'before' || rule.op === 'after'

function setField(rule: SegmentRule, value: string) {
  rule.field = value === ATTRIBUTE ? 'attributes.' : value
  if (!SEGMENT_OPS[kindOf(rule)].includes(rule.op)) rule.op = SEGMENT_OPS[kindOf(rule)][0]!
  rule.value = rule.field === 'subscription' ? 'subscribed' : rule.field === 'origin' ? 'lead_form' : ''
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
    previewError.value = e?.message || t('contacts.builder.countError')
  }
}
watchDebounced(filter, preview, { debounce: 400, deep: true, immediate: true })
</script>

<template>
  <div class="space-y-3 text-[13px]">
    <div class="flex items-center gap-2 text-muted">
      {{ $t('contacts.builder.matchingIntro') }}
      <USelect v-model="filter.match" :items="matchItems" value-key="value" size="xs" class="w-24" />
      {{ $t('contacts.builder.matchingOutro') }}
    </div>
    <p v-if="!filter.rules.length" class="text-xs text-dimmed">{{ $t('contacts.builder.noRules') }}</p>
    <div v-for="(rule, i) in filter.rules" :key="i" class="flex flex-wrap items-center gap-1.5">
      <USelect :model-value="fieldOf(rule)" :items="fieldItems" value-key="value" size="sm" class="w-36" :aria-label="$t('contacts.builder.aria.field')" @update:model-value="setField(rule, String($event))" />
      <UInput v-if="fieldOf(rule) === ATTRIBUTE" :model-value="rule.field.slice(11)" :placeholder="$t('contacts.builder.attributePlaceholder')" size="sm" class="w-28 font-mono" :aria-label="$t('contacts.builder.aria.attributeKey')" @update:model-value="rule.field = `attributes.${String($event).trim()}`" />
      <USelect v-model="rule.op" :items="opItems(rule)" value-key="value" size="sm" class="w-40" :aria-label="$t('contacts.builder.aria.condition')" />
      <template v-if="needsValue(rule)">
        <USelect v-if="rule.field === 'subscription'" v-model="rule.value as string" :items="subscriptionItems" value-key="value" size="sm" class="w-40" :aria-label="$t('contacts.drawer.value')" />
        <USelect v-else-if="rule.field === 'origin'" v-model="rule.value as string" :items="originItems" value-key="value" size="sm" class="w-44" :aria-label="$t('contacts.drawer.value')" />
        <USelect v-else-if="rule.field === 'leadForms' && formItems.length" v-model="rule.value as string" :items="formItems" value-key="value" :placeholder="$t('contacts.builder.pickForm')" size="sm" class="w-48" :aria-label="$t('contacts.drawer.value')" />
        <UInput v-else-if="isDays(rule)" v-model.number="rule.value as number" type="number" min="1" placeholder="30" size="sm" class="w-24" :aria-label="$t('contacts.builder.aria.days')" />
        <UInput v-else-if="isDate(rule)" v-model="rule.value as string" type="date" size="sm" class="w-40" :aria-label="$t('contacts.builder.aria.date')" />
        <UInput v-else v-model="rule.value as string" :placeholder="$t('contacts.drawer.value')" size="sm" class="min-w-0 flex-1" :aria-label="$t('contacts.drawer.value')" />
      </template>
      <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('contacts.builder.aria.removeRule')" @click="filter.rules.splice(i, 1)" />
    </div>
    <UButton icon="i-lucide-plus" :label="$t('contacts.builder.rule')" size="xs" color="neutral" variant="ghost" @click="addRule" />

    <div class="rounded-lg border border-default px-3 py-2">
      <p v-if="previewError" class="text-xs text-error">{{ previewError }}</p>
      <p v-else-if="count === null" class="text-xs text-muted">{{ $t('contacts.builder.counting') }}</p>
      <template v-else>
        <p class="font-medium text-highlighted">{{ count === 1 ? $t('contacts.builder.matchOne') : $t('contacts.builder.matchMany', { count: count.toLocaleString() }) }}</p>
        <p v-if="sample.length" class="mt-0.5 truncate text-xs text-muted">{{ sample.map(c => c.name || c.email || c.externalId).join(', ') }}</p>
      </template>
    </div>
  </div>
</template>
