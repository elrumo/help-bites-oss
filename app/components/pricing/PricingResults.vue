<template>
  <section v-if="!forbidden" class="space-y-4 rounded-xl border border-default p-4">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.results') }}</h3>
      <USelect v-model="days" :items="[7, 30, 90].map(n => ({ value: n, label: $t('projectTools.pricing.lastDays', { n }) }))" value-key="value" size="xs" class="w-32" />
      <UButton icon="i-lucide-refresh-cw" :label="$t('projectTools.pricing.checkStripe')" size="xs" color="neutral" variant="ghost" :loading="loading === 'refresh'" :disabled="!stripeConnected" @click="load(true)" />
    </div>
    <p class="text-xs text-muted">{{ $t('projectTools.pricing.resultsHint') }}</p>
    <p v-if="error" class="text-xs text-error">{{ error }}</p>

    <USkeleton v-if="!stats && loading" class="h-20 w-full" />
    <template v-else-if="stats">
      <div class="grid gap-2 sm:grid-cols-3">
        <div v-for="(kpi, i) in kpis" :key="kpi.label" class="rounded-lg bg-elevated/50 p-3" :class="i === kpis.length - 1 ? 'sm:col-span-2' : ''">
          <p class="text-xs text-muted">{{ kpi.label }}</p>
          <p class="mt-0.5 text-lg font-semibold tabular-nums text-highlighted">{{ kpi.value }}</p>
          <p v-if="kpi.hint" class="text-[11px] text-dimmed">{{ kpi.hint }}</p>
        </div>
      </div>
      <p class="text-[11px] text-dimmed">{{ conversionNote }}</p>

      <div v-if="maxVisitors" class="space-y-1">
        <p class="text-xs font-medium text-muted">{{ $t('projectTools.pricing.byDay') }}</p>
        <div class="flex h-12 items-end gap-px" role="img" :aria-label="$t('projectTools.pricing.byDay')">
          <div v-for="day in series" :key="day.day" class="min-w-0 flex-1 rounded-t-sm" :class="day.visitors ? 'bg-primary/60' : 'bg-elevated'" :style="{ height: day.visitors ? `${Math.max(6, (day.visitors / maxVisitors) * 100)}%` : '2px' }" :title="`${shortDate(day.day)} · ${t('projectTools.pricing.dayTitle', { visitors: day.visitors, purchases: day.conversions })}`" />
        </div>
      </div>
      <p v-else class="text-xs text-dimmed">{{ $t('projectTools.pricing.noVisits') }}</p>

      <div v-if="planRows.length" class="overflow-x-auto">
        <table class="w-full min-w-[360px] text-xs">
          <thead class="text-left text-muted">
            <tr><th class="py-1 font-medium">{{ $t('projectTools.pricing.plan') }}</th><th class="py-1 text-right font-medium">{{ $t('projectTools.pricing.kpis.clicks') }}</th><th class="py-1 text-right font-medium">{{ $t('projectTools.pricing.kpis.checkouts') }}</th><th class="py-1 text-right font-medium">{{ $t('projectTools.pricing.kpis.conversions') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in planRows" :key="row.key" class="border-t border-default">
              <td class="py-1.5 text-default">{{ row.name }}</td>
              <td class="py-1.5 text-right tabular-nums">{{ row.clicks }}</td>
              <td class="py-1.5 text-right tabular-nums">{{ row.checkouts }}</td>
              <td class="py-1.5 text-right tabular-nums">{{ row.conversions }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div class="space-y-3 border-t border-default pt-4">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.experiment') }}</h3>
        <UBadge :label="statusLabel" :color="experiment.status === 'running' ? 'success' : 'neutral'" variant="soft" size="sm" />
      </div>
      <p class="text-xs text-muted">{{ $t('projectTools.pricing.experimentHint') }}</p>

      <div class="space-y-2">
        <div v-for="arm in arms" :key="arm.key" class="flex flex-wrap items-center gap-2 rounded-lg bg-elevated/50 px-3 py-2">
          <div class="mr-auto min-w-0">
            <p class="truncate text-[13px] text-highlighted">{{ arm.control ? $t('projectTools.pricing.control') : arm.name }}</p>
            <p class="truncate font-mono text-[11px] text-dimmed">{{ arm.key }}<span v-if="!arm.control && arm.status !== 'published'" class="font-sans text-warning"> · {{ arm.status ? $t('projectTools.pricing.variantDraft') : $t('projectTools.pricing.variantMissing') }}</span></p>
          </div>
          <span class="text-xs tabular-nums text-muted">{{ share(arm.weight) }}</span>
          <UInput :model-value="arm.weight" type="number" min="0" max="100" size="xs" class="w-16 tabular-nums" :disabled="running" :aria-label="$t('projectTools.pricing.weightOf', { name: arm.control ? $t('projectTools.pricing.control') : arm.name })" @update:model-value="setWeight(arm, $event)" />
          <UButton v-if="!arm.control && arm.id" :label="$t('projectTools.pricing.openVariant')" size="xs" color="neutral" variant="ghost" :to="`/projects/${projectId}/pricing/${arm.id}`" />
          <UButton v-if="!arm.control" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :disabled="running" :aria-label="$t('projectTools.pricing.removeVariant')" @click="removeVariant(arm.key)" />
        </div>
      </div>

      <div v-if="!running" class="flex flex-wrap items-center gap-2">
        <UButton icon="i-lucide-copy-plus" :label="$t('projectTools.pricing.addVariant')" size="xs" color="neutral" variant="soft" :disabled="draft.variants.length >= PRICING_MAX_VARIANTS" :loading="loading === 'variant'" @click="addVariant" />
        <OptionalSelect v-if="otherTables.length" :model-value="''" :items="otherTables" :none-label="$t('projectTools.pricing.useTable')" size="xs" class="w-48" :disabled="draft.variants.length >= PRICING_MAX_VARIANTS" @update:model-value="useTable" />
        <UButton v-if="draftChanged" :label="$t('projectTools.pricing.saveTest')" size="xs" color="neutral" variant="soft" :loading="loading === 'save'" @click="saveTest" />
        <UButton :label="$t('projectTools.pricing.startTest')" icon="i-lucide-play" size="xs" class="ml-auto" :disabled="!draft.variants.length" :loading="loading === 'start'" @click="start" />
      </div>
      <div v-else class="flex flex-wrap items-center gap-2">
        <p class="mr-auto text-[11px] text-dimmed">{{ $t('projectTools.pricing.runningLocked') }}</p>
        <UDropdownMenu :items="stopItems">
          <UButton :label="$t('projectTools.pricing.stopTest')" icon="i-lucide-square" size="xs" color="neutral" variant="soft" trailing-icon="i-lucide-chevron-down" :loading="loading === 'stop'" />
        </UDropdownMenu>
      </div>

      <div v-if="report" class="overflow-x-auto">
        <p class="mb-1 text-xs font-medium text-muted">{{ $t('projectTools.pricing.runResults', { date: shortDate(report.startedAt) }) }}</p>
        <table class="w-full min-w-[520px] text-xs">
          <thead class="text-left text-muted">
            <tr>
              <th class="py-1 font-medium">{{ $t('projectTools.pricing.table') }}</th>
              <th class="py-1 text-right font-medium">{{ $t('projectTools.pricing.kpis.visitors') }}</th>
              <th class="py-1 text-right font-medium">{{ $t('projectTools.pricing.kpis.clicks') }}</th>
              <th class="py-1 text-right font-medium">{{ $t('projectTools.pricing.kpis.conversions') }}</th>
              <th class="py-1 text-right font-medium">{{ $t('projectTools.pricing.rate') }}</th>
              <th class="py-1 text-right font-medium">{{ $t('projectTools.pricing.lift') }}</th>
              <th class="py-1 text-right font-medium">{{ $t('projectTools.pricing.certainty') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="arm in report.arms" :key="arm.table" class="border-t border-default">
              <td class="py-1.5 text-default">
                {{ arm.control ? $t('projectTools.pricing.control') : arm.name }}
                <UBadge v-if="report.leader === arm.table" :label="$t('projectTools.pricing.leader')" color="success" variant="soft" size="sm" class="ml-1" />
              </td>
              <td class="py-1.5 text-right tabular-nums">{{ arm.funnel.visitors.toLocaleString() }}</td>
              <td class="py-1.5 text-right tabular-nums">{{ arm.funnel.clicks.toLocaleString() }}</td>
              <td class="py-1.5 text-right tabular-nums">{{ arm.funnel.conversions.toLocaleString() }}</td>
              <td class="py-1.5 text-right tabular-nums">{{ percent(arm.rate) }}</td>
              <td class="py-1.5 text-right tabular-nums" :class="arm.control || arm.lift === null ? 'text-dimmed' : arm.lift > 0 ? 'text-success' : arm.lift < 0 ? 'text-error' : ''">{{ arm.control || arm.lift === null ? '–' : `${arm.lift > 0 ? '+' : ''}${percent(arm.lift)}` }}</td>
              <td class="py-1.5 text-right tabular-nums text-muted">{{ arm.control ? '–' : arm.enough ? $t('projectTools.pricing.sure', { n: Math.round(arm.confidence * 100) }) : $t('projectTools.pricing.notEnough') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { PRICING_MAX_VARIANTS, type PricingExperiment, type PricingFunnel, type PricingPlan } from '#shared/pricing'
import { formatMoney, fromMinor } from '#shared/stripe'

type Arm = { table: string, name: string, id: string, control: boolean, weight: number, funnel: PricingFunnel, rate: number, lift: number | null, confidence: number, enough: boolean }
type Report = PricingExperiment & { arms: Arm[], leader: string | null }
type Stats = { total: PricingFunnel, days: Array<{ day: string } & PricingFunnel>, experiment: Report | null, conversions: { at: string, error: string } | null }
type Summary = { id: string, key: string, name: string, status: string }
type Table = Summary & { experiment: PricingExperiment, plans: PricingPlan[] }

const props = defineProps<{ projectId: string, table: Table, stripeConnected: boolean, workingCopyDirty: boolean }>()
const emit = defineEmits<{ update: [table: any], adopted: [table: any] }>()
const { api } = useAgent()
const { t, locale } = useI18n()
const toast = useToast()

const stats = ref<Stats | null>(null)
const days = ref(30)
const loading = ref('')
const error = ref('')
const forbidden = ref(false)
const tables = ref<Summary[]>([])

async function load(refresh = false) {
  loading.value = refresh ? 'refresh' : 'load'
  try {
    stats.value = await api<Stats>(`/admin/pricing-tables/${props.table.id}/stats`, { query: { days: days.value, ...(refresh ? { refresh: '1' } : {}) } })
    error.value = ''
  } catch (e: any) {
    if (e?.statusCode === 403) forbidden.value = true
    else error.value = e?.message || t('projectTools.pricing.statsError')
  } finally {
    loading.value = ''
  }
}

async function loadTables() {
  try {
    tables.value = (await api<{ tables: Summary[] }>('/admin/pricing-tables', { query: { project: props.projectId } })).tables
  } catch {}
}

watch(days, () => load())
onMounted(() => Promise.all([load(), loadTables()]))

const fmt = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }))
const percent = (n: number) => fmt.value.format(n)
const kpis = computed(() => {
  const total = stats.value!.total
  const of = (n: number) => total.visitors ? t('projectTools.pricing.ofVisitors', { rate: percent(n / total.visitors) }) : ''
  const revenue = Object.entries(total.revenue).filter(([, amount]) => amount > 0).map(([currency, amount]) => formatMoney(fromMinor(amount, currency), currency))
  return [
    { label: t('projectTools.pricing.kpis.visitors'), value: total.visitors.toLocaleString(), hint: t('projectTools.pricing.viewsCount', { n: total.views.toLocaleString() }) },
    { label: t('projectTools.pricing.kpis.clicks'), value: total.clicks.toLocaleString(), hint: of(total.clicks) },
    { label: t('projectTools.pricing.kpis.checkouts'), value: total.checkouts.toLocaleString(), hint: of(total.checkouts) },
    { label: t('projectTools.pricing.kpis.conversions'), value: total.conversions.toLocaleString(), hint: of(total.conversions) },
    { label: t('projectTools.pricing.kpis.revenue'), value: revenue[0] || '–', hint: revenue.slice(1).join(' · ') }
  ]
})
const conversionNote = computed(() => {
  if (!props.stripeConnected) return t('projectTools.pricing.conversionsOff')
  const status = stats.value?.conversions
  if (!status) return t('projectTools.pricing.conversionsNever')
  return status.error ? t('projectTools.pricing.conversionsError', { message: status.error }) : t('projectTools.pricing.conversionsChecked', { time: logTime(status.at) })
})
// Every day of the range, so a quiet day shows as a gap.
const series = computed(() => {
  const byDay = new Map((stats.value?.days || []).map(d => [d.day, d]))
  return Array.from({ length: days.value }, (_, i) => {
    const day = new Date(Date.now() - (days.value - 1 - i) * 86_400_000).toISOString().slice(0, 10)
    return { day, visitors: byDay.get(day)?.visitors || 0, conversions: byDay.get(day)?.conversions || 0 }
  })
})
const maxVisitors = computed(() => Math.max(0, ...series.value.map(d => d.visitors)))
const planRows = computed(() => Object.entries(stats.value?.total.plans || {}).map(([key, n]) => ({ key, name: props.table.plans.find(p => p.key === key)?.name || key, ...n })).sort((a, b) => b.clicks - a.clicks))

// ---- the A/B test ----
const experiment = computed(() => props.table.experiment)
const running = computed(() => experiment.value.status === 'running')
const report = computed(() => stats.value?.experiment || null)
const draft = ref<{ weight: number, variants: { table: string, weight: number }[] }>({ weight: 50, variants: [] })
const fromTable = () => ({ weight: experiment.value.weight, variants: experiment.value.variants.map(v => ({ ...v })) })
watch(experiment, () => { draft.value = fromTable() }, { immediate: true })
const draftChanged = computed(() => JSON.stringify(draft.value) !== JSON.stringify(fromTable()))

const byKey = computed(() => new Map(tables.value.map(row => [row.key, row])))
const arms = computed(() => [
  { key: props.table.key, name: props.table.name, id: props.table.id, status: props.table.status, control: true, weight: draft.value.weight },
  ...draft.value.variants.map(v => ({ key: v.table, name: byKey.value.get(v.table)?.name || v.table, id: byKey.value.get(v.table)?.id || '', status: byKey.value.get(v.table)?.status || '', control: false, weight: v.weight }))
])
const totalWeight = computed(() => arms.value.reduce((sum, arm) => sum + arm.weight, 0))
const share = (weight: number) => totalWeight.value ? percent(weight / totalWeight.value) : '–'
const otherTables = computed(() => tables.value.filter(row => row.key !== props.table.key && !draft.value.variants.some(v => v.table === row.key)).map(row => ({ label: row.name, value: row.key })))
const statusLabel = computed(() => experiment.value.status === 'running'
  ? t('projectTools.pricing.experimentStatus.running', { date: shortDate(experiment.value.startedAt) })
  : experiment.value.status === 'ended' ? t('projectTools.pricing.experimentStatus.ended', { date: shortDate(experiment.value.endedAt) }) : t('projectTools.pricing.experimentStatus.off'))

function setWeight(arm: { control: boolean, key: string }, value: string | number) {
  const n = Math.min(100, Math.max(0, Math.round(Number(value) || 0)))
  if (arm.control) draft.value.weight = n
  else draft.value.variants.find(v => v.table === arm.key)!.weight = n
}

function removeVariant(key: string) {
  draft.value.variants = draft.value.variants.filter(v => v.table !== key)
}

function useTable(key: string) {
  if (key) draft.value.variants.push({ table: key, weight: draft.value.weight || 50 })
}

async function run(kind: string, request: () => Promise<{ table: any }>, done?: string) {
  loading.value = kind
  error.value = ''
  try {
    const { table } = await request()
    emit(kind === 'adopt' ? 'adopted' : 'update', table)
    if (done) toast.add({ title: done, icon: 'i-lucide-check', color: 'success' })
    await Promise.all([load(), loadTables()])
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pricing.saveError')
  } finally {
    loading.value = ''
  }
}

const saveTest = () => run('save', () => api(`/admin/pricing-tables/${props.table.id}`, { method: 'PATCH', body: { experiment: draft.value } }))

async function addVariant() {
  if (draftChanged.value) await saveTest()
  await run('variant', async () => {
    const { table, variant } = await api<{ table: any, variant: Summary }>(`/admin/pricing-tables/${props.table.id}/variants`, { method: 'POST' })
    toast.add({ title: t('projectTools.pricing.variantAdded', { key: variant.key }), icon: 'i-lucide-check', color: 'success' })
    return { table }
  })
}

async function start() {
  if (draftChanged.value) await saveTest()
  await run('start', () => api(`/admin/pricing-tables/${props.table.id}/experiment/start`, { method: 'POST' }), t('projectTools.pricing.startedToast'))
}

function stop(adopt?: { key: string, name: string }) {
  if (adopt && !confirm(`${t('projectTools.pricing.adoptConfirm', { name: adopt.name })}${props.workingCopyDirty ? ` ${t('projectTools.pricing.adoptDirty')}` : ''}`)) return
  return run(adopt ? 'adopt' : 'stop', () => api(`/admin/pricing-tables/${props.table.id}/experiment/stop`, { method: 'POST', body: adopt ? { adopt: adopt.key } : {} }), t('projectTools.pricing.stoppedToast'))
}

const stopItems = computed(() => [[
  { label: t('projectTools.pricing.stopKeep'), icon: 'i-lucide-square', onSelect: () => stop() },
  ...arms.value.filter(arm => !arm.control).map(arm => ({ label: t('projectTools.pricing.stopAdopt', { name: arm.name }), icon: 'i-lucide-trophy', onSelect: () => stop({ key: arm.key, name: arm.name }) }))
]])
</script>
