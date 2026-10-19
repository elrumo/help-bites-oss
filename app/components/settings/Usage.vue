<template>
  <div class="space-y-6">
    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 4" :key="i" class="h-12" /></div>
    <template v-else-if="snapshot">
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-[15px] font-semibold text-highlighted">{{ snapshot.plan.name }} plan</p>
          <p class="mt-1 text-[13px] text-muted">Monthly counts start over on the 1st, and daily ones at midnight (UTC).</p>
        </div>
        <UButton v-if="upgrade" label="Upgrade" size="sm" @click="upgrade?.()" />
      </div>

      <div v-if="rows.length" class="space-y-2">
        <p class="section-label">Usage</p>
        <ul class="divide-y divide-default overflow-hidden rounded-xl border border-default">
          <li v-for="row in rows" :key="row.metric" class="space-y-2 px-4 py-3">
            <div class="flex items-center gap-2">
              <span class="min-w-0 truncate text-[13px] font-medium text-highlighted">{{ row.label }}</span>
              <UTooltip v-if="row.soft" text="Counted, but going past it never stops anything">
                <UBadge size="xs" color="neutral" variant="subtle">Soft</UBadge>
              </UTooltip>
              <span class="ml-auto shrink-0 text-xs tabular-nums text-muted">{{ row.used }} / {{ row.limit }}</span>
            </div>
            <UProgress :model-value="row.percent" :max="100" size="2xs" :color="row.percent >= 100 && !row.soft ? 'error' : row.percent >= 80 ? 'warning' : 'primary'" />
          </li>
        </ul>
      </div>

      <div class="space-y-2">
        <p class="section-label">Included</p>
        <ul class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <li v-for="item in included" :key="item.label" class="flex items-center gap-2 text-[13px]" :class="item.on ? 'text-default' : 'text-muted'">
            <UIcon :name="item.on ? 'i-lucide-check' : 'i-lucide-x'" class="size-4 shrink-0" :class="item.on ? 'text-primary' : 'text-dimmed'" />
            <span class="min-w-0">{{ item.label }}</span>
          </li>
        </ul>
      </div>
    </template>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { COUNTERS, FEATURE_LABELS, FEATURES, formatBytes, GAUGES, METRIC_LABELS, type Metric } from '#shared/entitlements'
import type { UsageSnapshot } from '~~/server/utils/usage'

// The workspace's plan: what it has used against each limit, and which
// features it includes. Only shown when the plan has limits at all.
const { api } = useAgent()
const { upgrade } = editionUi()
const snapshot = ref<UsageSnapshot | null>(null)
const loading = ref(true)
const error = ref('')

const amount = (metric: Metric, value: number) => metric === 'storageBytes' ? formatBytes(value) : value.toLocaleString('en-US')

const rows = computed(() => {
  const s = snapshot.value
  if (!s) return []
  return [...COUNTERS, ...GAUGES].flatMap((metric) => {
    const limit = s.limits[metric]
    if (limit === null) return []
    const used = s.usage[metric] || 0
    const label = metric === 'storageBytes' ? 'Storage' : METRIC_LABELS[metric].many.replace(/^./, c => c.toUpperCase())
    return [{ metric, label, used: amount(metric, used), limit: amount(metric, limit), percent: limit ? Math.min(100, Math.round(used / limit * 100)) : 100, soft: !!s.soft[metric] }]
  })
})

const included = computed(() => {
  const s = snapshot.value
  if (!s) return []
  return [
    ...FEATURES.map(feature => ({ label: FEATURE_LABELS[feature], on: s.features[feature] })),
    ...(s.apiPerMinute !== null ? [{ label: `Admin API: ${s.apiPerMinute.toLocaleString('en-US')} requests a minute`, on: true }] : []),
    ...(s.emailLogDays !== null ? [{ label: `Email log kept for ${s.emailLogDays} days`, on: true }] : [])
  ]
})

onMounted(async () => {
  try {
    snapshot.value = await api<UsageSnapshot>('/admin/usage')
  } catch (e: any) {
    error.value = e?.message || 'Could not load the plan\'s usage'
  }
  loading.value = false
})
</script>
