<template>
  <details class="rounded-xl border border-default" @toggle="toggle">
    <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold">
      <UIcon name="i-lucide-message-square" class="size-4 text-muted" />
      <span>{{ $t('board.comments') }}</span>
      <span v-if="loaded" class="text-xs font-normal text-muted">{{ comments.length }}</span>
    </summary>
    <div class="space-y-4 border-t border-default px-3 py-3">
      <p v-if="loading && !comments.length" class="text-xs text-muted">{{ $t('board.commentsLoading') }}</p>
      <p v-else-if="error && !comments.length" class="text-xs text-error">{{ $t('board.commentsFailed') }}</p>
      <p v-else-if="!comments.length" class="text-xs text-muted">{{ $t('board.noComments') }}</p>

      <ol v-if="comments.length" class="space-y-3">
        <li v-for="comment in comments" :key="comment.id" :class="comment.parentId ? 'ml-4 border-l border-default pl-3' : ''" class="space-y-1.5">
          <div class="flex items-baseline gap-2 text-xs">
            <span class="font-medium text-highlighted">{{ comment.authorName }}</span>
            <span class="text-muted">{{ $t(`board.historySource.${comment.source}`) }}</span>
            <time class="ml-auto text-muted" :datetime="comment.createdAt" :title="new Date(comment.createdAt).toLocaleString()">{{ new Date(comment.createdAt).toLocaleString() }}</time>
          </div>
          <p class="whitespace-pre-wrap break-words text-[13px] text-toned">{{ comment.body }}</p>
          <div v-if="comment.attachments.length" class="flex flex-wrap gap-2 pt-1">
            <a v-for="file in comment.attachments" :key="file.url" :href="file.url" target="_blank" rel="noopener" class="flex max-w-full items-center gap-2 rounded-lg border border-default px-2 py-1.5 text-xs text-toned">
              <img v-if="file.mime.startsWith('image/')" :src="file.url" :alt="file.name" class="size-9 rounded object-cover" loading="lazy">
              <UIcon v-else name="i-lucide-file" class="size-4 shrink-0 text-muted" />
              <span class="max-w-52 truncate">{{ file.name }}</span>
              <UIcon name="i-lucide-download" class="size-3.5 shrink-0 text-muted" />
            </a>
          </div>
          <UButton size="xs" color="neutral" variant="ghost" :label="$t('board.reply')" @click="replyTo(comment)" />
        </li>
      </ol>

      <UButton v-if="hasMore" size="xs" color="neutral" variant="ghost" :loading="loading" :label="$t('board.moreComments')" @click="loadMore" />

      <form class="space-y-2" @submit.prevent="submit">
        <p v-if="replyTarget" class="text-xs text-muted">
          {{ $t('board.replyingTo', { name: replyTarget.authorName }) }}
          <button type="button" class="ml-1 underline" @click="cancelReply">{{ $t('common.cancel') }}</button>
        </p>
        <UTextarea v-model="draft" :rows="3" :maxlength="8000" :placeholder="$t('board.writeComment')" class="w-full" />
        <AttachmentsField v-model="draftAttachments" :project-id="projectId" />
        <p v-if="error" class="text-xs text-error">{{ error }}</p>
        <div class="flex justify-end">
          <UButton type="submit" size="sm" :label="replyTarget ? $t('board.reply') : $t('board.postComment')" :loading="saving" :disabled="!draft.trim() && !draftAttachments.length" />
        </div>
      </form>
    </div>
  </details>
</template>

<script setup lang="ts">
import type { BoardItemComment } from '#shared/board'

const props = defineProps<{ projectId: string, itemId: string }>()
const { api } = useAgent()
const { t } = useI18n()

const comments = ref<BoardItemComment[]>([])
const draft = ref('')
const draftAttachments = ref<BoardItemComment['attachments']>([])
const replyTarget = ref<BoardItemComment | null>(null)
const loaded = ref(false)
const loading = ref(false)
const saving = ref(false)
const hasMore = ref(false)
const offset = ref(0)
const error = ref('')

function toggle(event: Event) {
  if ((event.currentTarget as HTMLDetailsElement).open && !loaded.value) void load(true)
}

async function load(reset: boolean) {
  if (loading.value) return
  if (reset) { comments.value = []; offset.value = 0; hasMore.value = false }
  loading.value = true
  error.value = ''
  try {
    const page = await api<{ comments: BoardItemComment[], hasMore: boolean, nextOffset: number | null }>(`/admin/board-items/${props.itemId}/comments`, { query: { project: props.projectId, offset: offset.value, limit: 50 } })
    comments.value = reset ? page.comments : [...comments.value, ...page.comments]
    hasMore.value = page.hasMore
    offset.value = page.nextOffset ?? offset.value
    loaded.value = true
  } catch {
    error.value = t('board.commentsFailed')
  } finally {
    loading.value = false
  }
}

function loadMore() { void load(false) }

function replyTo(comment: BoardItemComment) {
  replyTarget.value = comment
  draft.value = ''
}

function cancelReply() { replyTarget.value = null }

async function submit() {
  const body = draft.value.trim()
  if ((!body && !draftAttachments.value.length) || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const target = replyTarget.value
    const result = await api<{ comment: BoardItemComment }>(`/admin/board-items/${props.itemId}/comments`, {
      method: 'POST', query: { project: props.projectId },
      body: { body, attachments: draftAttachments.value, ...(target ? { parentId: target.parentId || target.id, replyToId: target.id } : {}) }
    })
    comments.value = [...comments.value, result.comment]
    draft.value = ''
    draftAttachments.value = []
    replyTarget.value = null
    loaded.value = true
  } catch {
    error.value = t('board.commentError')
  } finally {
    saving.value = false
  }
}
</script>
