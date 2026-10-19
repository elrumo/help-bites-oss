<template><div /></template>

<script setup lang="ts">
// The landing page's "Try the demo": the panel with sample data, no account,
// nothing saved. A signed-in operator already has the real thing.
definePageMeta({ layout: 'bare' })
const { token, setDemo } = useAgent()
if (!token.value) setDemo(true)
await navigateTo('/inbox', { replace: true })
</script>
