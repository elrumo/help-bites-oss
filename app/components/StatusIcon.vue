<template>
  <!-- Linear's status glyphs: open is an empty ring, pending half full, resolved a filled check, closed a filled cross. -->
  <svg viewBox="0 0 14 14" class="size-3.5 shrink-0" :class="tone" aria-hidden="true">
    <template v-if="category === 'resolved' || category === 'closed'">
      <circle cx="7" cy="7" r="6.25" fill="currentColor" />
      <path v-if="category === 'resolved'" d="M4.4 7.2 6.2 9l3.4-3.8" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <path v-else d="m5 5 4 4m0-4-4 4" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" />
    </template>
    <template v-else>
      <circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path v-if="category === 'pending'" d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
    </template>
  </svg>
</template>

<script setup lang="ts">
import type { StatusCategory } from '#shared/support'

const props = defineProps<{ category: StatusCategory }>()
const tone = computed(() => ({ open: 'text-dimmed', pending: 'text-[#e6a91a]', resolved: 'text-primary-500', closed: 'text-dimmed' })[props.category] || 'text-dimmed')
</script>
