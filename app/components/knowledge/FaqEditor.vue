<template>
  <UModal v-model:open="open" :title="faqId ? $t('knowledge.faq.editTitle') : $t('knowledge.newFaq')" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <div v-if="loading" class="py-8 text-center text-sm text-muted">{{ $t('knowledge.loading') }}</div>
      <form v-else class="space-y-4" @submit.prevent="save">
        <UFormField :label="$t('knowledge.faq.question')">
          <UInput v-model="form.question" class="w-full" required autofocus />
        </UFormField>

        <UFormField :label="$t('knowledge.faq.answer')" hint="Markdown">
          <div class="flex gap-1 mb-1">
            <UButton size="xs" :variant="tab === 'edit' ? 'soft' : 'ghost'" color="neutral" @click="tab = 'edit'">{{ $t('knowledge.faq.write') }}</UButton>
            <UButton size="xs" :variant="tab === 'preview' ? 'soft' : 'ghost'" color="neutral" @click="tab = 'preview'">{{ $t('knowledge.faq.preview') }}</UButton>
          </div>
          <UTextarea v-if="tab === 'edit'" v-model="form.answer" class="w-full font-mono" :rows="8" />
          <div v-else class="rounded-lg border border-default p-3 min-h-[8rem]">
            <MarkdownBlock :text="form.answer" />
          </div>
        </UFormField>

        <div class="grid sm:grid-cols-2 gap-4">
          <UFormField :label="$t('knowledge.faq.path')">
            <OptionalSelect v-model="form.nodeId" :items="nodeItems" :none-label="$t('knowledge.modelRoot')" class="w-full" />
          </UFormField>
          <UFormField :label="$t('knowledge.statusLabel')">
            <USelect v-model="form.status" :items="statusItems" class="w-full" />
          </UFormField>
        </div>

        <UFormField :label="$t('knowledge.faq.aliases')" :hint="$t('knowledge.faq.aliasesHint')">
          <UTextarea v-model="aliasesText" class="w-full" :rows="2" :placeholder="$t('knowledge.faq.aliasPlaceholder')" />
        </UFormField>

        <UFormField :label="$t('knowledge.faq.tags')" :hint="$t('knowledge.faq.tagsHint')">
          <UInput v-model="tagsText" class="w-full" />
        </UFormField>

        <div v-if="source" class="rounded-lg bg-elevated p-3 text-xs text-muted space-y-0.5">
          <p class="font-medium text-toned">{{ $t('knowledge.faq.source') }}</p>
          <p>{{ $t('knowledge.faq.file', { name: source.filename }) }} <span v-if="detached" class="text-warning">{{ $t('knowledge.faq.edited') }}</span></p>
          <p v-if="sourceSection">{{ $t('knowledge.faq.section', { section: sourceSection }) }}</p>
          <p>{{ $t('knowledge.faq.versionImported', { version: sourceVersion, date: importedDate }) }}</p>
        </div>

        <p v-if="agentCount" class="text-xs text-muted">
          <UIcon name="i-lucide-sparkles" class="size-3 inline" /> {{ $t('knowledge.faq.assistantsUse', agentCount) }}
        </p>

        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">{{ $t('common.cancel') }}</UButton>
          <UButton type="submit" color="primary" :loading="saving">{{ faqId ? $t('knowledge.save') : $t('knowledge.create') }}</UButton>
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
const { t } = useI18n()
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

const statusItems = computed(() => FAQ_STATUSES.map(s => ({ label: t(`knowledge.status.${s}`), value: s })))
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
    error.value = e?.message || t('knowledge.faq.couldNotLoad')
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
    error.value = e?.message || t('knowledge.faq.couldNotSave')
  } finally {
    saving.value = false
  }
}
</script>
