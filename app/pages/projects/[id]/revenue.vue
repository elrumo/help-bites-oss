<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" title="Revenue">
      <template v-if="connection?.connected" #actions>
        <USelect v-model="range" :items="REVENUE_RANGES" value-key="value" size="sm" class="w-40" aria-label="Period" @update:model-value="loadReport()" />
        <UButton icon="i-lucide-refresh-cw" label="Sync" size="sm" color="neutral" variant="outline" :loading="connection.status === 'running'" @click="sync(false)" />
        <UDropdownMenu :items="menu">
          <UButton icon="i-lucide-ellipsis" size="sm" color="neutral" variant="ghost" square aria-label="More" />
        </UDropdownMenu>
      </template>
    </PageHeader>

    <main class="min-h-0 flex-1 overflow-y-auto p-6">
      <div class="mx-auto max-w-5xl space-y-6">
        <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading revenue">
          <USkeleton v-for="n in 4" :key="n" class="h-24 rounded-xl" />
        </div>

        <EmptyState v-else-if="!connection?.connected" icon="i-lucide-circle-dollar-sign" title="Connect Stripe" description="See revenue, subscribers and each person's payments next to their conversations. HelpBites only reads from Stripe.">
          <form class="w-full max-w-md space-y-3 text-left" @submit.prevent="connect">
            <UFormField label="Restricted API key" help="Stripe → Developers → API keys → Create restricted key. Give it read access to Charges, Customers, Subscriptions and Products.">
              <UInput v-model="apiKey" type="password" placeholder="rk_live_…" autocomplete="off" class="w-full" />
            </UFormField>
            <UButton type="submit" label="Connect Stripe" :loading="connecting" :disabled="!apiKey.trim()" />
          </form>
        </EmptyState>

        <template v-else>
          <p class="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <UBadge :label="connection.livemode ? 'Live' : 'Test mode'" :color="connection.livemode ? 'success' : 'warning'" variant="subtle" size="sm" />
            <span>{{ connection.accountName || 'Stripe' }}</span>
            <span v-if="connection.status === 'running'">· syncing… {{ connection.stats.payments.toLocaleString() }} payments so far</span>
            <span v-else-if="connection.lastRunAt">· synced {{ logTime(connection.lastRunAt) }}, {{ connection.stats.payments.toLocaleString() }} payments, {{ connection.stats.subscriptions.toLocaleString() }} subscriptions</span>
          </p>
          <UAlert v-if="connection.lastError" color="error" variant="subtle" icon="i-lucide-triangle-alert" title="The last sync failed" :description="connection.lastError" />

          <EmptyState v-if="!report" icon="i-lucide-hourglass" title="Waiting for the first sync" description="Payments show up here as soon as the first stretch has been read." />
          <template v-else>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div v-for="kpi in kpis" :key="kpi.label" class="rounded-xl border border-default p-4">
                <p class="text-xs text-muted">{{ kpi.label }}</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums text-highlighted">{{ kpi.value }}</p>
                <p v-if="kpi.hint" class="mt-0.5 text-xs text-muted">{{ kpi.hint }}</p>
              </div>
            </div>

            <section class="rounded-xl border border-default p-4">
              <h2 class="text-xs font-semibold text-muted">Net revenue by month</h2>
              <ul class="mt-4 flex h-44 items-end gap-1.5" aria-label="Net revenue by month">
                <li v-for="m in report.months" :key="m.month" class="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" :title="`${m.month}: ${money(m.net)} from ${m.payments} payments`">
                  <div class="w-full rounded-t bg-primary/70" :style="{ height: `${Math.max(m.net ? 3 : 0, (m.net / peak) * 100)}%` }" />
                  <span class="truncate text-center text-[10px] text-muted">{{ m.month.slice(5) }}</span>
                </li>
              </ul>
            </section>

            <div class="grid gap-6 lg:grid-cols-2">
              <section class="space-y-2">
                <h2 class="text-xs font-semibold text-muted">Plans</h2>
                <p v-if="!report.plans.length" class="text-xs text-dimmed">No paying subscribers.</p>
                <ul v-else class="divide-y divide-default rounded-xl border border-default text-[13px]">
                  <li v-for="p in report.plans" :key="p.plan" class="flex items-center gap-3 px-3 py-2">
                    <span class="min-w-0 flex-1 truncate">{{ p.plan }}</span>
                    <span class="text-xs text-muted">{{ p.subscribers }} subscriber{{ p.subscribers === 1 ? '' : 's' }}</span>
                    <span class="w-24 text-right tabular-nums">{{ money(p.mrr) }}/mo</span>
                  </li>
                </ul>
              </section>
              <section class="space-y-2">
                <h2 class="text-xs font-semibold text-muted">Top customers</h2>
                <p v-if="!report.topCustomers.length" class="text-xs text-dimmed">No payments yet.</p>
                <ul v-else class="divide-y divide-default rounded-xl border border-default text-[13px]">
                  <li v-for="c in report.topCustomers" :key="c.customerId" class="flex items-center gap-3 px-3 py-2">
                    <span class="min-w-0 flex-1 truncate">{{ c.email || c.customerId }}</span>
                    <span class="text-xs text-muted">{{ c.payments }} payment{{ c.payments === 1 ? '' : 's' }}</span>
                    <span class="w-24 text-right tabular-nums">{{ money(c.net) }}</span>
                  </li>
                </ul>
              </section>
            </div>

            <section class="space-y-2">
              <h2 class="text-xs font-semibold text-muted">Recent payments</h2>
              <ul class="divide-y divide-default rounded-xl border border-default text-[13px]">
                <li v-for="p in report.recent" :key="p.id" class="flex items-center gap-3 px-3 py-2">
                  <span class="min-w-0 flex-1 truncate">{{ p.email || p.customerId || 'Guest' }}<span v-if="p.description" class="text-muted"> · {{ p.description }}</span></span>
                  <UBadge v-if="p.status !== 'succeeded'" :label="p.status" color="error" variant="subtle" size="sm" />
                  <UBadge v-else-if="p.refunded" :label="p.refunded >= p.amount ? 'Refunded' : 'Part refunded'" color="neutral" variant="subtle" size="sm" />
                  <span class="w-24 text-right tabular-nums">{{ formatMoney(fromMinor(p.amount, p.currency), p.currency) }}</span>
                  <span class="w-14 text-right text-xs text-muted">{{ logTime(p.paidAt) }}</span>
                </li>
                <li v-if="!report.recent.length" class="px-3 py-6 text-center text-muted">No payments yet.</li>
              </ul>
            </section>
            <p v-if="report.otherCurrencies.length" class="text-xs text-muted">Totals are in {{ report.currency.toUpperCase() }}. Not included: {{ report.otherCurrencies.map(c => formatMoney(c.net, c.currency)).join(', ') }}.</p>
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
    { label: 'Net revenue', value: money(r.net), hint: r.refunds ? `${money(r.gross)} gross, ${money(r.refunds)} refunded` : `${r.payments.toLocaleString()} payments` },
    { label: 'MRR', value: money(r.mrr), hint: `${money(r.arr)} a year` },
    { label: 'Subscribers', value: String(r.subscribers.active + r.subscribers.pastDue), hint: [r.subscribers.trialing && `${r.subscribers.trialing} trialing`, r.subscribers.pastDue && `${r.subscribers.pastDue} past due`].filter(Boolean).join(', ') || `${r.newSubscribers} new, ${r.churned} canceled in this period` },
    { label: 'Paying customers', value: r.customers.toLocaleString(), hint: `${money(r.allTimeNet)} all time` }
  ]
})
const menu = [[
  { label: 'Sync everything again', icon: 'i-lucide-history', onSelect: () => sync(true) },
  { label: 'Disconnect Stripe', icon: 'i-lucide-unplug', color: 'error' as const, onSelect: () => disconnect() }
]]

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
    toast.add({ title: e?.message || 'Could not load revenue', color: 'error' })
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
    toast.add({ title: e?.message || 'Could not connect Stripe', color: 'error' })
  } finally {
    connecting.value = false
  }
}

async function sync(reset: boolean) {
  try {
    connection.value = (await api<{ connection: StripeConnection }>('/admin/stripe/sync', { method: 'POST', body: { project: id, reset } })).connection
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not start the sync', color: 'error' })
  }
}

async function disconnect() {
  if (!window.confirm('Disconnect Stripe? The key and the payments synced from Stripe are forgotten. Contacts keep their Stripe attributes.')) return
  try {
    await api('/admin/stripe', { method: 'DELETE', query: { project: id } })
    connection.value = null
    report.value = null
    await loadConnection()
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not disconnect', color: 'error' })
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
