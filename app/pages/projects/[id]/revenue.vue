<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.revenue')">
      <template v-if="sources.length" #actions>
        <USelect v-model="range" :items="REVENUE_RANGES" value-key="value" size="sm" class="w-40" :aria-label="$t('projectTools.revenue.period')" @update:model-value="loadReport()" />
        <UButton v-if="pulled.length" icon="i-lucide-refresh-cw" :label="$t('projectTools.revenue.sync')" size="sm" color="neutral" variant="outline" :loading="pulled.some(c => c.status === 'running')" @click="pulled.forEach(c => sync(c.source, false))" />
        <UDropdownMenu :items="menu">
          <UButton icon="i-lucide-ellipsis" size="sm" color="neutral" variant="ghost" square :aria-label="$t('projectTools.shared.more')" />
        </UDropdownMenu>
      </template>
    </PageHeader>

    <main class="min-h-0 flex-1 overflow-y-auto p-6">
      <div class="mx-auto max-w-5xl space-y-6">
        <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" :aria-label="$t('projectTools.revenue.loadingLabel')">
          <USkeleton v-for="n in 4" :key="n" class="h-24 rounded-xl" />
        </div>

        <EmptyState v-else-if="!sources.length" icon="i-lucide-circle-dollar-sign" :title="$t('projectTools.revenue.connectTitle')" :description="$t('projectTools.revenue.connectDescription')">
          <RevenueConnect :project-id="id" @connected="connected" />
        </EmptyState>

        <template v-else>
          <ul class="space-y-1.5 text-xs text-muted">
            <li v-for="c in sources" :key="c.source" class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <UIcon :name="revenueSource(c.source)?.icon || 'i-lucide-circle-dollar-sign'" class="size-3.5" />
              <span class="font-medium text-default">{{ nameOf(c.source) }}</span>
              <UBadge v-if="revenueSource(c.source)?.kind === 'pull'" :label="c.livemode ? $t('projectTools.revenue.live') : $t('projectTools.revenue.testMode')" :color="c.livemode ? 'success' : 'warning'" variant="subtle" size="sm" />
              <span v-if="c.accountName && c.accountName !== nameOf(c.source)">{{ c.accountName }}</span>
              <span>{{ statusText(c) }}</span>
              <UButton v-if="revenueSource(c.source)?.kind !== 'pull'" color="neutral" variant="link" size="xs" class="px-0" :label="$t('projectTools.revenue.setup')" @click="setupFor = c.source" />
            </li>
          </ul>
          <UAlert v-for="c in sources.filter(c => c.lastError)" :key="c.source" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="`${nameOf(c.source)}: ${$t(revenueSource(c.source)?.kind === 'pull' ? 'projectTools.revenue.syncFailed' : 'projectTools.revenue.eventFailed')}`" :description="c.lastError" />

          <EmptyState v-if="!report" icon="i-lucide-hourglass" :title="$t('projectTools.revenue.waitingTitle')" :description="$t('projectTools.revenue.waitingDescription')" />
          <template v-else>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div v-for="kpi in kpis" :key="kpi.label" class="rounded-xl border border-default p-4">
                <p class="text-xs text-muted">{{ kpi.label }}</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums text-highlighted">{{ kpi.value }}</p>
                <p v-if="kpi.hint" class="mt-0.5 text-xs text-muted">{{ kpi.hint }}</p>
              </div>
            </div>

            <section class="rounded-xl border border-default p-4">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <h2 class="flex-1 font-semibold">{{ $t('projectTools.revenue.byMonth') }}</h2>
                <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm bg-primary/70" />{{ $t('projectTools.revenue.netRevenue') }}</span>
                <span class="flex items-center gap-1.5"><span class="h-0.5 w-3 rounded-full bg-inverted" />MRR</span>
              </div>
              <!-- One column per month is the hover and focus target; the MRR line is drawn over the bars on the same scale. -->
              <div class="relative mt-4 h-40" @mouseleave="hovered = -1">
                <ul class="flex h-full items-end" :aria-label="$t('projectTools.revenue.byMonth')">
                  <li
                    v-for="(m, i) in report.months" :key="m.month" tabindex="0"
                    class="flex h-full min-w-0 flex-1 items-end rounded px-[3px] outline-primary focus-visible:outline-2" :class="hovered === i && 'bg-elevated/60'"
                    :aria-label="$t('projectTools.revenue.monthTitle', { month: monthLabel(m.month), net: money(m.net), payments: m.payments, mrr: money(m.mrr) })"
                    @mouseenter="hovered = i" @focus="hovered = i" @blur="hovered = -1"
                  >
                    <div class="w-full rounded-t" :class="hovered === i ? 'bg-primary' : 'bg-primary/70'" :style="{ height: `${Math.max(m.net ? 3 : 0, (m.net / peak) * 100)}%` }" />
                  </li>
                </ul>
                <svg class="pointer-events-none absolute inset-0 size-full overflow-visible" :viewBox="`0 0 ${report.months.length} 100`" preserveAspectRatio="none" aria-hidden="true">
                  <polyline :points="mrrLine" fill="none" stroke="var(--ui-bg-inverted)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
                </svg>
                <template v-if="point">
                  <span class="pointer-events-none absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-inverted ring-2 ring-(--ui-bg)" :style="{ left: `${((hovered + 0.5) / report.months.length) * 100}%`, bottom: `${(point.mrr / peak) * 100}%` }" />
                  <div class="pointer-events-none absolute top-0 z-10 space-y-1 rounded-lg bg-default px-2.5 py-2 text-xs whitespace-nowrap shadow-lg ring ring-default" :style="tooltipAt(hovered)">
                    <p class="font-medium text-highlighted">{{ monthLabel(point.month) }}</p>
                    <p class="flex items-center gap-2">
                      <span class="size-2.5 rounded-sm bg-primary/70" />
                      <span class="font-semibold tabular-nums text-highlighted">{{ money(point.net) }}</span>
                      <span class="text-muted">{{ $t('projectTools.revenue.netRevenue') }} · {{ $t('projectTools.revenue.payments', point.payments) }}</span>
                    </p>
                    <p class="flex items-center gap-2">
                      <span class="h-0.5 w-2.5 rounded-full bg-inverted" />
                      <span class="font-semibold tabular-nums text-highlighted">{{ money(point.mrr) }}</span>
                      <span class="text-muted">MRR</span>
                    </p>
                  </div>
                </template>
              </div>
              <ul class="mt-1 flex" aria-hidden="true">
                <li v-for="m in report.months" :key="m.month" class="min-w-0 flex-1 truncate text-center text-[10px] text-muted">{{ m.month.slice(5) }}</li>
              </ul>
            </section>

            <div class="grid gap-6 lg:grid-cols-2">
              <section class="space-y-2">
                <h2 class="text-xs font-semibold text-muted">{{ $t('projectTools.revenue.plans') }}</h2>
                <p v-if="!report.plans.length" class="text-xs text-dimmed">{{ $t('projectTools.revenue.noSubscribers') }}</p>
                <ul v-else class="divide-y divide-default rounded-xl border border-default text-[13px]">
                  <li v-for="p in report.plans" :key="p.plan" class="flex items-center gap-3 px-3 py-2">
                    <span class="min-w-0 flex-1 truncate">{{ p.plan }}</span>
                    <span class="text-xs text-muted">{{ $t('projectTools.revenue.subscribers', p.subscribers) }}</span>
                    <span class="w-24 text-right tabular-nums">{{ $t('projectTools.revenue.perMonth', { amount: money(p.mrr) }) }}</span>
                  </li>
                </ul>
              </section>
              <section class="space-y-2">
                <h2 class="text-xs font-semibold text-muted">{{ $t('projectTools.revenue.topCustomers') }}</h2>
                <p v-if="!report.topCustomers.length" class="text-xs text-dimmed">{{ $t('projectTools.revenue.noPayments') }}</p>
                <ul v-else class="divide-y divide-default rounded-xl border border-default text-[13px]">
                  <li v-for="c in report.topCustomers" :key="c.customerId" class="flex items-center gap-3 px-3 py-2">
                    <NuxtLink v-if="c.contactId" :to="contactLink(c.contactId)" class="min-w-0 flex-1 truncate hover:underline" :title="$t('projectTools.revenue.openContact')">{{ c.email || c.customerId }}</NuxtLink>
                    <span v-else class="min-w-0 flex-1 truncate">{{ c.email || c.customerId }}</span>
                    <span class="text-xs text-muted">{{ $t('projectTools.revenue.payments', c.payments) }}</span>
                    <span class="w-24 text-right tabular-nums">{{ money(c.net) }}</span>
                  </li>
                </ul>
              </section>
            </div>

            <section v-if="report.sources.length > 1" class="space-y-2">
              <h2 class="text-xs font-semibold text-muted">{{ $t('projectTools.revenue.bySource') }}</h2>
              <ul class="divide-y divide-default rounded-xl border border-default text-[13px]">
                <li v-for="r in report.sources" :key="r.source" class="flex items-center gap-3 px-3 py-2">
                  <UIcon :name="revenueSource(r.source)?.icon || 'i-lucide-circle-dollar-sign'" class="size-4 shrink-0 text-muted" />
                  <span class="min-w-0 flex-1 truncate">{{ nameOf(r.source) }}</span>
                  <span class="text-xs text-muted">{{ $t('projectTools.revenue.payments', r.payments) }}</span>
                  <span v-if="r.mrr" class="w-24 text-right text-xs text-muted tabular-nums">{{ $t('projectTools.revenue.perMonth', { amount: money(r.mrr) }) }}</span>
                  <span class="w-24 text-right tabular-nums">{{ money(r.net) }}</span>
                </li>
              </ul>
            </section>

            <section class="space-y-2">
              <h2 class="text-xs font-semibold text-muted">{{ $t('projectTools.revenue.recentPayments') }}</h2>
              <ul class="divide-y divide-default rounded-xl border border-default text-[13px]">
                <li v-for="p in report.recent" :key="p.id" class="flex items-center gap-3 px-3 py-2">
                  <NuxtLink v-if="p.contactId" :to="contactLink(p.contactId)" class="min-w-0 flex-1 truncate hover:underline" :title="$t('projectTools.revenue.openContact')">{{ p.email || p.customerId || $t('projectTools.revenue.guest') }}<span v-if="p.description" class="text-muted"> · {{ p.description }}</span></NuxtLink>
                  <span v-else class="min-w-0 flex-1 truncate">{{ p.email || p.customerId || $t('projectTools.revenue.guest') }}<span v-if="p.description" class="text-muted"> · {{ p.description }}</span></span>
                  <span v-if="report.sources.length > 1" class="text-xs text-dimmed">{{ nameOf(p.source || 'stripe') }}</span>
                  <UBadge v-if="p.status !== 'succeeded'" :label="p.status" color="error" variant="subtle" size="sm" />
                  <UBadge v-else-if="p.refunded" :label="p.refunded >= p.amount ? $t('projectTools.revenue.refunded') : $t('projectTools.revenue.partRefunded')" color="neutral" variant="subtle" size="sm" />
                  <span class="w-24 text-right tabular-nums">{{ formatMoney(fromMinor(p.amount, p.currency), p.currency) }}</span>
                  <span class="w-14 text-right text-xs text-muted">{{ logTime(p.paidAt) }}</span>
                </li>
                <li v-if="!report.recent.length" class="px-3 py-6 text-center text-muted">{{ $t('projectTools.revenue.noPayments') }}</li>
              </ul>
            </section>
            <p v-if="report.otherCurrencies.length" class="text-xs text-muted">{{ $t('projectTools.revenue.totalsIn', { currency: report.currency.toUpperCase(), others: report.otherCurrencies.map(c => formatMoney(c.net, c.currency)).join(', ') }) }}</p>
          </template>

          <!-- TestFlight shares the App Store source's key; it loads on its own so a key that only reads sales does not hide the revenue. -->
          <section v-if="apple" class="space-y-2">
            <h2 class="text-xs font-semibold text-muted">{{ $t('projectTools.revenue.testflight.title') }}<span class="ml-2 font-normal text-dimmed">{{ $t('projectTools.revenue.testflight.note') }}</span></h2>
            <USkeleton v-if="testflightLoading" class="h-24 rounded-xl" :aria-label="$t('projectTools.revenue.testflight.loading')" />
            <UAlert v-else-if="testflightError" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :title="$t('projectTools.revenue.testflight.error')" :description="testflightError" />
            <p v-else-if="!testflight?.apps.some(a => a.builds.length)" class="text-xs text-dimmed">{{ $t('projectTools.revenue.testflight.none') }}</p>
            <template v-else>
              <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <div v-for="k in TESTFLIGHT_COUNTS" :key="k" class="rounded-xl border border-default p-4">
                  <p class="text-xs text-muted">{{ $t(`projectTools.revenue.testflight.${k}`) }}</p>
                  <p class="mt-1 text-2xl font-semibold tabular-nums text-highlighted">{{ testflight!.totals[k].toLocaleString() }}</p>
                </div>
              </div>
              <div v-for="a in testflight!.apps.filter(a => a.builds.length)" :key="a.id" class="rounded-xl border border-default text-[13px]">
                <p class="flex items-center gap-2 border-b border-default px-3 py-2 font-medium"><span class="min-w-0 flex-1 truncate">{{ a.name }}</span><span class="text-xs font-normal text-muted">{{ a.bundleId }}</span></p>
                <ul class="divide-y divide-default">
                  <li v-for="b in a.builds" :key="b.id" class="flex items-center gap-3 px-3 py-2">
                    <span class="min-w-0 flex-1 truncate">{{ $t('projectTools.revenue.testflight.build', { version: b.version || '?', build: b.build }) }}<UBadge v-if="b.expired" :label="$t('projectTools.revenue.testflight.expired')" color="neutral" variant="subtle" size="sm" class="ml-2" /></span>
                    <span v-for="k in TESTFLIGHT_COUNTS" :key="k" class="hidden w-16 text-right tabular-nums sm:block" :title="$t(`projectTools.revenue.testflight.${k}`)">{{ b[k].toLocaleString() }}</span>
                    <span class="w-14 text-right text-xs text-muted">{{ b.uploadedAt ? logTime(b.uploadedAt) : '' }}</span>
                  </li>
                </ul>
              </div>
            </template>
          </section>
        </template>
      </div>
    </main>

    <UModal v-model:open="adding" :title="$t('projectTools.revenue.addSource')">
      <template #body>
        <RevenueConnect :project-id="id" :exclude="sources.map(c => c.source)" @connected="connected" />
      </template>
    </UModal>
    <UModal v-model:open="setupOpen" :title="setupFor === 'revenuecat' ? $t('projectTools.revenue.setupSheet.revenuecat.title') : $t('projectTools.revenue.setupSheet.custom.title')">
      <template #body>
        <RevenueSetup v-if="setupConnection" :project-id="id" :connection="setupConnection" />
      </template>
      <template #footer>
        <UButton class="ml-auto" :label="$t('projectTools.revenue.setupSheet.done')" @click="setupFor = ''" />
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { revenueSource, type RevenueConnection, type TestflightCounts, type TestflightReport } from '#shared/revenue'
import { REVENUE_RANGES, formatMoney, fromMinor, type RevenueRange, type RevenueReport } from '#shared/stripe'
import { logTime } from '~/utils/emailStatus'

definePageMeta({ middleware: 'agent' })
const { api } = useAgent()
const toast = useToast()
const { t, locale } = useI18n()
const nameOf = useRevenueSourceName()
const id = String(useRoute().params.id)

const sources = ref<RevenueConnection[]>([])
const report = ref<RevenueReport | null>(null)
const range = ref<RevenueRange>('30d')
const loading = ref(true)
const testflight = ref<TestflightReport | null>(null)
const testflightLoading = ref(false)
const testflightError = ref('')
const TESTFLIGHT_COUNTS: (keyof TestflightCounts)[] = ['installs', 'sessions', 'crashes', 'invites', 'feedback']
const adding = ref(false)
// The source whose setup (webhook details, API example) is open; '' while closed.
const setupFor = ref('')
const setupOpen = computed({ get: () => Boolean(setupFor.value), set: (open) => { if (!open) setupFor.value = '' } })
const setupConnection = computed(() => sources.value.find(c => c.source === setupFor.value))
// The sources HelpBites reads; the rest send to it.
const apple = computed(() => sources.value.some(c => c.source === 'apple'))
const pulled = computed(() => sources.value.filter(c => revenueSource(c.source)?.kind === 'pull'))

const money = (amount: number) => formatMoney(amount, report.value?.currency || 'usd')
// A customer who is also a contact opens in the people list.
const contactLink = (contactId: string) => `/projects/${id}/contacts?contact=${contactId}`
// Net revenue and MRR share the one axis: both are money in the same currency.
const peak = computed(() => Math.max(1, ...(report.value?.months.flatMap(m => [m.net, m.mrr]) || [])))
const mrrLine = computed(() => (report.value?.months || []).map((m, i) => `${i + 0.5},${100 - (m.mrr / peak.value) * 100}`).join(' '))
const hovered = ref(-1)
const point = computed(() => report.value?.months[hovered.value])
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale.value, { month: 'short', year: 'numeric', timeZone: 'UTC' })
// Beside the hovered column, on whichever side has room, so it never covers that month's bar.
function tooltipAt(i: number) {
  const n = report.value?.months.length || 1
  return i < n / 2 ? { left: `calc(${((i + 1) / n) * 100}% + 4px)` } : { right: `calc(${((n - i) / n) * 100}% + 4px)` }
}
const kpis = computed(() => {
  const r = report.value
  if (!r) return []
  return [
    { label: t('projectTools.revenue.netRevenue'), value: money(r.net), hint: r.refunds ? t('projectTools.revenue.grossRefunded', { gross: money(r.gross), refunded: money(r.refunds) }) : t('projectTools.revenue.paymentsTotal', { total: r.payments.toLocaleString() }) },
    { label: 'MRR', value: money(r.mrr), hint: t('projectTools.revenue.perYear', { amount: money(r.arr) }) },
    { label: t('projectTools.revenue.subscribersLabel'), value: String(r.subscribers.active + r.subscribers.pastDue), hint: [r.subscribers.trialing && t('projectTools.revenue.trialing', { count: r.subscribers.trialing }), r.subscribers.pastDue && t('projectTools.revenue.pastDue', { count: r.subscribers.pastDue })].filter(Boolean).join(', ') || t('projectTools.revenue.newChurned', { newSubs: r.newSubscribers, churned: r.churned }) },
    { label: t('projectTools.revenue.payingCustomers'), value: r.customers.toLocaleString(), hint: t('projectTools.revenue.allTime', { amount: money(r.allTimeNet) }) }
  ]
})
// One line per source: when it last ran or heard from the service, and how much it has brought.
function statusText(c: RevenueConnection) {
  const kind = revenueSource(c.source)?.kind
  const { payments, subscriptions } = { payments: c.stats.payments.toLocaleString(), subscriptions: c.stats.subscriptions.toLocaleString() }
  if (c.status === 'running') return t('projectTools.revenue.syncing')
  if (kind === 'push') return c.lastRunAt ? t('projectTools.revenue.lastEvent', { time: logTime(c.lastRunAt), payments }) : t('projectTools.revenue.waitingEvent')
  if (kind === 'manual') return c.lastRunAt ? t('projectTools.revenue.lastSent', { time: logTime(c.lastRunAt), payments, subscriptions }) : t('projectTools.revenue.nothingSent')
  return c.lastRunAt ? t('projectTools.revenue.synced', { time: logTime(c.lastRunAt), payments, subscriptions }) : ''
}
const menu = computed(() => [
  [{ label: t('projectTools.revenue.addSource'), icon: 'i-lucide-plus', onSelect: () => { adding.value = true } }],
  [
    ...pulled.value.map(c => ({ label: t('projectTools.revenue.syncAll', { name: nameOf(c.source) }), icon: 'i-lucide-history', onSelect: () => sync(c.source, true) })),
    ...sources.value.map(c => ({ label: t('projectTools.revenue.disconnect', { name: nameOf(c.source) }), icon: 'i-lucide-unplug', color: 'error' as const, onSelect: () => disconnect(c.source) }))
  ]
])

async function loadSources() {
  sources.value = (await api<{ sources: RevenueConnection[] }>('/admin/revenue/sources', { query: { project: id } })).sources
}
async function loadReport() {
  if (!sources.value.length) { report.value = null; return }
  report.value = (await api<{ report: RevenueReport | null }>('/admin/revenue/report', { query: { project: id, range: range.value } })).report
}
async function loadTestflight() {
  if (!apple.value) { testflight.value = null; testflightError.value = ''; return }
  // Once per visit: the revenue poll above calls load() every few seconds while a sync runs.
  if (testflight.value || testflightError.value || testflightLoading.value) return
  testflightLoading.value = true
  try {
    testflight.value = (await api<{ report: TestflightReport }>('/admin/revenue/testflight', { query: { project: id } })).report
  } catch (e: any) {
    testflightError.value = e?.message || t('projectTools.revenue.testflight.error')
  } finally {
    testflightLoading.value = false
  }
}
async function load() {
  try {
    await loadSources()
    void loadTestflight()
    await loadReport()
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.revenue.loadError'), color: 'error' })
  } finally {
    loading.value = false
  }
}

// A source with something to set up on the other side opens its instructions at once.
async function connected(connection: RevenueConnection) {
  adding.value = false
  await load()
  if (revenueSource(connection.source)?.kind !== 'pull') setupFor.value = connection.source
}

async function sync(source: string, reset: boolean) {
  try {
    const res = await api<{ connection: RevenueConnection }>('/admin/revenue/sync', { method: 'POST', body: { project: id, source, reset } })
    sources.value = sources.value.map(c => (c.source === source ? res.connection : c))
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.revenue.syncError'), color: 'error' })
  }
}

async function disconnect(source: string) {
  if (!window.confirm(t('projectTools.revenue.disconnectConfirm', { name: nameOf(source) }))) return
  try {
    await api('/admin/revenue', { method: 'DELETE', query: { project: id, source } })
    await load()
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.revenue.disconnectError'), color: 'error' })
  }
}

// A running sync fills the numbers in as it goes; a source that pushes shows its newest event.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  load()
  timer = setInterval(() => { if (sources.value.some(c => c.status === 'running') || (sources.value.length && !report.value && !sources.value.some(c => c.lastError))) load() }, 4000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>
