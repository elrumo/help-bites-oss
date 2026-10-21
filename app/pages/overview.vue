<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :title="$t('nav.overview')">
      <template #actions>
        <USelect v-if="revenue" v-model="range" :items="REVENUE_RANGES" value-key="value" size="sm" class="w-40" :aria-label="$t('overview.period')" @update:model-value="load()" />
        <UTooltip :text="$t('overview.refresh')"><UButton icon="i-lucide-refresh-cw" size="sm" color="neutral" variant="ghost" square class="text-muted" :aria-label="$t('overview.refresh')" :loading="loading" @click="load()" /></UTooltip>
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-5xl space-y-10 px-6 py-8">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />

        <!-- One card per project, in the sidebar's order. -->
        <section class="space-y-3" aria-labelledby="overview-projects">
          <div class="flex items-center gap-2">
            <h2 id="overview-projects" class="text-[15px] font-semibold text-highlighted">{{ $t('nav.projects') }}</h2>
            <span v-if="overview" class="text-xs tabular-nums text-muted">{{ cards.length }}</span>
          </div>
          <div v-if="!overview" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><USkeleton v-for="n in 3" :key="n" class="h-[118px] rounded-xl" /></div>
          <EmptyState v-else-if="!cards.length" icon="i-lucide-boxes" :title="$t('overview.emptyTitle')" :description="$t('overview.emptyDescription')">
            <UButton icon="i-lucide-plus" :label="$t('nav.newProject')" @click="newProjectOpen = true" />
          </EmptyState>
          <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <NuxtLink v-for="card in cards" :key="card.id" :to="`/projects/${card.id}/overview`" class="flex flex-col gap-4 rounded-xl border border-default bg-default p-4 transition-colors hover:bg-elevated/60">
              <div class="flex min-w-0 items-center gap-2.5">
                <ProjectDot tile :project-id="card.id" :accent="card.accent" :name="card.name" :icon-url="card.iconUrl" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[13px] font-medium text-highlighted">{{ card.name }}</p>
                  <p class="truncate text-xs text-muted">{{ card.host || $t('projectTools.projectList.noSiteUrl') }}</p>
                </div>
                <span v-if="card.errors" class="flex shrink-0 items-center gap-1 text-xs tabular-nums text-warning" :title="$t('overview.openErrorsCount', card.errors)">
                  <UIcon name="i-lucide-bug" class="size-3.5" />{{ card.errors }}<span class="sr-only">{{ $t('overview.openErrorsCount', card.errors) }}</span>
                </span>
              </div>
              <dl class="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-4">
                <div class="min-w-0">
                  <dt class="text-xs text-muted">{{ $t('overview.unread') }}</dt>
                  <dd class="mt-0.5 flex items-center gap-1.5 text-lg font-semibold tabular-nums text-highlighted"><span v-if="card.unread" class="size-1.5 shrink-0 rounded-full bg-primary-500" aria-hidden="true" />{{ compactCount(card.unread) }}</dd>
                </div>
                <div class="min-w-0">
                  <dt class="text-xs text-muted">{{ $t('overview.open') }}</dt>
                  <dd class="mt-0.5 text-lg font-semibold tabular-nums text-highlighted">{{ compactCount(card.open) }}</dd>
                </div>
                <div v-if="revenue" class="min-w-0">
                  <dt class="truncate text-xs text-muted">{{ $t('overview.revenue') }}</dt>
                  <dd v-if="card.revenue" class="mt-0.5 truncate text-lg font-semibold tabular-nums text-highlighted" :title="formatMoney(card.revenue.net, card.revenue.currency)">{{ compactMoney(card.revenue.net, card.revenue.currency) }}</dd>
                  <dd v-else class="mt-0.5 text-lg font-semibold text-dimmed" :title="$t('overview.noStripe')">—<span class="sr-only">{{ $t('overview.noStripe') }}</span></dd>
                </div>
              </dl>
            </NuxtLink>
            <button type="button" class="flex min-h-[118px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-accented text-[13px] font-medium text-muted transition-colors hover:bg-elevated/60 hover:text-default" @click="newProjectOpen = true">
              <UIcon name="i-lucide-plus" class="size-4" />{{ $t('nav.newProject') }}
            </button>
          </div>
        </section>

        <section v-if="overview && cards.length" class="space-y-3" aria-labelledby="overview-glance">
          <h2 id="overview-glance" class="text-[15px] font-semibold text-highlighted">{{ $t('overview.atAGlance') }}</h2>
          <div class="grid grid-cols-2 gap-3" :class="revenue ? 'lg:grid-cols-4' : 'lg:grid-cols-3'">
            <component :is="tile.to ? NuxtLink : 'div'" v-for="tile in tiles" :key="tile.key" :to="tile.to" class="min-w-0 rounded-xl border border-default bg-default px-4 py-3" :class="tile.to ? 'transition-colors hover:bg-elevated/60' : ''">
              <p class="truncate text-xs text-muted">{{ tile.label }}</p>
              <p class="mt-1 truncate text-2xl font-semibold tabular-nums text-highlighted">{{ tile.value }}</p>
              <p v-if="tile.change !== undefined && tile.change !== null" class="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted">
                <span class="flex shrink-0 items-center gap-0.5 font-medium" :class="tile.change >= 0 ? 'text-success' : 'text-error'">
                  <UIcon :name="tile.change >= 0 ? 'i-lucide-arrow-up-right' : 'i-lucide-arrow-down-right'" class="size-3.5" />{{ percent(Math.abs(tile.change)) }}
                </span>
                <span>{{ $t(`overview.previous.${range}`) }}</span>
              </p>
              <p v-else-if="tile.hint" class="mt-0.5 truncate text-xs text-muted">{{ tile.hint }}</p>
            </component>
          </div>
        </section>

        <div v-if="overview && cards.length" class="grid items-start gap-x-6 gap-y-10" :class="revenue ? 'lg:grid-cols-2' : ''">
          <section class="space-y-3" aria-labelledby="overview-unread">
            <div class="flex items-center gap-2">
              <h2 id="overview-unread" class="text-[15px] font-semibold text-highlighted">{{ $t('overview.unreadMessages') }}</h2>
              <NuxtLink to="/inbox" class="ml-auto text-xs font-medium text-muted transition-colors hover:text-highlighted">{{ $t('overview.openInbox') }}</NuxtLink>
            </div>
            <div v-if="overview.unread.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
              <NuxtLink v-for="item in overview.unread" :key="item.conversationId" :to="`/inbox?c=${item.conversationId}`" class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/60">
                <span class="relative shrink-0">
                  <span class="grid size-7 place-items-center rounded-full bg-elevated text-[11px] font-semibold text-toned" aria-hidden="true">{{ initials(who(item)) }}</span>
                  <ProjectDot :project-id="item.projectId" :accent="projectOf(item.projectId)?.theme?.accent" :name="projectOf(item.projectId)?.name" :icon-url="projectOf(item.projectId)?.iconUrl" class="absolute -bottom-0.5 -right-0.5 size-2" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center justify-between gap-2">
                    <span class="truncate text-[13px] font-semibold text-highlighted">{{ who(item) }}</span>
                    <span class="shrink-0 text-xs text-muted">{{ logTime(item.at) }}</span>
                  </span>
                  <span class="mt-0.5 block truncate text-xs text-muted">
                    <span class="mr-1.5 font-medium text-toned">{{ projectOf(item.projectId)?.name }}</span>{{ item.preview || item.subject }}
                  </span>
                </span>
                <span class="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary-500 px-1.5 text-[11px] font-semibold tabular-nums text-white" :title="$t('overview.unreadMessagesCount', item.unread)">{{ item.unread }}</span>
              </NuxtLink>
            </div>
            <EmptyState v-else icon="i-lucide-inbox" :title="$t('overview.inboxZero')" :description="$t('overview.inboxZeroDescription')" />
          </section>

          <section v-if="revenue" class="space-y-3" aria-labelledby="overview-revenue">
            <div class="flex items-center gap-2">
              <h2 id="overview-revenue" class="text-[15px] font-semibold text-highlighted">{{ $t('overview.revenueByProject') }}</h2>
              <span class="ml-auto text-xs text-muted">{{ rangeLabel }}</span>
            </div>

            <EmptyState v-if="!revenue.connected" icon="i-lucide-circle-dollar-sign" :title="$t('overview.noRevenueTitle')" :description="$t('overview.noRevenueDescription')">
              <UButton :to="`/projects/${cards[0]!.id}/revenue`" :label="$t('overview.connectStripe')" color="neutral" variant="outline" />
            </EmptyState>
            <EmptyState v-else-if="!top" icon="i-lucide-hourglass" :title="$t('overview.waitingTitle')" :description="$t('overview.waitingDescription')" />
            <template v-else>
              <!-- One series, so no legend: the heading names it. Hover or focus a month to read it. -->
              <div class="rounded-xl border border-default p-4">
                <div class="flex items-baseline gap-3">
                  <h3 class="text-xs font-semibold text-muted">{{ $t('overview.netByMonth') }}</h3>
                  <p class="ml-auto truncate text-xs text-muted" aria-live="polite">{{ monthName(focus!.month, true) }} <span class="font-medium tabular-nums text-highlighted">{{ money(focus!.net) }}</span></p>
                </div>
                <ul class="mt-4 flex h-28 items-end gap-0.5 border-b border-default" :aria-label="$t('overview.netByMonth')">
                  <li
                    v-for="m in top.months"
                    :key="m.month"
                    tabindex="0"
                    class="group flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none"
                    :aria-label="`${monthName(m.month, true)}: ${money(m.net)}`"
                    @mouseenter="hovered = m.month"
                    @mouseleave="hovered = ''"
                    @focus="hovered = m.month"
                    @blur="hovered = ''"
                  >
                    <div class="w-full max-w-6 rounded-t-[4px] transition-colors group-focus-visible:ring-2 group-focus-visible:ring-primary-500/40" :class="m.month === focus!.month ? 'bg-primary-500' : 'bg-primary-500/55'" :style="{ height: `${m.net ? Math.max(3, (m.net / peak) * 100) : 0}%` }" />
                  </li>
                </ul>
                <div class="mt-1.5 flex gap-0.5" aria-hidden="true">
                  <span v-for="m in top.months" :key="m.month" class="min-w-0 flex-1 truncate text-center text-[10px] text-muted">{{ monthName(m.month) }}</span>
                </div>
              </div>

              <!-- Ranked by net, each bar its share of revenue in that currency. -->
              <ul class="divide-y divide-default overflow-hidden rounded-xl border border-default">
                <li v-for="row in byProject" :key="row.projectId">
                  <NuxtLink :to="`/projects/${row.projectId}/revenue`" class="block space-y-2 px-4 py-3 transition-colors hover:bg-elevated/60" :title="$t('overview.share', { share: percent(row.share), currency: row.currency.toUpperCase() })">
                    <span class="flex items-center gap-2.5 text-[13px]">
                      <ProjectDot tile :project-id="row.projectId" :accent="projectOf(row.projectId)?.theme?.accent" :name="projectOf(row.projectId)?.name" :icon-url="projectOf(row.projectId)?.iconUrl" />
                      <span class="min-w-0 flex-1 truncate font-medium text-highlighted">{{ projectOf(row.projectId)?.name || row.projectId }}</span>
                      <span v-if="row.mrr" class="shrink-0 text-xs tabular-nums text-muted">{{ $t('overview.mrrShort', { amount: formatMoney(row.mrr, row.currency) }) }}</span>
                      <span class="w-24 shrink-0 text-right font-medium tabular-nums text-highlighted">{{ formatMoney(row.net, row.currency) }}</span>
                    </span>
                    <span class="block h-1.5 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
                      <span class="block h-full rounded-full" :style="{ width: `${row.share * 100}%`, backgroundColor: row.color }" />
                    </span>
                  </NuxtLink>
                </li>
              </ul>
              <p v-if="others.length" class="text-xs text-muted">{{ $t('overview.totalsIn', { currency: top.currency.toUpperCase(), others: others.map(c => formatMoney(c.net, c.currency)).join(', ') }) }}</p>
              <p v-if="unconnected" class="text-xs text-muted">{{ $t('overview.withoutStripe', unconnected) }}</p>
            </template>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { REVENUE_RANGES, formatMoney, type RevenueRange } from '#shared/stripe'
import type { OverviewUnread, WorkspaceOverview } from '#shared/overview'
import type { SupportEvent } from '~~/server/utils/events'
import { compactCount, logTime } from '~/utils/emailStatus'
import { projectColor } from '~/utils/projectColor'

definePageMeta({ middleware: 'agent' })

const NuxtLink = resolveComponent('NuxtLink')
const { api, projects, loadProjects, token } = useAgent()
const { t } = useI18n()
const newProjectOpen = useState('new-project-open', () => false)
// The sidebar's inbox badge, which the inbox page keeps once it has been opened.
const totalUnread = useState<number>('inbox-total-unread', () => 0)

const overview = ref<WorkspaceOverview | null>(null)
const range = ref<RevenueRange>('30d')
const loading = ref(false)
const error = ref('')
const hovered = ref('')

const revenue = computed(() => overview.value?.revenue || null)
const top = computed(() => revenue.value?.totals[0] || null)
const others = computed(() => revenue.value?.totals.slice(1).filter(c => c.net > 0) || [])
const rangeLabel = computed(() => REVENUE_RANGES.find(r => r.value === range.value)?.label || '')
const projectOf = (id: string) => projects.value.find(p => p.id === id)

function hostOf(url: string) {
  try { return url ? new URL(url).host : '' } catch { return url }
}

// The overview's numbers on the sidebar's projects (names, colours and logos come from there).
const cards = computed(() => (overview.value?.projects || []).map((stats) => {
  const project = projectOf(stats.id)
  return { ...stats, name: project?.name || stats.name, accent: project?.theme?.accent, iconUrl: project?.iconUrl, host: hostOf(project?.siteUrl || ''), revenue: revenue.value?.projects.find(r => r.projectId === stats.id) || null }
}))
const unconnected = computed(() => Math.max(0, cards.value.length - (revenue.value?.connected || 0)))

const money = (amount: number) => formatMoney(amount, top.value?.currency || 'usd')
// Cards are narrow: "$3,980", and "$12.4K" from ten thousand up (the full amount is in the title).
function compactMoney(amount: number, currency: string) {
  try {
    const compact = Math.abs(amount) >= 10_000
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), currencyDisplay: 'narrowSymbol', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : amount % 1 === 0 ? 0 : 2 }).format(amount)
  } catch {
    return formatMoney(amount, currency)
  }
}
const percent = (fraction: number) => new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: fraction < 0.1 && fraction > 0 ? 1 : 0 }).format(fraction)

const tiles = computed(() => {
  const totals = overview.value?.totals
  if (!totals) return []
  const list: { key: string, label: string, value: string, hint?: string, change?: number | null, to?: string }[] = [
    { key: 'unread', label: t('overview.unreadConversations'), value: compactCount(totals.unread), hint: t('overview.unreadMessagesCount', totals.unreadMessages), to: '/inbox' },
    { key: 'open', label: t('overview.openConversations'), value: compactCount(totals.open), to: '/inbox' }
  ]
  if (!revenue.value) return [...list, { key: 'errors', label: t('overview.openErrors'), value: compactCount(totals.errors) }]
  const total = top.value
  return [
    ...list,
    { key: 'net', label: t('overview.netRevenue'), value: total ? money(total.net) : '—', hint: total ? rangeLabel.value : t('overview.noStripe'), change: total?.change },
    { key: 'mrr', label: 'MRR', value: total ? money(total.mrr) : '—', hint: total ? t('overview.subscribers', total.subscribers) : t('overview.noStripe') }
  ]
})

// The chart reads out the month under the pointer, else this month.
const peak = computed(() => Math.max(1, ...(top.value?.months.map(m => m.net) || [])))
const focus = computed(() => top.value?.months.find(m => m.month === hovered.value) || top.value?.months.at(-1) || null)
function monthName(month: string, withYear = false) {
  const [year, index] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, index! - 1, 1)).toLocaleDateString(undefined, { month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
}

const byProject = computed(() => (revenue.value?.projects || []).map((row) => {
  const currencyTotal = revenue.value?.totals.find(c => c.currency === row.currency)?.net || 0
  return { ...row, share: currencyTotal > 0 ? row.net / currencyTotal : 0, color: projectOf(row.projectId)?.theme?.accent || projectColor(row.projectId) }
}))

function who(item: OverviewUnread) { return item.name || item.email || item.subject || t('inbox.unknownCustomer') }
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    overview.value = await api<WorkspaceOverview>('/admin/overview', { query: { range: range.value } })
    totalUnread.value = overview.value.totals.unreadMessages
  } catch (e: any) {
    error.value = e?.message || t('overview.loadError')
  } finally {
    loading.value = false
  }
}

// New messages move the counts and the unread list; a burst reloads once.
let pending: ReturnType<typeof setTimeout> | undefined
function reloadSoon() {
  clearTimeout(pending)
  pending = setTimeout(load, 1500)
}
useEventStream(computed(() => '/v1/admin/events'), token, (event: SupportEvent) => {
  if (event.type === 'message.created' || event.type === 'conversation.updated' || event.type === 'conversation.deleted') reloadSoon()
}, reloadSoon)
onBeforeUnmount(() => clearTimeout(pending))

onMounted(() => {
  loadProjects().catch(() => {})
  load()
})
</script>
