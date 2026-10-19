<template>
  <template v-if="project">
    <SegmentList v-if="view === 'segments'" :key="`segments-${project.id}`" :project="project" />
    <SourceList v-else-if="view === 'sources'" :key="`sources-${project.id}`" :project="project" />
    <ContactList v-else :key="project.id" :project="project" />
  </template>
</template>

<script setup lang="ts">
import ContactList from '~/components/contacts/ContactList.vue'
import SegmentList from '~/components/contacts/SegmentList.vue'
import SourceList from '~/components/contacts/SourceList.vue'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const { projects, loadProjects } = useAgent()
const project = computed(() => projects.value.find(p => p.id === String(route.params.id)) || null)
const view = computed(() => String(route.query.view || 'people'))
onMounted(() => { if (!project.value) loadProjects().catch(() => {}) })
</script>
