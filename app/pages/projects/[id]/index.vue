<template><div /></template>

<script setup lang="ts">
// The project lands on its Overview by default.
definePageMeta({ middleware: 'agent' })
const route = useRoute()
await navigateTo(`/projects/${route.params.id}/overview`, { replace: true })
</script>
