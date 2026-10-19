<template>
  <p v-if="text" class="px-4 text-center text-[11px] leading-snug text-stone-500/90 dark:text-stone-400/90">{{ text }}</p>
</template>

<script setup lang="ts">
// A fixed, low-contrast informational line shown on the chat — not a message
// from anyone. Set per project (Project.chatNotice), rendered at the top of a
// new/opened chat.
defineProps<{ text?: string }>()
</script>
