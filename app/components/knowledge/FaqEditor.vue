<template>
  <UModal v-model:open="open" :title="faqId ? 'Edit FAQ' : 'New FAQ'" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <div v-if="loading" class="py-8 text-center text-sm text-muted">Loading…</div>
      <form v-else class="space-y-4" @submit.prevent="save">
        <UFormField label="Question">
          <UInput v-model="form.question" class="w-full" required autofocus />
        </UFormField>

        <UFormField label="Answer" hint="Markdown">
          <div class="flex gap-1 mb-1">
            <UButton size="xs" :variant="tab === 'edit' ? 'soft' : 'ghost'" color="neutral" @click="tab = 'edit'">Write</UButton>
            <UButton size="xs" :variant="tab === 'preview' ? 'soft' : 'ghost'" color="neutral" @click="tab = 'preview'">Preview</UButton>
          </div>
          <UTextarea v-if="tab === 'edit'" v-model="form.answer" class="w-full font-mono" :rows="8" />
          <div v-else class="rounded-lg border border-default p-3 min-h-[8rem]">
            <MarkdownBlock :text="form.answer" />
          </div>
        </UFormField>

        <div class="grid sm:grid-cols-2 gap-4">
          <UFormField label="Path">
            <OptionalSelect v-model="form.nodeId" :items="nodeItems" none-label="(model root)" class="w-full" />
          </UFormField>
          <UFormField label="Status">
            <USelect v-model="form.status" :items="statusItems" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Alternate phrasings" hint="one per line — helps retrieval find this answer">
          <UTextarea v-model="aliasesText" class="w-full" :rows="2" placeholder="How can I remove a bookmark?" />
        </UFormField>

        <UFormField label="Tags" hint="comma separated">
          <UInput v-model="tagsText" class="w-full" />
        </UFormField>

        <div v-if="source" class="rounded-lg bg-elevated p-3 text-xs text-muted space-y-0.5">
          <p class="font-medium text-toned">Source</p>
          <p>File: {{ source.filename }} <span v-if="detached" class="text-warning">· edited (won't be overwritten on re-import)</span></p>
          <p v-if="sourceSection">Section: {{ sourceSection }}</p>
          <p>Version: {{ sourceVersion }} · Imported {{ importedDate }}</p>
        </div>

        <p v-if="agentCount" class="text-xs text-muted">
          <UIcon name="i-lucide-sparkles" class="size-3 inline" /> {{ agentCount }} assistant{{ agentCount === 1 ? '' : 's' }} can use this FAQ.
        </p>

        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
          <UButton type="submit" color="primary" :loading="saving">{{ faqId ? 'Save' : 'Create' }}</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { FAQ_STATUSES } from '#shared/knowledge'
import type { Faq } from '~~/server/utils/faqs'
import type { KnowledgeNode } from '~~/server/utils/knowledgeNodes'
import type { KnowledgeDocument } from '~~/server/utils/knowledgeDocuments'

const props = defineProps<{ modelId: string, faqId: string, nodes: KnowledgeNode[] }>()
const emit = defineEmits<{ saved: [] }>()
const open = defineModel<boolean>('open', { required: true })

const { api } = useAgent()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const tab = ref<'edit' | 'preview'>('edit')
const form = reactive({ question: '', answer: '', nodeId: '', status: 'active' })
const aliasesText = ref('')
const tagsText = ref('')
const source = ref<KnowledgeDocument | null>(null)
const sourceSection = ref('')
const sourceVersion = ref(0)
const lastProcessedAt = ref<string | null>(null)
const detached = ref(false)
const agentCount = ref(0)

const statusItems = FAQ_STATUSES.map(s => ({ label: s, value: s }))
const nodeItems = computed(() => props.nodes.map(n => ({ label: n.pathCache, value: n.id })))
const importedDate = computed(() => lastProcessedAt.value ? new Date(lastProcessedAt.value).toLocaleDateString() : '—')

watch(open, async (isOpen) => {
  if (!isOpen) return
  error.value = ''
  tab.value = 'edit'
  Object.assign(form, { question: '', answer: '', nodeId: '', status: 'active' })
  aliasesText.value = ''; tagsText.value = ''
  source.value = null; sourceSection.value = ''; sourceVersion.value = 0; detached.value = false; agentCount.value = 0
  if (!props.faqId) return
  loading.value = true
  try {
    const res = await api<{ faq: Faq, sourceDocument: KnowledgeDocument | null, agentIds: string[] }>(`/admin/knowledge/faqs/${props.faqId}`)
    form.question = res.faq.question
    form.answer = res.faq.answer
    form.nodeId = res.faq.nodeId
    form.status = res.faq.status
    aliasesText.value = res.faq.aliases.join('\n')
    tagsText.value = res.faq.tags.join(', ')
    source.value = res.sourceDocument
    sourceSection.value = res.faq.sourceSection
    sourceVersion.value = res.faq.sourceVersion
    lastProcessedAt.value = res.faq.lastProcessedAt
    detached.value = res.faq.detached
    agentCount.value = res.agentIds.length
  } catch (e: any) {
    error.value = e?.message || 'Could not load the FAQ'
  } finally {
    loading.value = false
  }
})

async function save() {
  saving.value = true
  error.value = ''
  const body = {
    modelId: props.modelId,
    question: form.question,
    answer: form.answer,
    nodeId: form.nodeId,
    status: form.status,
    aliases: aliasesText.value.split('\n').map(s => s.trim()).filter(Boolean),
    tags: tagsText.value.split(',').map(s => s.trim()).filter(Boolean)
  }
  try {
    if (props.faqId) await api(`/admin/knowledge/faqs/${props.faqId}`, { method: 'PATCH', body })
    else await api('/admin/knowledge/faqs', { method: 'POST', body })
    open.value = false
    emit('saved')
  } catch (e: any) {
    error.value = e?.message || 'Could not save the FAQ'
  } finally {
    saving.value = false
  }
}
</script>
