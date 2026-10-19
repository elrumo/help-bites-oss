<template>
  <div class="flex h-full flex-col bg-default text-default">
    <!-- Linear's page bar: where you are on the left, close on the right. -->
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default bg-default px-2">
      <UButton
        v-if="inSubview && !twoPane && canGoBack"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        :aria-label="$t('embed.chat.backToConversations')"
        @click="back"
      />
      <img v-else-if="project?.brandLogoUrl" :src="project.brandLogoUrl" alt="" class="ml-1.5 size-6 shrink-0 rounded-md bg-elevated object-cover">
      <span v-else class="ml-1.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary-500 text-[11px] font-semibold text-white" aria-hidden="true">{{ headerInitials }}</span>
      <div class="min-w-0 flex-1 pl-0.5">
        <p class="truncate text-[13px] font-semibold leading-tight text-highlighted">{{ headerTitle }}</p>
        <p v-if="headerNote" class="truncate text-xs leading-tight text-muted">{{ headerNote }}</p>
      </div>
      <UButton
        v-if="!inline"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        :aria-label="$t('embed.close')"
        @click="post({ type: 'close' })"
      />
    </header>

    <div class="flex-1 min-h-0 flex">
      <!-- Wide inline panel: the list lives beside the thread instead of behind it.
           Hidden until there's a first conversation — a new user just gets the form. -->
      <aside v-if="twoPane && hasConversations" class="flex w-64 shrink-0 flex-col border-r border-default lg:w-72">
        <ChatConversationList
          :items="listItems"
          :loading="listLoading"
          :searchable="false"
          @select="select"
        >
          <template #empty>
            <EmptyState icon="i-lucide-messages-square" :title="$t('embed.chat.noConversations')" :description="$t('embed.chat.noConversationsDescription')" />
          </template>
        </ChatConversationList>
        <div class="border-t border-default p-3">
          <UButton block icon="i-lucide-square-pen" :label="$t('embed.chat.newMessage')" @click="startComposing" />
        </div>
      </aside>

      <div class="relative flex-1 min-h-0">
        <Transition :name="nav">
          <!-- Not authenticated yet -->
          <div v-if="state === 'waiting'" key="waiting" class="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-muted">
            {{ waitingText }}
          </div>

          <!-- Conversation list -->
          <div v-else-if="!activeId && !composing && !twoPane" key="list" class="absolute inset-0 flex flex-col">
            <ChatConversationList
              :items="listItems"
              :loading="listLoading"
              :searchable="false"
              @select="select"
            >
              <template #empty>
                <EmptyState icon="i-lucide-messages-square" :title="$t('embed.chat.noConversations')" :description="$t('embed.chat.noConversationsDescription')" />
              </template>
            </ChatConversationList>
            <div class="border-t border-default p-3">
              <UButton block icon="i-lucide-square-pen" :label="$t('embed.chat.newMessage')" @click="startComposing" />
              <HumanNote v-if="!chatNotice" class="mt-2" />
              <ChatNotice v-else :text="chatNotice" class="mt-2" />
            </div>
          </div>

          <!-- Nothing picked yet, list is beside us -->
          <div v-else-if="!activeId && !composing" key="empty" class="absolute inset-0 flex items-center justify-center p-6">
            <EmptyState icon="i-lucide-messages-square" :title="$t('embed.chat.pickConversation')" :description="$t('embed.chat.pickConversationDescription')" />
          </div>

          <!-- New conversation -->
          <div v-else-if="composing" key="compose" class="absolute inset-0 flex flex-col">
            <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
              <ChatNotice :text="chatNotice" />
              <p class="text-[13px] text-muted">{{ $t('embed.chat.tellUs') }}</p>
              <div v-if="showTypePicker" class="space-y-1.5">
                <p class="section-label">{{ $t('embed.chat.whatCanWeHelp') }}</p>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="opt in typeOptions"
                    :key="opt.key"
                    type="button"
                    class="chip"
                    :class="selectedType === opt.key ? 'chip-active' : ''"
                    :aria-pressed="selectedType === opt.key"
                    @click="selectedType = opt.key"
                  >{{ opt.label }}</button>
                </div>
              </div>
              <div v-if="context" class="flex items-center gap-2.5 rounded-lg border border-default px-3 py-2 text-left">
                <img v-if="context.thumbnailUrl" :src="context.thumbnailUrl" alt="" class="size-9 rounded-lg object-cover shrink-0 bg-stone-100 dark:bg-stone-800">
                <UIcon v-else name="i-lucide-link" class="size-4 shrink-0 text-dimmed" />
                <span class="min-w-0 flex-1">
                  <span class="block text-xs font-semibold truncate">{{ $t('embed.chat.aboutContext', { label: context.label }) }}</span>
                  <span class="block text-[11px] text-stone-500 dark:text-stone-400 truncate">{{ context.type }}</span>
                </span>
                <button type="button" class="text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors" @click="context = null">{{ $t('embed.chat.remove') }}</button>
              </div>
              <UInput v-model="subject" :placeholder="$t('embed.chat.subjectOptional')" class="w-full" :maxlength="200" />
            </div>
            <ChatComposer v-model="draft" :placeholder="$t('embed.chat.yourMessage')" :error="threadError" :allow-attachments="project?.allowAttachments !== false" :upload="upload" @send="startConversation" @upload-error="threadError = $event">
              <template #below><HumanNote v-if="!chatNotice" class="mt-2" /></template>
            </ChatComposer>
          </div>

          <!-- Thread -->
          <div v-else key="thread" class="absolute inset-0 flex flex-col">
            <ChatNotice :text="chatNotice" class="pt-2" />
            <ChatTranscript
              v-model:thread="threadId"
              :messages="visibleMessages"
              own-sender="user"
              own-actor="user"
              :assistant-logo="project?.assistantLogoUrl"
              :read-at="activeConversation?.agentReadAt"
              :loading="threadLoading"
              @retry="retry"
              @discard="discard"
              @unsend="unsend"
              @react="react"
            >
              <template #empty>
                <EmptyState icon="i-lucide-message-square-dashed" :title="$t('embed.chat.noMessages')" :description="$t('embed.chat.noMessagesDescription')" />
              </template>
            </ChatTranscript>
            <ChatComposer v-model="draft" :placeholder="$t('embed.chat.message')" :error="threadError" :replying-to="replyingTo" :allow-attachments="project?.allowAttachments !== false" :upload="upload" @send="send" @cancel-reply="threadId = ''" @upload-error="threadError = $event">
              <template #below><HumanNote v-if="!chatNotice" class="mt-2" /></template>
            </ChatComposer>
          </div>
        </Transition>
      </div>
    </div>

    <p v-if="project?.poweredBy" class="shrink-0 pb-2 text-center text-[11px] leading-tight">
      <a :href="project.poweredBy.url" target="_blank" rel="noopener" class="text-dimmed transition-colors hover:text-muted">{{ $t('embed.poweredBy') }}</a>
    </p>
  </div>
</template>

<script setup lang="ts">
import type { Attachment, Context, Conversation, Message } from '#shared/support'
import { replyTarget, sortByCreatedAt } from '#shared/conversations'
import type { PublicProject } from '~~/server/utils/projects'
import type { SupportEvent } from '~~/server/utils/events'
import type { ChatListItem } from '~/components/chat/ChatConversationList.vue'
import { newOutboxId, useChatOutbox, type OutboxEntry } from '~/composables/useChatOutbox'
import { useMediaQuery } from '@vueuse/core'

// The chat an end user sees, inside the host site's iframe. The host's loader
// (public/widget.js) posts the identity token and an optional context; nothing
// here ever talks to the host app directly.

definePageMeta({ layout: 'bare' })

const route = useRoute()
const pk = String(route.query.pk || '')
// Inline embeds sit in the host's own layout: no close button, and when there's
// room the conversation list stays beside the thread.
const inline = route.query.inline === '1'
const wide = useMediaQuery('(min-width: 640px)')
const twoPane = computed(() => inline && wide.value)
const outbox = useChatOutbox()
const { t } = useI18n()

const project = ref<PublicProject | null>(null)
const token = ref<string | null>(null)
const parentOrigin = ref('')
const state = ref<'waiting' | 'ready'>('waiting')
const waitingText = ref(t('embed.chat.connecting'))

// Which way the next view slides: into a thread pushes, Back pops.
const nav = ref<'push' | 'pop'>('push')

const inSubview = computed(() => Boolean(activeId.value || composing.value))
// A first-time user (no conversations) lands straight on the form, so there's
// nowhere for Back to go until they have at least one thread.
const canGoBack = computed(() => Boolean(activeId.value) || hasConversations.value)
const headerTitle = computed(() => {
  if (composing.value) return t('embed.chat.newMessage')
  if (activeId.value) return activeConversation.value?.subject || project.value?.name || t('embed.chat.support')
  return project.value?.name ? t('embed.chat.supportFor', { name: project.value.name }) : t('embed.chat.support')
})
const headerNote = computed(() => {
  if (composing.value) return t('embed.chat.realPersonReplies')
  if (activeId.value && activeConversation.value?.status === 'done') return t('embed.chat.resolvedNote')
  return ''
})
const headerInitials = computed(() => (project.value?.name || 'S').trim().slice(0, 1).toUpperCase())
// A fixed, admin-set informational line for this project's chat. When present it
// governs the messaging, so the default "no AI here" note steps aside.
const chatNotice = computed(() => project.value?.chatNotice || '')

function startComposing() {
  nav.value = 'push'
  composing.value = true
}

useHead({ htmlAttrs: { style: computed(() => accentStyle(project.value?.theme?.accent)) } })

// ---- host bridge ----
function post(message: Record<string, unknown>) {
  if (window.parent === window) return
  window.parent.postMessage({ source: 'help-bites', ...message }, parentOrigin.value || '*')
}

function isAllowedOrigin(origin: string): boolean {
  const allowed = project.value?.allowedOrigins || []
  if (!allowed.length) return origin === window.location.origin
  return allowed.includes(origin) || origin === window.location.origin
}

let tokenResolvers: ((token: string) => void)[] = []
function requestToken(): Promise<string> {
  return new Promise((resolve) => {
    tokenResolvers.push(resolve)
    post({ type: 'token-needed' })
  })
}

function onMessage(event: MessageEvent) {
  // Only the host page itself, never another frame on it.
  if (event.source !== window.parent) return
  const data = event.data
  if (!data || data.source !== 'help-bites-host') return
  if (!isAllowedOrigin(event.origin)) {
    waitingText.value = t('embed.chat.originNotAllowed', { origin: event.origin })
    return
  }
  parentOrigin.value = event.origin
  if (data.type === 'token' && typeof data.token === 'string') {
    token.value = data.token
    for (const resolve of tokenResolvers) resolve(data.token)
    tokenResolvers = []
    if (state.value === 'waiting') {
      state.value = 'ready'
      void loadList()
    }
  }
  if (data.type === 'context') context.value = data.context || null
  if (data.type === 'open' && typeof data.conversationId === 'string') void select(data.conversationId)
}

// ---- api ----
// The workspace has used its plan's new conversations for the month. The
// server's wording names the plan, which is for the team, not the visitor.
class ConversationLimitReached extends Error {}

async function api<T = any>(path: string, options: { method?: 'GET' | 'POST' | 'DELETE', body?: unknown, retry?: boolean } = {}): Promise<T> {
  try {
    return await $fetch<T>(`/v1${path}`, { method: options.method || 'GET', body: options.body as any, headers: { Authorization: `Bearer ${token.value}` } })
  } catch (error: any) {
    const status = error?.statusCode || error?.status
    if (status === 401 && options.retry !== false) {
      token.value = await requestToken()
      return api<T>(path, { ...options, retry: false })
    }
    const data = error?.data?.data
    if (status === 402 && data?.code === 'plan_limit' && data.metric === 'conversations') throw new ConversationLimitReached(t('embed.chat.limitReached'))
    throw new Error(error?.data?.statusMessage || error?.message || t('embed.chat.requestFailed'))
  }
}

// ---- list ----
const conversations = ref<Conversation[]>([])
const hasConversations = computed(() => conversations.value.length > 0)
const listLoading = ref(false)
const composing = ref(false)
const context = ref<Context | null>(null)
const subject = ref('')

// ---- request type ----
// The admin can let users pick what a new conversation is about. '__other__'
// is the optional catch-all — it creates a plain support ticket (no type).
const OTHER_TYPE = '__other__'
const selectedType = ref('')
const typeOptions = computed<{ key: string, label: string }[]>(() => {
  const list = (project.value?.types || []).map(t => ({ key: t.key, label: t.name }))
  if (project.value?.allowOtherType) list.push({ key: OTHER_TYPE, label: t('embed.chat.other') })
  return list
})
const showTypePicker = computed(() => Boolean(project.value?.letUsersChooseType) && typeOptions.value.length > 1)
watch(typeOptions, (opts) => { if (!selectedType.value && opts.length) selectedType.value = opts[0]!.key }, { immediate: true })

async function loadList() {
  listLoading.value = true
  try {
    const result = await api<{ conversations: Conversation[], unreadCount: number }>('/conversations')
    conversations.value = result.conversations
    post({ type: 'unread', count: result.unreadCount })
    const wanted = typeof route.query.c === 'string' ? route.query.c : ''
    if (wanted && !activeId.value) void select(wanted)
    // No history yet → open the form directly instead of an empty list.
    else if (!conversations.value.length && !activeId.value && !composing.value) composing.value = true
  } catch (e: any) {
    waitingText.value = e?.message || t('embed.chat.loadConversationsError')
    state.value = 'waiting'
  } finally {
    listLoading.value = false
  }
}

const listItems = computed<ChatListItem[]>(() => conversations.value.map(c => ({
  id: c.id,
  title: c.subject || c.context?.label || project.value?.name || t('embed.chat.conversation'),
  preview: c.lastMessageFrom === 'user' ? t('embed.chat.youPreview', { text: c.lastMessagePreview }) : c.lastMessagePreview,
  timestamp: c.lastMessageAt,
  unreadCount: c.unreadByUser
})))

function upsertConversation(c: Conversation) {
  const index = conversations.value.findIndex(x => x.id === c.id)
  if (index === -1) conversations.value = [c, ...conversations.value]
  else conversations.value.splice(index, 1, c)
  conversations.value.sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || '')))
  post({ type: 'unread', count: conversations.value.reduce((sum, x) => sum + x.unreadByUser, 0) })
}

// ---- thread ----
const activeId = ref('')
const messages = ref<Message[]>([])
const sending = ref<Message[]>([])
const threadLoading = ref(false)
const threadError = ref('')
const threadId = ref('')
const draft = ref('')

const activeConversation = computed(() => conversations.value.find(c => c.id === activeId.value) || null)
const failed = computed<Message[]>(() => outbox.forScope(activeId.value || `new:${pk}`).map(entry => entryToMessage(entry, 'failed')))
const visibleMessages = computed(() => [...messages.value, ...sending.value, ...failed.value].sort(sortByCreatedAt))
const replyingTo = computed(() => replyTarget(visibleMessages.value, threadId.value, 'user'))

function entryToMessage(entry: OutboxEntry, delivery: 'pending' | 'failed'): Message {
  return { id: entry.id, conversationId: entry.conversationId, sender: 'user', senderName: t('embed.you'), body: entry.body, attachments: entry.attachments, reactions: [], context: (entry.context as Context) || null, replyToId: entry.replyToId, clientId: entry.id, visibility: 'public', kind: 'message', createdAt: entry.createdAt, delivery, deliveryError: delivery === 'failed' ? entry.error : '' }
}

async function select(id: string) {
  nav.value = 'push'
  activeId.value = id
  composing.value = false
  threadId.value = ''
  threadError.value = ''
  messages.value = []
  threadLoading.value = true
  try {
    const result = await api<{ conversation: Conversation, messages: Message[] }>(`/conversations/${id}/messages`)
    if (activeId.value !== id) return
    upsertConversation(result.conversation)
    messages.value = result.messages
    if (result.conversation.unreadByUser > 0) void markRead(id)
  } catch (e: any) {
    threadError.value = e?.message || t('embed.chat.loadConversationError')
  } finally {
    threadLoading.value = false
  }
}

function back() {
  nav.value = 'pop'
  activeId.value = ''
  composing.value = false
  threadError.value = ''
}

async function markRead(id: string) {
  const c = conversations.value.find(x => x.id === id)
  if (c) upsertConversation({ ...c, unreadByUser: 0, userReadAt: new Date().toISOString() })
  try {
    const { conversation } = await api<{ conversation: Conversation }>(`/conversations/${id}/read`, { method: 'POST' })
    upsertConversation(conversation)
  } catch {}
}

async function upload(file: File): Promise<Attachment> {
  const form = new FormData()
  form.append('file', file)
  try {
    return await $fetch<Attachment>('/v1/attachments', { method: 'POST', body: form, headers: { Authorization: `Bearer ${token.value}` } })
  } catch (error: any) {
    throw new Error(error?.data?.statusMessage || t('embed.chat.uploadError'))
  }
}

async function deliver(entry: OutboxEntry) {
  outbox.forget(entry.id)
  sending.value = [...sending.value.filter(m => m.id !== entry.id), entryToMessage(entry, 'pending')]
  try {
    if (entry.conversationId) {
      const result = await api<{ message: Message, conversation: Conversation }>(`/conversations/${entry.conversationId}/messages`, {
        method: 'POST',
        body: { body: entry.body, replyToId: entry.replyToId, attachments: entry.attachments, context: entry.context, clientId: entry.id }
      })
      if (entry.conversationId === activeId.value && !messages.value.some(m => m.id === result.message.id)) messages.value = [...messages.value, result.message]
      upsertConversation(result.conversation)
    } else {
      const result = await api<{ message: Message, conversation: Conversation }>('/conversations', {
        method: 'POST',
        body: { subject: entry.subject, body: entry.body, attachments: entry.attachments, context: entry.context, clientId: entry.id, ...(entry.type ? { type: entry.type } : {}) }
      })
      upsertConversation(result.conversation)
      activeId.value = result.conversation.id
      composing.value = false
      messages.value = [result.message]
    }
  } catch (e: any) {
    if (e instanceof ConversationLimitReached) {
      // A retry would be refused the same way, and the form has no thread to
      // show a failed message in: say why there and give the text back.
      threadError.value = e.message
      if (!draft.value) draft.value = entry.body
      if (!subject.value) subject.value = entry.subject
    } else {
      outbox.remember({ ...entry, error: e?.message || t('embed.chat.sendError') })
    }
  } finally {
    sending.value = sending.value.filter(m => m.id !== entry.id)
  }
}

function send(body: string, attachments: Attachment[]) {
  threadError.value = ''
  void deliver({ id: newOutboxId(), scope: activeId.value, body, subject: '', conversationId: activeId.value, replyToId: threadId.value, attachments, context: null, createdAt: new Date().toISOString(), error: '' })
}

function startConversation(body: string, attachments: Attachment[]) {
  threadError.value = ''
  const type = selectedType.value && selectedType.value !== OTHER_TYPE ? selectedType.value : ''
  void deliver({ id: newOutboxId(), scope: `new:${pk}`, body, subject: subject.value.trim(), type, conversationId: '', replyToId: '', attachments, context: context.value as Record<string, unknown> | null, createdAt: new Date().toISOString(), error: '' })
  subject.value = ''
}

function retry(message: Message) {
  const entry = outbox.forScope(activeId.value || `new:${pk}`).find(e => e.id === message.id)
  if (entry) void deliver(entry)
}

function discard(message: Message) {
  outbox.forget(message.id)
}

async function unsend(message: Message) {
  messages.value = messages.value.filter(m => m.id !== message.id)
  try {
    await api(`/messages/${message.id}`, { method: 'DELETE' })
  } catch (e: any) {
    threadError.value = e?.message || t('embed.chat.unsendError')
    void select(activeId.value)
  }
}

function replaceMessage(updated: Message) {
  const index = messages.value.findIndex(m => m.id === updated.id)
  if (index === -1) return
  messages.value = [...messages.value.slice(0, index), updated, ...messages.value.slice(index + 1)]
}

async function react(message: Message, emoji: string) {
  if (message.delivery || !message.id) return
  try {
    const result = await api<{ message: Message }>(`/messages/${message.id}/reactions`, { method: 'POST', body: { emoji } })
    replaceMessage(result.message)
  } catch (e: any) {
    threadError.value = e?.message || t('embed.chat.reactError')
  }
}

// ---- live ----
useEventStream(computed(() => (state.value === 'ready' ? '/v1/events' : null)), token, (event: SupportEvent) => {
  upsertConversation(event.conversation)
  if (event.type === 'message.created' && event.conversationId === activeId.value) {
    if (!messages.value.some(m => m.id === event.message.id)) messages.value = [...messages.value, event.message]
    if (event.message.sender === 'agent') void markRead(activeId.value)
  } else if (event.type === 'message.updated' && event.conversationId === activeId.value) {
    replaceMessage(event.message)
  } else if (event.type === 'message.deleted' && event.conversationId === activeId.value) {
    messages.value = messages.value.filter(m => m.id !== event.messageId)
  }
}, () => { void loadList(); if (activeId.value) void select(activeId.value) })

onMounted(async () => {
  outbox.hydrate()
  window.addEventListener('message', onMessage)
  // Standalone mode (no host frame): a token in the URL, for demos and tests.
  const direct = takeUrlToken()
  try {
    project.value = await $fetch<PublicProject>(`/v1/projects/${pk}/public`)
  } catch {
    waitingText.value = t('embed.chat.unknownProject')
    return
  }
  if (direct) {
    token.value = direct
    state.value = 'ready'
    void loadList()
  } else {
    post({ type: 'ready' })
    waitingText.value = t('embed.chat.waitingForSignIn')
  }
})

onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>
