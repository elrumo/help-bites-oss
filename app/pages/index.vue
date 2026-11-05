<template><div /></template>

<script setup lang="ts">
// "/" on a self-hosted server is the panel: sign in (or set up the first
// operator), and a signed-in operator goes on from the login page. The public
// landing page with pricing belongs to the hosted edition, whose ee/ layer
// puts its own page here.
definePageMeta({ layout: 'bare' })
await navigateTo('/login', { replace: true })
</script>
