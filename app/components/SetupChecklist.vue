<script setup lang="ts">
/**
 * A project's setup, row by row, judged from what HelpBites has seen (see
 * shared/setup.ts): the widget loading on your site, a signed token arriving,
 * mail that can go out, an assistant that is live, a sync that ran. Each row
 * opens the page that fixes it.
 */
import type { ProjectSetup, SetupState } from '#shared/setup'

const props = defineProps<{ projectId: string, setup: ProjectSetup }>()

const tones: Record<SetupState, { icon: string, color: string }> = {
  done: { icon: 'i-lucide-circle-check', color: 'text-success' },
  todo: { icon: 'i-lucide-circle', color: 'text-dimmed' },
  attention: { icon: 'i-lucide-triangle-alert', color: 'text-warning' }
}
const { t, d } = useI18n()
const link = (section: string) => `/projects/${props.projectId}/${section}`
// What the reason is about, in words: a time for a widget last seen, a count or a name or an error otherwise.
function words(key: string, reason: string, value: string) {
  const when = /^\d{4}-\d\d-\d\dT/.test(value) ? d(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : value
  return t(`setup.${key}.${reason}`, { value: when }, /^\d+$/.test(value) ? Number(value) : 1)
}
const rows = computed(() => props.setup.items.map(item => ({ ...item, tone: tones[item.state], text: words(item.key, item.reason, item.value) })))
</script>

<template>
  <div class="divide-y divide-default overflow-hidden rounded-xl border border-default">
    <NuxtLink v-for="row in rows" :key="row.key" :to="link(row.section)" class="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-elevated/60">
      <UIcon :name="row.tone.icon" class="size-4 shrink-0" :class="row.tone.color" />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2 text-highlighted">{{ $t(`setup.${row.key}.title`) }}<span v-if="row.optional && row.state !== 'done'" class="text-xs font-normal text-dimmed">{{ $t('setup.optional') }}</span></span>
        <span class="block truncate text-xs text-muted">{{ row.text }}</span>
      </span>
      <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
    </NuxtLink>
  </div>
</template>
