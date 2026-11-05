<template>
  <div class="space-y-6">
    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 4" :key="i" class="h-12" /></div>
    <template v-else-if="snapshot && !snapshot.unlimited">
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-[15px] font-semibold text-highlighted">{{ $t('workspaceSettings.usage.planName', { name: snapshot.plan.name }) }}</p>
          <p class="mt-1 text-[13px] text-muted">{{ $t('workspaceSettings.usage.resetNote') }}</p>
        </div>
        <UButton v-if="upgrade" :label="$t('workspaceSettings.upgrade')" size="sm" @click="upgrade?.()" />
      </div>

      <div v-if="rows.length" class="space-y-2">
        <p class="section-label">{{ $t('workspaceSettings.usage.usage') }}</p>
        <ul class="divide-y divide-default overflow-hidden rounded-xl border border-default">
          <li v-for="row in rows" :key="row.metric" class="space-y-2 px-4 py-3">
            <div class="flex items-center gap-2">
              <span class="min-w-0 truncate text-[13px] font-medium text-highlighted">{{ row.label }}</span>
              <UTooltip v-if="row.soft" :text="$t('workspaceSettings.usage.softTooltip')">
                <UBadge size="xs" color="neutral" variant="subtle">{{ $t('workspaceSettings.usage.soft') }}</UBadge>
              </UTooltip>
              <span class="ml-auto shrink-0 text-xs tabular-nums text-muted">{{ row.used }} / {{ row.limit }}</span>
            </div>
            <UProgress :model-value="row.percent" :max="100" size="2xs" :color="row.full && !row.soft ? 'error' : row.percent >= 80 ? 'warning' : 'primary'" />
            <p class="text-xs tabular-nums" :class="row.full && !row.soft ? 'text-error' : 'text-muted'">{{ row.note }}</p>
          </li>
        </ul>
      </div>
    </template>

    <!-- Where storage goes, on every edition: read from the bucket, so it loads on its own. -->
    <div class="space-y-4">
      <div class="flex items-baseline gap-2">
        <p class="section-label">{{ $t('workspaceSettings.usage.storage') }}</p>
        <p v-if="storage?.files" class="ml-auto text-xs tabular-nums text-muted">{{ $t('workspaceSettings.usage.storageSummary', { size: formatBytes(storage.bytes), count: storage.files.toLocaleString('en-US') }) }}</p>
      </div>
      <div v-if="storageLoading" class="space-y-2"><USkeleton v-for="i in 3" :key="i" class="h-9" /></div>
      <p v-else-if="storageError" class="text-[13px] text-error">{{ storageError }}</p>
      <EmptyState v-else-if="!storage?.files" icon="i-lucide-hard-drive" :title="$t('workspaceSettings.usage.storageEmpty')" class="rounded-xl border border-dashed border-default" />
      <template v-else>
        <div class="space-y-2">
          <p class="text-[13px] font-medium text-highlighted">{{ $t('workspaceSettings.usage.byType') }}</p>
          <ul class="space-y-2.5 rounded-xl border border-default px-4 py-3">
            <li v-for="item in storage.types" :key="item.type" class="space-y-1">
              <div class="flex items-baseline gap-2 text-[13px]">
                <span class="min-w-0 truncate text-default">{{ $t(`workspaceSettings.usage.types.${item.type}`) }}</span>
                <span class="ml-auto shrink-0 text-xs tabular-nums text-muted">{{ formatBytes(item.bytes) }} · {{ share(item.bytes) }}%</span>
              </div>
              <div class="h-1 overflow-hidden rounded-full bg-elevated"><div class="h-full rounded-full bg-primary" :style="{ width: `${Math.max(1, share(item.bytes))}%` }" /></div>
            </li>
          </ul>
        </div>

        <div class="space-y-2">
          <p class="text-[13px] font-medium text-highlighted">{{ $t('workspaceSettings.usage.byProject') }}</p>
          <ul class="divide-y divide-default overflow-hidden rounded-xl border border-default">
            <li v-for="p in storage.projects" :key="p.id || 'workspace'" class="space-y-1.5 px-4 py-3">
              <div class="flex items-center gap-2.5">
                <ProjectDot v-if="p.id" tile :project-id="p.id" :accent="projectOf(p.id)?.theme?.accent" :name="p.name" :icon-url="projectOf(p.id)?.iconUrl" class="!size-5 !rounded-md !text-[10px]" />
                <UIcon v-else name="i-lucide-building-2" class="size-5 shrink-0 text-muted" />
                <span class="min-w-0 truncate text-[13px] font-medium text-highlighted">{{ p.id ? p.name : $t('workspaceSettings.usage.shared') }}</span>
                <span class="ml-auto shrink-0 text-xs tabular-nums text-muted">{{ formatBytes(p.bytes) }} · {{ share(p.bytes) }}%</span>
              </div>
              <div class="h-1 overflow-hidden rounded-full bg-elevated"><div class="h-full rounded-full bg-primary" :style="{ width: `${Math.max(1, share(p.bytes))}%` }" /></div>
              <p class="truncate text-xs text-muted">{{ p.id ? topTypes(p.types) : $t('workspaceSettings.usage.sharedHint') }}</p>
            </li>
          </ul>
          <p class="text-xs text-muted">{{ $t('workspaceSettings.usage.storageNote') }}</p>
        </div>
      </template>
    </div>

    <div v-if="snapshot && !snapshot.unlimited" class="space-y-2">
      <p class="section-label">{{ $t('workspaceSettings.usage.included') }}</p>
      <ul class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <li v-for="item in included" :key="item.label" class="flex items-center gap-2 text-[13px]" :class="item.on ? 'text-default' : 'text-muted'">
          <UIcon :name="item.on ? 'i-lucide-check' : 'i-lucide-x'" class="size-4 shrink-0" :class="item.on ? 'text-primary' : 'text-dimmed'" />
          <span class="min-w-0">{{ item.label }}</span>
        </li>
      </ul>
    </div>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { COUNTERS, FEATURE_LABELS, FEATURES, formatBytes, GAUGES, METRIC_LABELS, type Metric, type StorageType } from '#shared/entitlements'
import type { StorageBreakdown, UsageSnapshot } from '~~/server/utils/usage'

// The workspace's plan (cloud): what it has used against each limit, what is
// left, and which features it includes. On every edition: where its storage
// goes, by kind of file and by project.
const { api, projects } = useAgent()
const { upgrade } = editionUi()
const { t } = useI18n()
const snapshot = ref<UsageSnapshot | null>(null)
const loading = ref(true)
const error = ref('')
const storage = ref<StorageBreakdown | null>(null)
const storageLoading = ref(true)
const storageError = ref('')

const amount = (metric: Metric, value: number) => metric === 'storageBytes' ? formatBytes(value) : value.toLocaleString('en-US')

const rows = computed(() => {
  const s = snapshot.value
  if (!s) return []
  return [...COUNTERS, ...GAUGES].flatMap((metric) => {
    const limit = s.limits[metric]
    if (limit === null) return []
    const used = s.usage[metric] || 0
    const soft = !!s.soft[metric]
    const full = used >= limit
    const label = metric === 'storageBytes' ? t('workspaceSettings.usage.storage') : METRIC_LABELS[metric].many.replace(/^./, c => c.toUpperCase())
    const note = used > limit && soft
      ? t('workspaceSettings.usage.over', { amount: amount(metric, used - limit) })
      : full ? t('workspaceSettings.usage.limitReached') : t('workspaceSettings.usage.left', { amount: amount(metric, limit - used) })
    return [{ metric, label, used: amount(metric, used), limit: amount(metric, limit), percent: limit ? Math.min(100, Math.round(used / limit * 100)) : 100, soft, full, note }]
  })
})

const included = computed(() => {
  const s = snapshot.value
  if (!s) return []
  return [
    ...FEATURES.map(feature => ({ label: FEATURE_LABELS[feature], on: s.features[feature] })),
    ...(s.apiPerMinute !== null ? [{ label: t('workspaceSettings.usage.apiPerMinute', { count: s.apiPerMinute.toLocaleString('en-US') }), on: true }] : []),
    ...(s.emailLogDays !== null ? [{ label: t('workspaceSettings.usage.emailLog', { count: s.emailLogDays }), on: true }] : [])
  ]
})

const projectOf = (id: string) => projects.value.find(p => p.id === id)
const share = (bytes: number) => storage.value?.bytes ? Math.round(bytes / storage.value.bytes * 100) : 0
const topTypes = (types: Partial<Record<StorageType, number>>) => Object.entries(types)
  .sort((a, b) => b[1]! - a[1]!).slice(0, 3)
  .map(([type, bytes]) => `${t(`workspaceSettings.usage.types.${type}`)} ${formatBytes(bytes!)}`).join(' · ') || '—'

onMounted(() => {
  api<UsageSnapshot>('/admin/usage')
    .then((result) => { snapshot.value = result })
    .catch((e: any) => { error.value = e?.message || t('workspaceSettings.usage.loadFailed') })
    .finally(() => { loading.value = false })
  api<StorageBreakdown>('/admin/usage/storage')
    .then((result) => { storage.value = result })
    .catch((e: any) => { storageError.value = e?.message || t('workspaceSettings.usage.storageLoadFailed') })
    .finally(() => { storageLoading.value = false })
})
</script>
