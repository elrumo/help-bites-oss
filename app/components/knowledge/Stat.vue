<template>
  <span class="inline-flex items-baseline gap-1 text-[13px]">
    <span class="font-medium tabular-nums" :class="warn ? 'text-warning' : 'text-highlighted'">{{ n }}</span>
    <span class="text-muted">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
defineProps<{ n: number, label: string, warn?: boolean }>()
</script>
