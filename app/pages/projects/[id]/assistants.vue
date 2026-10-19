<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="projectId" :title="$t('sections.assistants')">
      <template #actions>
        <UButton icon="i-lucide-plus" :label="$t('projectTools.assistants.newAssistant')" color="neutral" variant="outline" size="sm" @click="showCreate = true" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto py-2">
      <div v-if="loading" class="space-y-1 px-4 py-2"><USkeleton v-for="i in 3" :key="i" class="h-9" /></div>
      <EmptyState v-else-if="!agents.length" icon="i-lucide-sparkles" :title="$t('projectTools.assistants.emptyTitle')" :description="$t('projectTools.assistants.emptyDescription')">
        <UButton icon="i-lucide-plus" :label="$t('projectTools.assistants.newAssistant')" @click="showCreate = true" />
      </EmptyState>
      <NuxtLink
        v-for="a in agents"
        v-else
        :key="a.id"
        :to="`/assistants/${a.id}`"
        class="mx-2 flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors hover:bg-elevated"
      >
        <span class="grid size-5 shrink-0 place-items-center rounded-md bg-primary-500/12 text-primary"><UIcon name="i-lucide-sparkles" class="size-3.5" /></span>
        <span class="shrink-0 font-medium text-highlighted">{{ a.name }}</span>
        <span class="min-w-0 flex-1 truncate text-muted">{{ a.description || a.model }}</span>
        <span v-if="a.autoReply" class="hidden items-center gap-1 text-xs text-muted sm:inline-flex"><UIcon name="i-lucide-zap" class="size-3.5" />{{ $t('projectTools.assistants.autoReply') }}</span>
        <StatusDot :status="a.status" />
      </NuxtLink>
    </div>

    <UModal v-model:open="showCreate" :title="$t('projectTools.assistants.newAssistant')" :description="$t('projectTools.assistants.nameHint')">
      <template #body>
        <form class="space-y-4" @submit.prevent="create">
          <UFormField :label="$t('common.name')"><UInput v-model="form.name" class="w-full" autofocus required /></UFormField>
          <UFormField :label="$t('projectTools.shared.description')" :hint="$t('projectTools.shared.optional')"><UTextarea v-model="form.description" class="w-full" :rows="2" /></UFormField>
          <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showCreate = false">{{ $t('common.cancel') }}</UButton>
            <UButton type="submit" :loading="creating">{{ $t('projectTools.assistants.createAssistant') }}</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { SupportAgent } from '~~/server/utils/supportAgents'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const projectId = String(route.params.id)
const { api } = useAgent()
const { t } = useI18n()

const agents = ref<SupportAgent[]>([])
const loading = ref(true)
const showCreate = ref(false)
const creating = ref(false)
const error = ref('')
const form = reactive({ name: '', description: '' })

async function load() {
  loading.value = true
  try { agents.value = (await api<{ agents: SupportAgent[] }>(`/admin/support-agents?projectId=${projectId}`)).agents } finally { loading.value = false }
}
async function create() {
  creating.value = true
  error.value = ''
  try {
    const { agent } = await api<{ agent: SupportAgent }>('/admin/support-agents', { method: 'POST', body: { projectId, ...form } })
    showCreate.value = false
    Object.assign(form, { name: '', description: '' })
    await navigateTo(`/assistants/${agent.id}`)
  } catch (e: any) { error.value = e?.message || t('projectTools.assistants.createError') } finally { creating.value = false }
}

onMounted(load)
</script>
