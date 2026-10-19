<template>
  <EmailLogView v-if="view === 'log'" />
  <EmailComponents v-else-if="view === 'components'" />
  <EmailSuppressions v-else-if="view === 'suppressions'" />
  <EmailLibrary v-else />
</template>

<script setup lang="ts">
import EmailLibrary from '~/components/email/EmailLibrary.vue'
import EmailComponents from '~/components/email/EmailComponents.vue'
import EmailLogView from '~/components/email/EmailLogView.vue'
import EmailSuppressions from '~/components/email/EmailSuppressions.vue'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const view = computed(() => String(route.query.view || 'log'))
useHead({ title: () => (view.value === 'suppressions' ? 'Suppressed addresses' : view.value === 'components' ? 'Email components' : view.value === 'templates' ? 'Email templates' : 'Email log') })
</script>
