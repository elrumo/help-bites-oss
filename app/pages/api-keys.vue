<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader title="API keys" />
    <div class="min-h-0 flex-1 overflow-y-auto">
      <SettingsApiKeys class="mx-auto max-w-2xl px-6 py-8" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Also a tab of the settings modal; this page keeps old links working.
definePageMeta({ middleware: 'agent' })
</script>
