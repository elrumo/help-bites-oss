<script setup lang="ts">
// Settings is a modal now; this keeps old links (/projects/:id/settings#company) working.
definePageMeta({ middleware: 'agent' })
const route = useRoute()
const id = String(route.params.id)
useProjectSettings().openProjectSettings(id, route.hash.slice(1) || undefined)
await navigateTo(`/projects/${id}/overview`, { replace: true })
</script>

<template><div /></template>
