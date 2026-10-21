<template>
  <UModal v-model:open="open" :title="$t('inbox.hub.saveFaq')" :description="$t('inbox.hub.saveFaqDescription')">
    <template #body>
      <div v-if="!models.length" class="space-y-3">
        <p class="text-sm text-muted">{{ $t('inbox.hub.faqNoModel') }}</p>
        <UButton :label="$t('inbox.hub.faqOpenKnowledge')" to="/knowledge" color="neutral" variant="outline" size="sm" />
      </div>
      <form v-else class="space-y-3" @submit.prevent="save">
        <UFormField :label="$t('inbox.hub.faqQuestion')" required><UTextarea v-model="question" class="w-full" :rows="2" autoresize :maxrows="6" :maxlength="FAQ_QUESTION_MAX_LENGTH" autofocus /></UFormField>
        <UFormField :label="$t('inbox.hub.faqAnswer')" required><UTextarea v-model="answer" class="w-full" :rows="5" autoresize :maxrows="14" :maxlength="FAQ_ANSWER_MAX_LENGTH" /></UFormField>
        <UFormField v-if="models.length > 1" :label="$t('inbox.hub.faqModel')"><USelect v-model="modelId" :items="modelItems" value-key="value" class="w-full" /></UFormField>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton :label="$t('common.cancel')" color="neutral" variant="ghost" @click="open = false" />
          <UButton type="submit" :label="$t('inbox.hub.faqSave')" :loading="saving" :disabled="!question.trim() || !answer.trim()" />
        </div>
      </form>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { FAQ_ANSWER_MAX_LENGTH, FAQ_QUESTION_MAX_LENGTH } from '#shared/knowledge'
import type { HubFaqModel } from '#shared/conversationHub'

// "Save as FAQ" on a reply: the question and answer start from the thread and
// are edited here; the model starts on the one the conversation's assistant reads.

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ conversationId: string, models: HubFaqModel[], defaultModelId: string, initial: { question: string, answer: string } }>()

const { api } = useAgent()
const { t } = useI18n()
const toast = useToast()

const question = ref('')
const answer = ref('')
const modelId = ref('')
const saving = ref(false)
const error = ref('')

const modelItems = computed(() => props.models.map(model => ({ label: model.name, value: model.id })))

watch(open, (isOpen) => {
  if (!isOpen) return
  question.value = props.initial.question
  answer.value = props.initial.answer
  modelId.value = props.defaultModelId || props.models[0]?.id || ''
  error.value = ''
})

async function save() {
  saving.value = true
  error.value = ''
  try {
    await api(`/admin/conversations/${props.conversationId}/faq`, { method: 'POST', body: { modelId: modelId.value || undefined, question: question.value, answer: answer.value } })
    open.value = false
    toast.add({ title: t('inbox.hub.faqSaved'), icon: 'i-lucide-book-open-check' })
  } catch (e: any) {
    error.value = e?.message || t('inbox.hub.faqSaveError')
  } finally {
    saving.value = false
  }
}
</script>
