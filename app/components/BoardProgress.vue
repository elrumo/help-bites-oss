<template>
  <span class="inline-flex min-w-0 items-center gap-1.5" :title="$t('board.progressTitle', { done, total })">
    <span class="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-accented" role="progressbar" :aria-valuenow="done" aria-valuemin="0" :aria-valuemax="total">
      <span class="block h-full rounded-full bg-emerald-500 transition-[width]" :style="{ width: total ? `${Math.round((done / total) * 100)}%` : '0%' }" />
    </span>
    <span class="shrink-0 text-[10px] tabular-nums text-muted">{{ done }}/{{ total }}</span>
  </span>
</template>

<script setup lang="ts">
// How far an epic or release is: its cards in a done status over all of its cards.
defineProps<{ done: number, total: number }>()
</script>
