<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="projectId" title="Knowledge base">
      <template #actions>
        <UButton icon="i-lucide-plus" label="New model" color="neutral" variant="outline" size="sm" @click="showCreate = true" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto py-2">
      <div v-if="loading" class="space-y-1 px-4 py-2"><USkeleton v-for="i in 3" :key="i" class="h-9" /></div>
      <EmptyState v-else-if="!models.length" icon="i-lucide-book-open" title="No knowledge models yet" description="A model holds the FAQs and source documents this project's assistants answer from.">
        <UButton icon="i-lucide-plus" label="New model" @click="showCreate = true" />
      </EmptyState>
      <NuxtLink
        v-for="m in models"
        v-else
        :key="m.id"
        :to="`/knowledge/models/${m.id}`"
        class="mx-2 flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors hover:bg-elevated"
      >
        <UIcon :name="m.icon || 'i-lucide-book-open'" class="size-4 shrink-0 text-muted" />
        <span class="shrink-0 font-medium text-highlighted">{{ m.name }}</span>
        <span class="min-w-0 flex-1 truncate text-muted">{{ m.description }}</span>
        <StatusDot :status="m.status" />
      </NuxtLink>
    </div>

    <UModal v-model:open="showCreate" title="New knowledge model" description="Name it after a product or support area within this project.">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <UFormField label="Name"><UInput v-model="form.name" class="w-full" autofocus required /></UFormField>
          <UFormField label="Description" hint="Optional"><UTextarea v-model="form.description" class="w-full" :rows="3" /></UFormField>
          <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showCreate = false">Cancel</UButton>
            <UButton type="submit" :loading="creating">Create model</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { KnowledgeModel } from '~~/server/utils/knowledgeModels'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const projectId = String(route.params.id)
const { api } = useAgent()

const models = ref<KnowledgeModel[]>([])
const loading = ref(true)
const showCreate = ref(false)
const creating = ref(false)
const error = ref('')
const form = reactive({ name: '', description: '' })

async function load() {
  loading.value = true
  try { models.value = (await api<{ models: KnowledgeModel[] }>(`/admin/knowledge/models?projectId=${projectId}`)).models } finally { loading.value = false }
}
async function create() {
  creating.value = true
  error.value = ''
  try {
    const { model } = await api<{ model: KnowledgeModel }>('/admin/knowledge/models', { method: 'POST', body: { projectId, ...form } })
    showCreate.value = false
    Object.assign(form, { name: '', description: '' })
    await navigateTo(`/knowledge/models/${model.id}`)
  } catch (e: any) { error.value = e?.message || 'Could not create the model' } finally { creating.value = false }
}

onMounted(load)
</script>
