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
const { t } = useI18n()
const view = computed(() => String(route.query.view || 'log'))
useHead({ title: () => (view.value === 'suppressions' ? t('emailLibrary.page.suppressed') : view.value === 'components' ? t('emailLibrary.page.components') : view.value === 'templates' ? t('layout.emailTemplates') : t('layout.emailLog')) })
</script>
