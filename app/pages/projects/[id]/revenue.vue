<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.revenue')">
      <template v-if="connection?.connected" #actions>
        <USelect v-model="range" :items="REVENUE_RANGES" value-key="value" size="sm" class="w-40" :aria-label="$t('projectTools.revenue.period')" @update:model-value="loadReport()" />
        <UButton icon="i-lucide-refresh-cw" :label="$t('projectTools.revenue.sync')" size="sm" color="neutral" variant="outline" :loading="connection.status === 'running'" @click="sync(false)" />
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

        <EmptyState v-else-if="!connection?.connected" icon="i-lucide-circle-dollar-sign" :title="$t('projectTools.revenue.connectStripe')" :description="$t('projectTools.revenue.connectDescription')">
          <form class="w-full max-w-md space-y-3 text-left" @submit.prevent="connect">
            <UFormField :label="$t('projectTools.revenue.apiKeyLabel')" :help="$t('projectTools.revenue.apiKeyHelp')">
              <UInput v-model="apiKey" type="password" placeholder="rk_live_…" autocomplete="off" class="w-full" />
            </UFormField>
            <UButton type="submit" :label="$t('projectTools.revenue.connectStripe')" :loading="connecting" :disabled="!apiKey.trim()" />
          </form>
        </EmptyState>

        <template v-else>
          <p class="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <UBadge :label="connection.livemode ? $t('projectTools.revenue.live') : $t('projectTools.revenue.testMode')" :color="connection.livemode ? 'success' : 'warning'" variant="subtle" size="sm" />
            <span>{{ connection.accountName || 'Stripe' }}</span>
            <span v-if="connection.status === 'running'">{{ $t('projectTools.revenue.syncing', { payments: connection.stats.payments.toLocaleString() }) }}</span>
            <span v-else-if="connection.lastRunAt">{{ $t('projectTools.revenue.synced', { time: logTime(connection.lastRunAt), payments: connection.stats.payments.toLocaleString(), subscriptions: connection.stats.subscriptions.toLocaleString() }) }}</span>
          </p>
          <UAlert v-if="connection.lastError" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="$t('projectTools.revenue.syncFailed')" :description="connection.lastError" />

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
              <h2 class="text-xs font-semibold text-muted">{{ $t('projectTools.revenue.netByMonth') }}</h2>
              <ul class="mt-4 flex h-44 items-end gap-1.5" :aria-label="$t('projectTools.revenue.netByMonth')">
                <li v-for="m in report.months" :key="m.month" class="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" :title="$t('projectTools.revenue.monthTitle', { month: m.month, net: money(m.net), payments: m.payments })">
                  <div class="w-full rounded-t bg-primary/70" :style="{ height: `${Math.max(m.net ? 3 : 0, (m.net / peak) * 100)}%` }" />
                  <span class="truncate text-center text-[10px] text-muted">{{ m.month.slice(5) }}</span>
                </li>
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
                    <span class="min-w-0 flex-1 truncate">{{ c.email || c.customerId }}</span>
                    <span class="text-xs text-muted">{{ $t('projectTools.revenue.payments', c.payments) }}</span>
                    <span class="w-24 text-right tabular-nums">{{ money(c.net) }}</span>
                  </li>
                </ul>
              </section>
            </div>

            <section class="space-y-2">
              <h2 class="text-xs font-semibold text-muted">{{ $t('projectTools.revenue.recentPayments') }}</h2>
              <ul class="divide-y divide-default rounded-xl border border-default text-[13px]">
                <li v-for="p in report.recent" :key="p.id" class="flex items-center gap-3 px-3 py-2">
                  <span class="min-w-0 flex-1 truncate">{{ p.email || p.customerId || $t('projectTools.revenue.guest') }}<span v-if="p.description" class="text-muted"> · {{ p.description }}</span></span>
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
        </template>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { REVENUE_RANGES, formatMoney, fromMinor, type RevenueRange, type RevenueReport, type StripeConnection } from '#shared/stripe'
import { logTime } from '~/utils/emailStatus'

definePageMeta({ middleware: 'agent' })
const { api } = useAgent()
const toast = useToast()
const { t } = useI18n()
const id = String(useRoute().params.id)

const connection = ref<StripeConnection | null>(null)
const report = ref<RevenueReport | null>(null)
const range = ref<RevenueRange>('30d')
const loading = ref(true)
const apiKey = ref('')
const connecting = ref(false)

const money = (amount: number) => formatMoney(amount, report.value?.currency || 'usd')
const peak = computed(() => Math.max(1, ...(report.value?.months.map(m => m.net) || [])))
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
const menu = computed(() => [[
  { label: t('projectTools.revenue.syncAll'), icon: 'i-lucide-history', onSelect: () => sync(true) },
  { label: t('projectTools.revenue.disconnectStripe'), icon: 'i-lucide-unplug', color: 'error' as const, onSelect: () => disconnect() }
]])

async function loadConnection() {
  const res = await api<{ connection: StripeConnection }>('/admin/stripe', { query: { project: id } })
  connection.value = res.connection
}
async function loadReport() {
  if (!connection.value?.connected) return
  report.value = (await api<{ report: RevenueReport | null }>('/admin/stripe/report', { query: { project: id, range: range.value } })).report
}
async function load() {
  try {
    await loadConnection()
    await loadReport()
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.revenue.loadError'), color: 'error' })
  } finally {
    loading.value = false
  }
}

async function connect() {
  connecting.value = true
  try {
    connection.value = (await api<{ connection: StripeConnection }>('/admin/stripe/connect', { method: 'POST', body: { project: id, apiKey: apiKey.value } })).connection
    apiKey.value = ''
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.revenue.connectError'), color: 'error' })
  } finally {
    connecting.value = false
  }
}

async function sync(reset: boolean) {
  try {
    connection.value = (await api<{ connection: StripeConnection }>('/admin/stripe/sync', { method: 'POST', body: { project: id, reset } })).connection
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.revenue.syncError'), color: 'error' })
  }
}

async function disconnect() {
  if (!window.confirm(t('projectTools.revenue.disconnectConfirm'))) return
  try {
    await api('/admin/stripe', { method: 'DELETE', query: { project: id } })
    connection.value = null
    report.value = null
    await loadConnection()
  } catch (e: any) {
    toast.add({ title: e?.message || t('projectTools.revenue.disconnectError'), color: 'error' })
  }
}

// A running sync fills the numbers in as it goes.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  load()
  timer = setInterval(() => { if (connection.value?.status === 'running' || (connection.value?.connected && !report.value && !connection.value.lastError)) load() }, 4000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>
