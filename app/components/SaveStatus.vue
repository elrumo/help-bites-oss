<template>
  <!-- A side panel's save state: an amber dot while a change is on its way, a green one once it has landed. -->
  <span class="inline-flex items-center gap-1.5 text-xs" :class="!saving && saved ? 'text-success' : 'text-muted'" role="status" aria-live="polite">
    <span class="size-1.5 rounded-full" :class="saving ? 'animate-pulse bg-warning' : saved ? 'bg-success' : 'bg-dimmed'" aria-hidden="true" />
    {{ saving ? $t('common.saving') : saved ? $t('common.saved') : idle }}
  </span>
</template>

<script setup lang="ts">
defineProps<{ saving?: boolean, saved?: boolean, idle?: string }>()
</script>
