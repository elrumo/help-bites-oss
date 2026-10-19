<template>
  <!-- A lifecycle state the Linear way: a coloured dot and the word, no filled badge. -->
  <span class="inline-flex shrink-0 items-center gap-1.5 text-xs capitalize text-muted">
    <span class="size-1.5 rounded-full" :class="tone" aria-hidden="true" />{{ label || status }}
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{ status: string, label?: string }>()
const tone = computed(() => ({
  active: 'bg-success', ready: 'bg-success', processed: 'bg-success', on: 'bg-success',
  draft: 'bg-warning', outdated: 'bg-warning', pending: 'bg-warning', processing: 'bg-info',
  failed: 'bg-error', error: 'bg-error'
} as Record<string, string>)[props.status] || 'bg-(--ui-text-dimmed)')
</script>
