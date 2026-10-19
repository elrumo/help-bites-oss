<template>
  <!-- Linear's empty view: a quiet glyph, one line on what goes here, and the action that fills it. -->
  <div class="flex flex-col items-center justify-center px-6 py-16 text-center">
    <span class="grid size-12 place-items-center rounded-xl border border-default bg-default text-muted shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <UIcon :name="icon" class="size-5" />
    </span>
    <p class="mt-4 text-[13px] font-medium text-highlighted">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-sm text-[13px] text-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5 flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ icon: string, title: string, description?: string }>()
</script>
