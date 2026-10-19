<template>
  <span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" :class="tone">
    <span class="size-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
    {{ status.label }}
  </span>
</template>

<script setup lang="ts">
import type { FeedbackStatusDefinition } from '#shared/feedback'

const props = defineProps<{ status: FeedbackStatusDefinition }>()

const TONES: Record<string, string> = {
  neutral: 'bg-stone-200/70 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  primary: 'bg-primary-600/10 text-primary-700 dark:text-primary-300',
  info: 'bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
  success: 'bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
  error: 'bg-rose-500/12 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300'
}
const tone = computed(() => TONES[props.status.color] || TONES.neutral)
</script>
