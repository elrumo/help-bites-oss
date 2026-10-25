<template>
  <USlideover v-model:open="open" :title="kind === 'feedback' ? $t('aiCards.titleFeedback') : $t('aiCards.titleBoard')" :description="$t('aiCards.description')" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div ref="scroller" class="space-y-3">
        <div v-for="(turn, i) in turns" :key="i" class="flex" :class="turn.role === 'user' ? 'justify-end' : ''">
          <div class="max-w-[90%] rounded-xl px-3 py-2 text-[13px]" :class="turn.role === 'user' ? 'bg-primary text-inverted' : turn.error ? 'bg-error/10 text-error' : 'bg-elevated'">
            <p class="whitespace-pre-wrap break-words">{{ turn.text }}</p>
            <ul v-if="turn.files?.length" class="mt-1 space-y-0.5 text-xs opacity-80">
              <li v-for="file in turn.files" :key="file.url"><UIcon name="i-lucide-paperclip" class="mr-1 inline size-3" />{{ file.name }}</li>
            </ul>
            <template v-if="turn.created?.length">
              <p class="mt-2 text-xs font-semibold">{{ $t('aiCards.created', { count: turn.created.length }) }}</p>
              <ul class="mt-1 space-y-0.5 text-xs">
                <li v-for="card in turn.created" :key="card.id"><span v-if="card.number" class="tabular-nums text-muted">#{{ card.number }} </span>{{ card.title }}</li>
              </ul>
            </template>
            <template v-if="turn.updated?.length">
              <p class="mt-2 text-xs font-semibold">{{ $t('aiCards.updated', { count: turn.updated.length }) }}</p>
              <ul class="mt-1 space-y-0.5 text-xs">
                <li v-for="item in turn.updated" :key="item.id"><span v-if="item.number" class="tabular-nums text-muted">#{{ item.number }} </span>{{ item.title }} <span class="text-muted">· {{ item.changes.join(', ') }}</span></li>
              </ul>
            </template>
            <p v-for="f in turn.failed" :key="f.title" class="mt-1 text-xs text-error">{{ $t('aiCards.failed', f) }}</p>
          </div>
        </div>
        <div v-if="sending" class="flex"><USkeleton class="h-10 w-48 rounded-xl" /></div>
      </div>
    </template>
    <template #footer>
      <div class="w-full space-y-2">
      <AttachmentsField v-model="files" :project-id="projectId" :add-label="$t('aiCards.attach')" />
      <form class="flex w-full items-end gap-2" @submit.prevent="send">
        <UTextarea v-model="draft" :rows="3" :maxrows="10" autoresize :maxlength="20000" :placeholder="kind === 'feedback' ? $t('aiCards.placeholderFeedback') : $t('aiCards.placeholderBoard')" class="flex-1" @keydown.meta.enter.prevent="send" @keydown.ctrl.enter.prevent="send" />
        <UButton type="submit" icon="i-lucide-sparkles" :label="$t('aiCards.send')" :loading="sending" :disabled="!draft.trim()" />
      </form>
      </div>
    </template>
  </USlideover>
</template>

<script setup lang="ts">
import type { ItemAttachment } from '#shared/itemAttachments'

// The AI chat on the feedback and board pages: text in, separate cards out, and on the board
// changes to existing items. The server (POST /v1/admin/projects/:id/ai-cards) makes them;
// `created` tells the page to reload.

type Turn = { role: 'user' | 'assistant', text: string, files?: ItemAttachment[], error?: boolean, created?: { id: string, number: number | null, title: string }[], updated?: { id: string, number: number | null, title: string, changes: string[] }[], failed?: { title: string, message: string }[] }

const props = defineProps<{ projectId: string, kind: 'feedback' | 'board' }>()
const emit = defineEmits<{ created: [] }>()
const open = defineModel<boolean>('open', { default: false })

const { api } = useAgent()
const { t } = useI18n()
const turns = ref<Turn[]>([])
const draft = ref('')
// Images and files attached to the message being written: they go onto every card it creates.
const files = ref<ItemAttachment[]>([])
const sending = ref(false)

// What the model sees of earlier turns: the words, plus what it already filed or changed so it does not repeat it.
const history = computed(() => turns.value.filter(turn => !turn.error).map(turn => ({
  role: turn.role,
  content: [
    turn.text,
    ...(turn.created?.length ? [`Created: ${turn.created.map(c => c.title).join('; ')}`] : []),
    ...(turn.updated?.length ? [`Changed: ${turn.updated.map(u => `${u.number ? `#${u.number}` : u.title}: ${u.changes.join(', ')}`).join('; ')}`] : [])
  ].join('\n')
})))

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value) return
  const attached = files.value
  turns.value.push({ role: 'user', text, files: attached })
  draft.value = ''
  files.value = []
  sending.value = true
  try {
    const result = await api<{ reply: string, created: NonNullable<Turn['created']>, updated: NonNullable<Turn['updated']>, failed: NonNullable<Turn['failed']> }>(`/admin/projects/${props.projectId}/ai-cards`, { method: 'POST', body: { kind: props.kind, messages: history.value, attachments: attached } })
    const changed = result.created.length + result.updated.length
    turns.value.push({ role: 'assistant', text: result.reply || (changed ? '' : t('aiCards.none')), created: result.created, updated: result.updated, failed: result.failed })
    if (changed) emit('created')
  } catch (e: any) {
    files.value = attached
    turns.value.push({ role: 'assistant', text: e?.message || t('aiCards.error'), error: true })
  } finally {
    sending.value = false
  }
}
</script>
