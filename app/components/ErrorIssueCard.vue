<template>
  <div class="flex items-center gap-3 p-4">
    <button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" aria-haspopup="dialog" @click="emit('open')">
      <UIcon name="i-lucide-bug" :class="issue.level === 'error' || issue.level === 'fatal' ? 'text-error' : 'text-warning'" class="size-4 shrink-0" />
      <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-highlighted">{{ issue.title }}</span><span class="block truncate text-xs text-muted">{{ issue.culprit || $t('errors.unknownLocation') }} · {{ $t('errors.eventCount', issue.count || 1) }}<template v-if="issue.lastSeen"> · {{ $t('errors.lastSeenAt', { time: new Date(issue.lastSeen).toLocaleString() }) }}</template></span></span>
    </button>
    <UBadge v-if="analyzed" color="primary" variant="subtle" size="sm" icon="i-lucide-sparkles" class="shrink-0 rounded-full">{{ $t('errors.analyzed') }}</UBadge>
    <UBadge v-if="showLink" color="neutral" variant="subtle" size="sm" class="shrink-0 rounded-full">{{ issue.linkLabel }}</UBadge>
    <UButton :to="issue.url" target="_blank" color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-up-right" :aria-label="$t('errors.openIn', { provider: issue.providerName })" />
    <UDropdownMenu :items="[statusItems]"><UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-ellipsis" :aria-label="$t('errors.changeStatus')" /></UDropdownMenu>
  </div>
</template>

<script setup lang="ts">
defineProps<{ issue: any, showLink: boolean, analyzed?: boolean }>()
const emit = defineEmits<{ (event: 'status', value: string): void, (event: 'open'): void }>()
const { t } = useI18n()
const statusItems = computed(() => [
  { label: t('errors.status.open'), onSelect: () => emit('status', 'open') },
  { label: t('errors.status.resolve'), onSelect: () => emit('status', 'resolved') },
  { label: t('errors.status.ignore'), onSelect: () => emit('status', 'closed') }
])
</script>
