<template>
  <template v-if="project">
    <EmailLogView v-if="view === 'log'" :key="`log-${project.id}`" :project="project" />
    <EmailComponents v-else-if="view === 'components'" :key="`components-${project.id}`" :project="project" />
    <EmailSuppressions v-else-if="view === 'suppressions'" :key="`suppressions-${project.id}`" :project="project" />
    <EmailLibrary v-else :key="project.id" :project="project" />
  </template>
</template>

<script setup lang="ts">
import EmailLibrary from '~/components/email/EmailLibrary.vue'
import EmailComponents from '~/components/email/EmailComponents.vue'
import EmailLogView from '~/components/email/EmailLogView.vue'
import EmailSuppressions from '~/components/email/EmailSuppressions.vue'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const { projects, loadProjects } = useAgent()
const project = computed(() => projects.value.find(p => p.id === String(route.params.id)) || null)
const view = computed(() => String(route.query.view || 'log'))
onMounted(() => { if (!project.value) loadProjects().catch(() => {}) })
</script>
