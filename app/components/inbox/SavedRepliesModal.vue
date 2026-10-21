<template>
  <UModal v-model:open="open" :title="$t('inbox.hub.savedRepliesTitle')" :description="$t('inbox.hub.savedRepliesDescription', { firstName: '{{firstName}}', name: '{{name}}' })">
    <template #body>
      <form v-if="editing" class="space-y-3" @submit.prevent="save">
        <UFormField :label="$t('inbox.hub.savedReplyTitle')" required><UInput v-model="form.title" class="w-full" :maxlength="SAVED_REPLY_TITLE_MAX_LENGTH" autofocus /></UFormField>
        <UFormField :label="$t('inbox.hub.savedReplyShortcut')" :hint="$t('inbox.hub.savedReplyShortcutHint')"><UInput v-model="form.shortcut" class="w-full" :maxlength="SAVED_REPLY_SHORTCUT_MAX_LENGTH" /></UFormField>
        <UFormField :label="$t('inbox.hub.savedReplyBody')" required><UTextarea v-model="form.body" class="w-full" :rows="6" autoresize :maxrows="14" :maxlength="SAVED_REPLY_BODY_MAX_LENGTH" /></UFormField>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton :label="$t('common.cancel')" color="neutral" variant="ghost" @click="editing = false" />
          <UButton type="submit" :label="$t('inbox.hub.savedReplySave')" :loading="saving" :disabled="!form.title.trim() || !form.body.trim()" />
        </div>
      </form>
      <div v-else class="space-y-3">
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div v-if="loading && !replies.length" class="h-10 animate-pulse rounded-lg bg-elevated" />
        <p v-else-if="!replies.length" class="py-4 text-center text-sm text-muted">{{ $t('inbox.hub.savedReplyEmpty') }}</p>
        <ul v-else class="divide-y divide-default rounded-lg border border-default">
          <li v-for="reply in replies" :key="reply.id" class="flex items-start gap-2 px-3 py-2">
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-1.5 text-[13px] font-medium text-highlighted"><span class="truncate">{{ reply.title }}</span><span v-if="reply.shortcut" class="shrink-0 font-mono text-[11px] font-normal text-muted">/{{ reply.shortcut }}</span></p>
              <p class="line-clamp-2 text-xs text-muted">{{ reply.body }}</p>
            </div>
            <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" square :aria-label="$t('inbox.hub.savedReplyEdit')" @click="edit(reply)" />
            <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="xs" square class="hover:text-error" :aria-label="$t('inbox.hub.savedReplyDelete')" :loading="busy === reply.id" @click="remove(reply)" />
          </li>
        </ul>
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs text-muted">{{ replies.length }} / {{ SAVED_REPLIES_PER_PROJECT }}</p>
          <UButton icon="i-lucide-plus" :label="$t('inbox.hub.savedReplyNew')" size="sm" :disabled="replies.length >= SAVED_REPLIES_PER_PROJECT" @click="edit(null)" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { SAVED_REPLIES_PER_PROJECT, SAVED_REPLY_BODY_MAX_LENGTH, SAVED_REPLY_SHORTCUT_MAX_LENGTH, SAVED_REPLY_TITLE_MAX_LENGTH, type SavedReply } from '#shared/savedReplies'

// Create, edit and delete a project's saved replies. Reached from the reply
// picker beside the composer, so it needs no section of its own.

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ changed: [] }>()

const { api } = useAgent()
const { t } = useI18n()

const replies = ref<SavedReply[]>([])
const loading = ref(false)
const editing = ref(false)
const saving = ref(false)
const busy = ref('')
const error = ref('')
const form = reactive({ id: '', title: '', shortcut: '', body: '' })

async function load() {
  loading.value = true
  error.value = ''
  try {
    replies.value = (await api<{ replies: SavedReply[] }>('/admin/saved-replies', { query: { project: props.projectId } })).replies
  } catch (e: any) {
    error.value = e?.message || t('inbox.hub.savedReplyLoadError')
  } finally {
    loading.value = false
  }
}

function edit(reply: SavedReply | null) {
  Object.assign(form, { id: reply?.id || '', title: reply?.title || '', shortcut: reply?.shortcut || '', body: reply?.body || '' })
  error.value = ''
  editing.value = true
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const body = { title: form.title, body: form.body, shortcut: form.shortcut }
    if (form.id) await api(`/admin/saved-replies/${form.id}`, { method: 'PATCH', body })
    else await api('/admin/saved-replies', { method: 'POST', body: { project: props.projectId, ...body } })
    editing.value = false
    await load()
    emit('changed')
  } catch (e: any) {
    error.value = e?.message || t('inbox.hub.savedReplySaveError')
  } finally {
    saving.value = false
  }
}

async function remove(reply: SavedReply) {
  if (!confirm(t('inbox.hub.savedReplyDeleteConfirm'))) return
  busy.value = reply.id
  error.value = ''
  try {
    await api(`/admin/saved-replies/${reply.id}`, { method: 'DELETE' })
    replies.value = replies.value.filter(item => item.id !== reply.id)
    emit('changed')
  } catch (e: any) {
    error.value = e?.message || t('inbox.hub.savedReplyDeleteError')
  } finally {
    busy.value = ''
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  editing.value = false
  void load()
})
</script>
