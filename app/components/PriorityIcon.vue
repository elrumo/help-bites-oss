<template>
  <!-- Linear's priority glyphs: bars that fill with the level, and an orange flag for urgent. -->
  <svg viewBox="0 0 14 14" class="size-3.5 shrink-0" aria-hidden="true">
    <template v-if="priority === 'urgent'">
      <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="#f2753a" />
      <path d="M7 3.6v4.1" stroke="white" stroke-width="1.6" stroke-linecap="round" />
      <circle cx="7" cy="10.1" r="0.95" fill="white" />
    </template>
    <g v-else class="text-toned" fill="currentColor">
      <rect v-for="(height, i) in [5, 8, 11]" :key="i" :x="1.5 + i * 4" :y="12.5 - height" width="3" :height="height" rx="1" :opacity="i < level ? 1 : 0.3" />
    </g>
  </svg>
</template>

<script setup lang="ts">
import type { ConversationPriority } from '#shared/support'

const props = defineProps<{ priority: ConversationPriority }>()
const level = computed(() => ({ low: 1, normal: 2, high: 3, urgent: 3 })[props.priority] || 0)
</script>
