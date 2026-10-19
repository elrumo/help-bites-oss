<template>
  <template v-if="project">
    <MarketingSettings v-if="view === 'settings'" :key="`settings-${project.id}`" :project="project" />
    <SequenceList v-else-if="view === 'sequences'" :key="`sequences-${project.id}`" :project="project" />
    <CampaignList v-else :key="project.id" :project="project" />
  </template>
</template>

<script setup lang="ts">
import CampaignList from '~/components/campaigns/CampaignList.vue'
import MarketingSettings from '~/components/campaigns/MarketingSettings.vue'
import SequenceList from '~/components/campaigns/SequenceList.vue'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const { projects, loadProjects } = useAgent()
const project = computed(() => projects.value.find(p => p.id === String(route.params.id)) || null)
const view = computed(() => String(route.query.view || 'campaigns'))
onMounted(() => { if (!project.value) loadProjects().catch(() => {}) })
</script>
