<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader title="Knowledge">
      <template #actions>
        <USelect v-model="selectedProject" :items="projectItems" size="sm" class="w-48" aria-label="Project" @update:model-value="load" />
        <UButton icon="i-lucide-plus" label="New model" size="sm" :disabled="selectedProject === 'all'" @click="showCreate = true" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto py-2">
      <div v-if="loading" class="space-y-1 px-4 py-2"><USkeleton v-for="i in 4" :key="i" class="h-9" /></div>
      <EmptyState v-else-if="!models.length" icon="i-lucide-book-open" title="Start with a source document" description="Create a knowledge model, then import a markdown or text document to review the FAQs it produces. Pick a project first.">
        <UButton icon="i-lucide-plus" label="New model" :disabled="selectedProject === 'all'" @click="showCreate = true" />
      </EmptyState>
      <NuxtLink
        v-for="model in models"
        v-else
        :key="model.id"
        :to="`/knowledge/models/${model.id}`"
        class="mx-2 flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors hover:bg-elevated"
      >
        <UIcon :name="model.icon || 'i-lucide-book-open'" class="size-4 shrink-0 text-muted" />
        <span class="shrink-0 font-medium text-highlighted">{{ model.name }}</span>
        <span class="min-w-0 flex-1 truncate text-muted">{{ model.description }}</span>
        <span class="hidden items-center gap-1.5 text-xs text-muted sm:inline-flex"><ProjectDot :project-id="model.projectId" :accent="projectsById[model.projectId]?.theme?.accent" :icon-url="projectsById[model.projectId]?.iconUrl" />{{ projectsById[model.projectId]?.name || 'Unknown project' }}</span>
        <StatusDot :status="model.status" class="w-20" />
      </NuxtLink>
    </div>

    <UModal v-model:open="showCreate" title="New knowledge model" description="Choose a focused support area, then add source documents and FAQs.">
      <template #body><form class="space-y-4" @submit.prevent="create"><UFormField label="Name"><UInput v-model="form.name" autofocus class="w-full" required /></UFormField><UFormField label="Description" hint="Optional"><UTextarea v-model="form.description" class="w-full" :rows="3" /></UFormField><p v-if="error" class="text-sm text-error">{{ error }}</p><div class="flex justify-end gap-2"><UButton color="neutral" variant="ghost" @click="showCreate = false">Cancel</UButton><UButton type="submit" :loading="creating">Create model</UButton></div></form></template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { KnowledgeModel } from '~~/server/utils/knowledgeModels'

definePageMeta({ middleware: 'agent' })
const { api, projects, loadProjects } = useAgent()
const selectedProject = ref('all')
const models = ref<KnowledgeModel[]>([])
const loading = ref(true)
const showCreate = ref(false)
const creating = ref(false)
const error = ref('')
const form = reactive({ name: '', description: '' })
const projectItems = computed(() => [{ label: 'All projects', value: 'all' }, ...projects.value.map(project => ({ label: project.name, value: project.id }))])
const projectsById = computed(() => Object.fromEntries(projects.value.map(project => [project.id, project])))
async function load() { loading.value = true; try { models.value = (await api<{ models: KnowledgeModel[] }>('/admin/knowledge/models', { query: { projectId: selectedProject.value === 'all' ? undefined : selectedProject.value } })).models } finally { loading.value = false } }
async function create() {
  if (!selectedProject.value || selectedProject.value === 'all') return
  creating.value = true; error.value = ''
  try { const { model } = await api<{ model: KnowledgeModel }>('/admin/knowledge/models', { method: 'POST', body: { projectId: selectedProject.value, ...form } }); await navigateTo(`/knowledge/models/${model.id}`) }
  catch (cause: any) { error.value = cause?.message || 'Could not create the model' } finally { creating.value = false }
}
onMounted(async () => { await loadProjects(); await load(); })
</script>

