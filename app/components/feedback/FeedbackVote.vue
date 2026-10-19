<template>
  <button
    type="button"
    class="group shrink-0 flex flex-col items-center justify-center rounded-lg border font-semibold tabular-nums select-none transition-[background-color,border-color,color,transform] duration-150 active:scale-95 disabled:active:scale-100"
    :class="[
      size === 'sm' ? 'w-10 h-11 text-xs gap-0' : 'w-12 h-14 text-sm gap-0.5',
      voted
        ? 'bg-primary-600 border-primary-600 text-white shadow-sm shadow-primary-600/25'
        : closed || readonly
          ? 'border-stone-200 dark:border-stone-800 text-stone-400 dark:text-stone-500 cursor-default'
          : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-200 hover:border-primary-600 hover:text-primary-700 dark:hover:text-primary-300'
    ]"
    :aria-pressed="voted"
    :aria-label="readonly ? $t('feedback.voteCount', count) : closed ? $t('feedback.votesClosedAria', count) : voted ? $t('feedback.removeVoteAria', { count }) : $t('feedback.voteAria', { count })"
    :title="closed ? $t('feedback.votingClosed') : undefined"
    :disabled="closed || readonly"
    @click.stop="emit('vote')"
  >
    <UIcon
      :name="closed && !voted && !readonly ? 'i-lucide-check' : 'i-lucide-chevron-up'"
      class="transition-transform duration-200"
      :class="[size === 'sm' ? 'size-3.5' : 'size-4', !closed && !voted && !readonly ? 'group-hover:-translate-y-0.5' : '', bump ? 'animate-vote-pop' : '']"
    />
    <span :key="count" :class="bump ? 'animate-row-in' : ''">{{ count }}</span>
  </button>
</template>

<script setup lang="ts">
// `readonly` shows the tally without offering a vote (operators in the panel).
const props = withDefaults(defineProps<{ count: number, voted?: boolean, closed?: boolean, readonly?: boolean, size?: 'sm' | 'md' }>(), { voted: false, closed: false, readonly: false, size: 'md' })
const emit = defineEmits<{ (e: 'vote'): void }>()

// A little pop when your own vote lands, not on every live update.
const bump = ref(false)
watch(() => props.voted, (now, before) => {
  if (now && !before) {
    bump.value = true
    setTimeout(() => { bump.value = false }, 450)
  }
})
</script>
