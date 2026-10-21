<template><div /></template>

<script setup lang="ts">
// Campaigns, sequences and their settings are tabs of the project's Email section now.
definePageMeta({ middleware: 'agent' })
const route = useRoute()
const view = route.query.view === 'sequences' || route.query.view === 'settings' ? route.query.view : 'campaigns'
await navigateTo({ path: `/projects/${route.params.id}/email`, query: { view } }, { replace: true })
</script>
