<template>
  <template v-if="project">
    <EmailLogView v-if="view === 'log'" :key="`log-${project.id}`" :project="project" />
    <EmailComponents v-else-if="view === 'components'" :key="`components-${project.id}`" :project="project" />
    <EmailSuppressions v-else-if="view === 'suppressions'" :key="`suppressions-${project.id}`" :project="project" />
    <EmailSettings v-else-if="view === 'settings'" :key="`settings-${project.id}`" :project="project" />
    <SequenceList v-else-if="view === 'sequences'" :key="`sequences-${project.id}`" :project="project" />
    <CampaignList v-else-if="view === 'campaigns'" :key="`campaigns-${project.id}`" :project="project" />
    <EmailLibrary v-else :key="project.id" :project="project" />
  </template>
</template>

<script setup lang="ts">
import CampaignList from '~/components/campaigns/CampaignList.vue'
import SequenceList from '~/components/campaigns/SequenceList.vue'
import EmailLibrary from '~/components/email/EmailLibrary.vue'
import EmailComponents from '~/components/email/EmailComponents.vue'
import EmailLogView from '~/components/email/EmailLogView.vue'
import EmailSettings from '~/components/email/EmailSettings.vue'
import EmailSuppressions from '~/components/email/EmailSuppressions.vue'

definePageMeta({ middleware: 'agent' })

// A project's Email is one section: templates, campaigns, sequences, the log and the settings.
const route = useRoute()
const { projects, loadProjects } = useAgent()
const project = computed(() => projects.value.find(p => p.id === String(route.params.id)) || null)
const view = computed(() => String(route.query.view || 'templates'))
onMounted(() => { if (!project.value) loadProjects().catch(() => {}) })
</script>
