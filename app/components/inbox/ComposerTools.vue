<template>
  <!-- Beside the reply box: saved replies and FAQs to insert, and an AI draft. -->
  <div class="flex shrink-0 items-center">
    <UPopover v-model:open="open" :content="{ side: 'top', align: 'start' }">
      <UButton icon="i-lucide-message-square-text" color="neutral" variant="ghost" square class="rounded-full" :aria-label="$t('inbox.hub.pickerOpen')" />
      <template #content>
        <div class="w-80 max-w-[calc(100vw-2rem)]">
          <div class="border-b border-default p-2">
            <UInput v-model="q" icon="i-lucide-search" size="sm" autofocus class="w-full" :placeholder="$t('inbox.hub.pickerSearch')" :aria-label="$t('inbox.hub.pickerSearch')" />
          </div>
          <div class="max-h-72 overflow-y-auto py-1">
            <p v-if="error" class="px-3 py-2 text-xs text-error">{{ error }}</p>
            <template v-if="replies.length">
              <p class="section-label px-3 pb-1 pt-2">{{ $t('inbox.hub.pickerSavedReplies') }}</p>
              <button v-for="reply in replies" :key="reply.id" type="button" class="block w-full px-3 py-1.5 text-left hover:bg-elevated" @click="insertReply(reply)">
                <span class="flex items-center gap-1.5 text-[13px] font-medium text-highlighted"><span class="truncate">{{ reply.title }}</span><span v-if="reply.shortcut" class="shrink-0 font-mono text-[11px] font-normal text-muted">/{{ reply.shortcut }}</span></span>
                <span class="line-clamp-2 text-xs text-muted">{{ fill(reply.body) }}</span>
              </button>
            </template>
            <template v-if="faqs.length">
              <p class="section-label px-3 pb-1 pt-2">{{ $t('inbox.hub.pickerFaqs') }}</p>
              <button v-for="faq in faqs" :key="faq.id" type="button" class="block w-full px-3 py-1.5 text-left hover:bg-elevated" @click="insert(faq.answer)">
                <span class="block truncate text-[13px] font-medium text-highlighted">{{ faq.question }}</span>
                <span class="line-clamp-2 text-xs text-muted">{{ faq.answer }}</span>
              </button>
            </template>
            <p v-if="!loading && !error && !replies.length && !faqs.length" class="px-3 py-4 text-center text-xs text-muted">{{ $t('inbox.hub.pickerEmpty') }}</p>
          </div>
          <div class="border-t border-default p-1">
            <UButton icon="i-lucide-settings-2" :label="$t('inbox.hub.pickerManage')" color="neutral" variant="ghost" size="xs" block class="justify-start" @click="manage" />
          </div>
        </div>
      </template>
    </UPopover>
    <UTooltip :text="$t('inbox.hub.draftButton')">
      <UButton icon="i-lucide-sparkles" color="neutral" variant="ghost" square class="rounded-full" :loading="drafting" :disabled="disabled" :aria-label="$t('inbox.hub.draftButton')" @click="draft" />
    </UTooltip>
    <InboxSavedRepliesModal v-model:open="manageOpen" :project-id="projectId" @changed="load" />
  </div>
</template>

<script setup lang="ts">
import { fillSavedReply } from '#shared/savedReplies'
import type { DraftResponse, SuggestionsResponse } from '#shared/conversationHub'

// `person` fills {{firstName}} and {{name}} when a saved reply is inserted.
const props = defineProps<{ conversationId: string, projectId: string, person: { name: string, email: string }, disabled?: boolean }>()
const emit = defineEmits<{ insert: [text: string], draft: [text: string] }>()

const { api } = useAgent()
const { t } = useI18n()
const toast = useToast()

const open = ref(false)
const manageOpen = ref(false)
const q = ref('')
const replies = ref<SuggestionsResponse['savedReplies']>([])
const faqs = ref<SuggestionsResponse['faqs']>([])
const loading = ref(false)
const error = ref('')
const drafting = ref(false)

const fill = (body: string) => fillSavedReply(body, props.person)

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  error.value = ''
  try {
    const result = await api<SuggestionsResponse>(`/admin/conversations/${props.conversationId}/suggestions`, { query: { q: q.value.trim() || undefined } })
    if (mine !== run) return
    replies.value = result.savedReplies
    faqs.value = result.faqs
  } catch (e: any) {
    if (mine === run) error.value = e?.message || t('inbox.hub.pickerError')
  } finally {
    if (mine === run) loading.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
watch(q, () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 250) })
watch(open, (isOpen) => { if (isOpen) void load() })
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

function insert(text: string) {
  emit('insert', text)
  open.value = false
}
function insertReply(reply: { body: string }) { insert(fill(reply.body)) }
function manage() {
  open.value = false
  manageOpen.value = true
}

async function draft() {
  drafting.value = true
  try {
    const result = await api<DraftResponse>(`/admin/conversations/${props.conversationId}/draft`, { method: 'POST' })
    emit('draft', result.draft)
    toast.add(result.sources.length ? { title: t('inbox.hub.draftReady'), icon: 'i-lucide-sparkles' } : { title: t('inbox.hub.draftReady'), description: t('inbox.hub.draftNoSources'), icon: 'i-lucide-sparkles' })
  } catch (e: any) {
    toast.add({ title: t('inbox.hub.draftError'), description: e?.message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    drafting.value = false
  }
}
</script>
