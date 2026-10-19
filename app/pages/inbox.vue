<template>
  <div class="flex min-h-0 flex-1">
    <aside class="flex min-h-0 w-full shrink-0 flex-col border-r border-default md:w-80 lg:w-96 xl:w-[26rem]" :class="activeId ? 'hidden md:flex' : 'flex'">
      <header class="flex h-12 shrink-0 items-center gap-1 border-b border-default pl-4 pr-2">
        <UInput
          v-if="searchOpen"
          v-model="searchQuery"
          icon="i-lucide-search"
          placeholder="Search conversations"
          variant="none"
          size="sm"
          autofocus
          class="min-w-0 flex-1"
          :ui="{ base: 'ps-6 pe-1', leading: 'ps-0' }"
          aria-label="Search conversations"
          @update:model-value="scheduleLoad"
          @keydown.esc="closeSearch"
        />
        <h1 v-else class="mr-auto text-[13px] font-medium text-highlighted">Inbox</h1>
        <UTooltip :text="searchOpen ? 'Close search' : 'Search'">
          <UButton :icon="searchOpen ? 'i-lucide-x' : 'i-lucide-search'" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="searchOpen ? 'Close search' : 'Search conversations'" @click="searchOpen ? closeSearch() : (searchOpen = true)" />
        </UTooltip>
        <UPopover :content="{ align: 'end' }">
          <UChip :show="filtersActive" size="sm" inset>
            <UButton icon="i-lucide-list-filter" color="neutral" variant="ghost" size="sm" square class="text-muted" aria-label="Filter conversations" />
          </UChip>
          <template #content>
            <div class="grid w-72 grid-cols-2 gap-2 p-3">
              <p class="section-label col-span-2">Filter</p>
              <USelect v-model="projectFilter" :items="projectItems" size="sm" class="col-span-2" aria-label="Project" @update:model-value="loadList()" />
              <USelect v-model="statusFilter" :items="statusFilterItems" size="sm" aria-label="Status" @update:model-value="loadList()" />
              <USelect v-model="priorityFilter" :items="priorityFilterItems" size="sm" aria-label="Priority" @update:model-value="loadList()" />
              <UInput v-model="typeFilter" placeholder="Ticket type" size="sm" class="col-span-2" aria-label="Ticket type" @update:model-value="scheduleLoad" />
              <UButton v-if="filtersActive" label="Clear filters" color="neutral" variant="ghost" size="sm" class="col-span-2 justify-center" @click="clearFilters" />
            </div>
          </template>
        </UPopover>
        <UTooltip text="Refresh">
          <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" square class="text-muted" aria-label="Refresh queue" :loading="listLoading" @click="loadList()" />
        </UTooltip>
        <UTooltip text="New conversation" :kbds="['c']">
          <UButton icon="i-lucide-square-pen" color="neutral" variant="ghost" size="sm" square class="text-muted" aria-label="New conversation" @click="showNewChat = true" />
        </UTooltip>
      </header>

      <div class="flex shrink-0 gap-1 overflow-x-auto px-3 py-2.5 [scrollbar-width:none]" role="tablist" aria-label="Queue views">
        <button v-for="item in viewItems" :key="item.key" type="button" role="tab" :aria-selected="view === item.key" class="chip h-6 px-2.5 text-xs" :class="view === item.key ? 'chip-active' : ''" @click="view = item.key">
          {{ item.label }}<span class="tabular-nums text-dimmed">{{ item.count }}</span>
        </button>
      </div>

      <p v-if="listError" class="px-4 pb-2 text-[13px] text-error">{{ listError }}</p>
      <ChatConversationList
        :items="listItems"
        :active-id="activeId"
        :loading="listLoading"
        :searchable="false"
        empty-text="No conversations here. New customer messages will appear in this queue."
        @select="select"
        @toggle-read="toggleRead"
        @toggle-done="toggleDone"
      >
        <template #empty>
          <EmptyState icon="i-lucide-inbox" title="Nothing in this view" description="New customer messages land here as they arrive." />
        </template>
      </ChatConversationList>
      <button v-if="hasMore" type="button" class="h-10 shrink-0 border-t border-default text-[13px] font-medium text-muted transition-colors hover:bg-elevated hover:text-highlighted" @click="loadList(true)">Load older conversations</button>
    </aside>

    <section class="flex min-w-0 flex-1 flex-col" :class="activeId ? 'flex' : 'hidden md:flex'">
      <EmptyState v-if="!activeId" icon="i-lucide-messages-square" title="Pick a conversation" description="Its full history, the customer and the ticket open here." class="flex-1" />
      <template v-else>
        <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default px-2 sm:px-4">
          <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="sm" square class="md:hidden" aria-label="Back to inbox" @click="select('')" />
          <nav class="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium" aria-label="Breadcrumb">
            <template v-if="activeProject">
              <NuxtLink :to="`/projects/${activeProject.id}/overview`" class="hidden min-w-0 shrink items-center gap-2 text-muted transition-colors hover:text-highlighted sm:flex">
                <ProjectDot tile :project-id="activeProject.id" :accent="activeProject.theme?.accent" :name="activeProject.name" :icon-url="activeProject.iconUrl" />
                <span class="truncate">{{ activeProject.name }}</span>
              </NuxtLink>
              <UIcon name="i-lucide-chevron-right" class="hidden size-3.5 shrink-0 text-dimmed sm:block" />
            </template>
            <h2 class="truncate text-highlighted">{{ activeUser?.name || activeUser?.email || activeUser?.externalId || 'Conversation' }}</h2>
            <span v-if="activeConversation?.subject || activeConversation?.context?.label" class="hidden truncate font-normal text-muted lg:inline">{{ activeConversation?.subject || activeConversation?.context?.label }}</span>
          </nav>
          <USelect v-if="activeConversation" :model-value="activeConversation.status" :items="statusItems" color="neutral" variant="outline" size="sm" class="w-auto xl:hidden" :ui="{ base: 'rounded-full' }" aria-label="Status" @update:model-value="setStatus(activeId, String($event))">
            <template #leading><StatusIcon :category="activeConversation.statusCategory" /></template>
          </USelect>
          <UTooltip text="Details">
            <UButton icon="i-lucide-panel-right" color="neutral" variant="ghost" size="sm" square class="text-muted xl:hidden" aria-label="Open conversation details" @click="showContext = true" />
          </UTooltip>
        </header>

        <div class="flex min-h-0 flex-1">
          <div class="flex min-w-0 flex-1 flex-col">
            <ChatTranscript
              ref="transcriptRef"
              v-model:thread="threadId"
              :messages="visibleMessages"
              own-sender="agent"
              :own-actor="ownActor"
              :assistant-logo="activeProject?.assistantLogoUrl"
              :read-at="activeConversation?.userReadAt"
              :loading="threadLoading"
              :has-earlier="hasEarlier"
              :loading-earlier="loadingEarlier"
              @load-earlier="loadEarlier"
              @retry="retry"
              @discard="discard"
              @unsend="unsend"
              @react="react"
            >
              <template #empty><EmptyState icon="i-lucide-message-square-dashed" title="No messages yet" description="Write the first one. It reaches the customer in the widget and by email." /></template>
            </ChatTranscript>

            <ChatComposer
              v-model="draft"
              :placeholder="internalNote ? 'Add an internal note…' : 'Reply to the customer…'"
              :error="threadError"
              :replying-to="replyingTo"
              :allow-attachments="activeProject?.allowAttachments !== false"
              :upload="upload"
              :class="internalNote ? 'composer-note' : ''"
              @send="send"
              @cancel-reply="threadId = ''"
              @upload-error="threadError = $event"
            >
              <template #above>
                <div class="mb-2 flex items-center gap-1.5" role="tablist" aria-label="Message type">
                  <button type="button" role="tab" :aria-selected="!internalNote" class="chip h-6 px-2.5 text-xs" :class="!internalNote ? 'chip-active' : ''" @click="internalNote = false"><UIcon name="i-lucide-reply" class="size-3.5" />Reply</button>
                  <button type="button" role="tab" :aria-selected="internalNote" class="chip h-6 px-2.5 text-xs" :class="internalNote ? 'chip-active' : ''" @click="internalNote = true"><UIcon name="i-lucide-lock-keyhole" class="size-3.5" />Internal note</button>
                </div>
              </template>
              <template #below>
                <label v-if="!internalNote" class="mt-2 flex items-center gap-2 px-1 text-xs text-muted"><USwitch v-model="notifyByEmail" size="xs" />Also email {{ activeUser?.email || 'this customer' }}</label>
                <p v-else class="mt-2 px-1 text-xs text-muted"><UIcon name="i-lucide-lock-keyhole" class="mr-1 inline size-3 align-[-1px] text-warning" />Only your team sees internal notes.</p>
              </template>
            </ChatComposer>
          </div>
          <InboxConversationContext
            v-if="activeConversation && activeUser"
            class="hidden w-72 shrink-0 border-l border-default xl:flex"
            :conversation="activeConversation"
            :user="activeUser"
            :project="activeProject"
            :type="activeType"
            :agents="humanAgents"
            :last-user-message="lastUserMessage"
            @triage="setTriage"
            @action="runAction"
          />
        </div>
      </template>
    </section>

    <USlideover v-model:open="showContext" class="xl:hidden" title="Details" :ui="{ content: 'max-w-80', body: 'p-0 sm:p-0' }">
      <template #body>
        <InboxConversationContext v-if="activeConversation && activeUser" class="h-full" :conversation="activeConversation" :user="activeUser" :project="activeProject" :type="activeType" :agents="humanAgents" :last-user-message="lastUserMessage" @triage="setTriage" @action="runAction" />
      </template>
    </USlideover>

    <NewChatModal v-model:open="showNewChat" :projects="projects" :default-project-id="projectFilter === 'all' ? '' : projectFilter" @created="onCreated" />
  </div>
</template>

<script setup lang="ts">
import type { Attachment, Conversation, ConversationAction, ConversationType, Message } from '#shared/support'
import { replyTarget, sortByCreatedAt } from '#shared/conversations'
import type { SupportEvent } from '~~/server/utils/events'
import type { ChatListItem } from '~/components/chat/ChatConversationList.vue'
import type { InboxEndUser } from '~/components/inbox/ConversationContext.vue'
import { newOutboxId, useChatOutbox, type OutboxEntry } from '~/composables/useChatOutbox'

definePageMeta({ middleware: 'agent' })

type QueueView = 'all' | 'unassigned' | 'mine' | 'open' | 'unread'
type QueueCounts = { status: Record<string, number>, type: Record<string, number>, assignee: Record<string, number> }
type HumanAgent = { id: string, username: string, email: string, name: string }

const { api, token, agent, projects, loadProjects, agentHeaders } = useAgent()
const route = useRoute()
const router = useRouter()
const outbox = useChatOutbox()
const totalUnread = useState<number>('inbox-total-unread', () => 0)

const conversations = ref<Conversation[]>([])
const endUsers = ref<Record<string, InboxEndUser>>({})
const listLoading = ref(false)
const listError = ref('')
const hasMore = ref(false)
const queueCounts = ref<QueueCounts>({ status: {}, type: {}, assignee: {} })
const view = ref<QueueView>('all')
const projectFilter = ref('all')
const statusFilter = ref('any')
const priorityFilter = ref('any')
const typeFilter = ref('')
const searchQuery = ref('')
const searchOpen = ref(false)
// Shared with the sidebar's compose button and the C shortcut.
const showNewChat = useState('compose-open', () => false)
const showContext = ref(false)
const typesByProject = ref<Record<string, ConversationType[]>>({})
const humanAgents = ref<HumanAgent[]>([])
let searchTimer: ReturnType<typeof setTimeout> | null = null

const projectsById = computed(() => Object.fromEntries(projects.value.map(project => [project.id, project])))
const projectItems = computed(() => [{ label: 'All projects', value: 'all' }, ...projects.value.map(project => ({ label: project.name, value: project.id }))])
const statusFilterItems = [{ label: 'Any status', value: 'any' }, { label: 'Open', value: 'open' }, { label: 'Done', value: 'done' }]
const priorityFilterItems = [{ label: 'Any priority', value: 'any' }, { label: 'Low', value: 'low' }, { label: 'Normal', value: 'normal' }, { label: 'High', value: 'high' }, { label: 'Urgent', value: 'urgent' }]
const viewItems = computed(() => [
  { key: 'all' as const, label: 'All', count: conversations.value.length },
  { key: 'unassigned' as const, label: 'Unassigned', count: queueCounts.value.assignee.unassigned || 0 },
  { key: 'mine' as const, label: 'Mine', count: agent.value?.id ? queueCounts.value.assignee[agent.value.id] || 0 : 0 },
  { key: 'open' as const, label: 'Open', count: queueCounts.value.status.open || 0 },
  { key: 'unread' as const, label: 'Unread', count: totalUnread.value }
])

function scheduleLoad() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadList(), 250)
}
function closeSearch() {
  searchOpen.value = false
  if (searchQuery.value) { searchQuery.value = ''; void loadList() }
}
const filtersActive = computed(() => projectFilter.value !== 'all' || statusFilter.value !== 'any' || priorityFilter.value !== 'any' || Boolean(typeFilter.value))
function clearFilters() {
  projectFilter.value = 'all'; statusFilter.value = 'any'; priorityFilter.value = 'any'; typeFilter.value = ''
  void loadList()
}

async function loadList(more = false) {
  listLoading.value = true
  listError.value = ''
  try {
    const last = more ? conversations.value[conversations.value.length - 1] : null
    const result = await api<{ conversations: Conversation[], endUsers: Record<string, InboxEndUser>, hasMore: boolean, totalUnread: number, counts: QueueCounts }>('/admin/conversations', {
      query: { project: projectFilter.value === 'all' ? undefined : projectFilter.value, status: statusFilter.value === 'any' ? undefined : statusFilter.value, priority: priorityFilter.value === 'any' ? undefined : priorityFilter.value, type: typeFilter.value || undefined, q: searchQuery.value.trim() || undefined, before: last?.lastMessageAt || undefined }
    })
    conversations.value = more ? [...conversations.value, ...result.conversations] : result.conversations
    endUsers.value = { ...endUsers.value, ...result.endUsers }
    hasMore.value = result.hasMore
    totalUnread.value = result.totalUnread
    queueCounts.value = result.counts
  } catch (error: any) {
    listError.value = error?.message || 'Could not load the inbox'
  } finally { listLoading.value = false }
}

const filteredConversations = computed(() => conversations.value.filter((conversation) => {
  if (view.value === 'unassigned') return !conversation.assigneeId
  if (view.value === 'mine') return conversation.assigneeId === agent.value?.id
  if (view.value === 'open') return conversation.statusCategory === 'open' || conversation.status === 'open'
  if (view.value === 'unread') return conversation.unreadByAgent > 0
  return true
}))
const listItems = computed<ChatListItem[]>(() => filteredConversations.value.map((conversation) => {
  const user = endUsers.value[conversation.endUserId]
  const project = projectsById.value[conversation.projectId]
  return { id: conversation.id, title: user?.name || user?.email || user?.externalId || 'Unknown customer', subtitle: conversation.subject || conversation.context?.label || '', preview: conversation.lastMessageFrom === 'agent' ? `You: ${conversation.lastMessagePreview}` : conversation.lastMessagePreview, timestamp: conversation.lastMessageAt, unreadCount: conversation.unreadByAgent, projectId: conversation.projectId, projectName: project?.name, projectAccent: project?.theme?.accent, projectIconUrl: project?.iconUrl, priority: conversation.priority, done:conversation.statusCategory === 'resolved' || conversation.statusCategory === 'closed' || conversation.status === 'done' }
}))

const activeId = ref('')
const activeUser = ref<InboxEndUser | null>(null)
const messages = ref<Message[]>([])
const sending = ref<Message[]>([])
const threadLoading = ref(false)
const hasEarlier = ref(false)
const loadingEarlier = ref(false)
const threadError = ref('')
const threadId = ref('')
const draft = ref('')
const notifyByEmail = ref(true)
const internalNote = ref(false)
const transcriptRef = ref<{ scrollToLatest: () => void } | null>(null)

const activeConversation = computed(() => conversations.value.find(conversation => conversation.id === activeId.value) || null)
const activeProject = computed(() => activeConversation.value ? projectsById.value[activeConversation.value.projectId] || null : null)
const activeType = computed(() => typesByProject.value[activeConversation.value?.projectId || '']?.find(type => type.key === activeConversation.value?.type) || null)
const statusItems = computed(() => (activeType.value?.statuses || [{ key: 'open', label: 'Open' }, { key: 'done', label: 'Done' }]).map(status => ({ label: status.label, value: status.key })))
const failed = computed<Message[]>(() => outbox.forScope(activeId.value).map(entry => entryToMessage(entry, 'failed')))
const visibleMessages = computed(() => [...messages.value, ...sending.value, ...failed.value].sort(sortByCreatedAt))
// What a board item filed from the context panel starts with.
const lastUserMessage = computed(() => [...messages.value].reverse().find(message => message.sender === 'user' && message.kind === 'message' && message.body)?.body || '')
const replyingTo = computed(() => replyTarget(visibleMessages.value, threadId.value, 'agent'))
const ownActor = computed(() => (agent.value?.id ? `agent:${agent.value.id}` : 'agent'))

function entryToMessage(entry: OutboxEntry, delivery: 'pending' | 'failed'): Message {
  return { id: entry.id, conversationId: entry.conversationId, sender: 'agent', senderName: 'You', body: entry.body, attachments: entry.attachments, reactions: [], context: null, replyToId: entry.replyToId, clientId: entry.id, visibility: 'public', kind: 'message', createdAt: entry.createdAt, delivery, deliveryError: delivery === 'failed' ? entry.error : '' }
}

async function select(id: string) {
  activeId.value = id; threadId.value = ''; threadError.value = ''; messages.value = []; hasEarlier.value = false; activeUser.value = null; showContext.value = false
  await router.replace({ query: id ? { c: id } : {} })
  if (!id) return
  threadLoading.value = true
  try {
    const [detail, list] = await Promise.all([api<{ conversation: Conversation, endUser: InboxEndUser }>(`/admin/conversations/${id}`), api<{ messages: Message[], hasMore: boolean }>(`/admin/conversations/${id}/messages`)])
    if (activeId.value !== id) return
    activeUser.value = detail.endUser
    upsertConversation(detail.conversation)
    await loadTypes(detail.conversation.projectId)
    messages.value = list.messages
    hasEarlier.value = list.hasMore
    notifyByEmail.value = Boolean(detail.endUser.email)
    if (detail.conversation.unreadByAgent > 0) void markRead(id, true)
  } catch (error: any) { threadError.value = error?.message || 'Could not load the conversation' } finally { threadLoading.value = false }
}

async function loadEarlier() {
  const id = activeId.value
  const first = messages.value[0]
  if (!id || !first || loadingEarlier.value) return
  loadingEarlier.value = true
  try {
    const page = await api<{ messages: Message[], hasMore: boolean }>(`/admin/conversations/${id}/messages`, { query: { before: first.createdAt } })
    if (activeId.value !== id) return
    const known = new Set(messages.value.map(message => message.id))
    messages.value = [...page.messages.filter(message => !known.has(message.id)), ...messages.value]
    hasEarlier.value = page.hasMore
  } catch (error: any) { threadError.value = error?.message || 'Could not load earlier messages' } finally { loadingEarlier.value = false }
}

async function loadTypes(projectId: string) {
  if (typesByProject.value[projectId]) return
  try { const { types } = await api<{ types: ConversationType[] }>(`/admin/projects/${projectId}/types`); typesByProject.value = { ...typesByProject.value, [projectId]: types } } catch { /* The built-in support type remains usable. */ }
}
function upsertConversation(conversation: Conversation) {
  const index = conversations.value.findIndex(item => item.id === conversation.id)
  if (index === -1) conversations.value = [conversation, ...conversations.value]
  else conversations.value.splice(index, 1, conversation)
  conversations.value.sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || '')))
}
async function markRead(id: string, read: boolean) {
  const conversation = conversations.value.find(item => item.id === id)
  if (!conversation) return
  const next = read ? 0 : (conversation.unreadByAgent || 1)
  totalUnread.value = Math.max(0, totalUnread.value - conversation.unreadByAgent + next)
  upsertConversation({ ...conversation, unreadByAgent: next, agentReadAt: read ? new Date().toISOString() : null })
  try { const { conversation: updated } = await api<{ conversation: Conversation }>(`/admin/conversations/${id}/read`, { method: 'POST', body: { read } }); upsertConversation(updated) } catch {}
}
function toggleRead(id: string) { const conversation = conversations.value.find(item => item.id === id); if (conversation) void markRead(id, conversation.unreadByAgent > 0) }
async function toggleDone(id: string) {
  const conversation = conversations.value.find(item => item.id === id)
  if (!conversation) return
  // The quick toggle must respect the conversation's type: not every type has a
  // `done` status (a report closes to `actioned`/`rejected`). Close to the type's
  // first terminal status and reopen to its default open one; fall back to the
  // built-in support keys when the type has not loaded.
  await loadTypes(conversation.projectId)
  const statuses = typesByProject.value[conversation.projectId]?.find(type => type.key === conversation.type)?.statuses || []
  const isDone = conversation.statusCategory === 'resolved' || conversation.statusCategory === 'closed' || conversation.status === 'done'
  const openKey = statuses.find(status => status.isDefault)?.key || statuses.find(status => status.category === 'open')?.key || 'open'
  const doneKey = statuses.find(status => status.isTerminal)?.key || statuses.find(status => status.category === 'resolved' || status.category === 'closed')?.key || 'done'
  void setStatus(id, isDone ? openKey : doneKey)
}
async function setStatus(id: string, status: string) {
  const conversation = conversations.value.find(item => item.id === id)
  if (!conversation || !status) return
  upsertConversation({ ...conversation, status })
  try { const { conversation: updated } = await api<{ conversation: Conversation }>(`/admin/conversations/${id}/status`, { method: 'POST', body: { status } }); upsertConversation(updated) } catch (error: any) { threadError.value = error?.message || 'Could not update ticket'; void loadList() }
}
async function setTriage(body: Record<string, unknown>) {
  if (!activeId.value) return
  try { const { conversation } = await api<{ conversation: Conversation }>(`/admin/conversations/${activeId.value}`, { method: 'PATCH', body }); upsertConversation(conversation) } catch (error: any) { threadError.value = error?.message || 'Could not update ticket' }
}
async function upload(file: File): Promise<Attachment> {
  const form = new FormData(); form.append('file', file); form.append('conversationId', activeId.value)
  return await $fetch<Attachment>('/v1/admin/attachments', { method: 'POST', body: form, headers: agentHeaders() })
}
async function deliver(entry: OutboxEntry) {
  outbox.forget(entry.id); sending.value = [...sending.value.filter(message => message.id !== entry.id), entryToMessage(entry, 'pending')]
  try {
    const result = await api<{ message: Message, conversation: Conversation, emailSent: boolean, emailError: string }>(`/admin/conversations/${entry.conversationId}/messages`, { method: 'POST', body: { body: entry.body, replyToId: entry.replyToId, attachments: entry.attachments, clientId: entry.id, notifyByEmail: notifyByEmail.value } })
    if (entry.conversationId === activeId.value && !messages.value.some(message => message.id === result.message.id)) messages.value = [...messages.value, result.message]
    upsertConversation(result.conversation)
    if (notifyByEmail.value && !result.emailSent && result.emailError && result.emailError !== 'throttled') threadError.value = `Sent, but the email failed: ${result.emailError}`
  } catch (error: any) { outbox.remember({ ...entry, error: error?.message || 'Could not send' }) } finally { sending.value = sending.value.filter(message => message.id !== entry.id) }
}
function send(body: string, attachments: Attachment[]) {
  if (!activeId.value) return
  threadError.value = ''
  if (internalNote.value) { void sendNote(body); return }
  void deliver({ id: newOutboxId(), scope: activeId.value, body, subject: '', conversationId: activeId.value, replyToId: threadId.value, attachments, context: null, createdAt: new Date().toISOString(), error: '' })
}
async function sendNote(body: string) { try { const { message } = await api<{ message: Message }>(`/admin/conversations/${activeId.value}/notes`, { method: 'POST', body: { body } }); messages.value = [...messages.value, message]; internalNote.value = false } catch (error: any) { threadError.value = error?.message || 'Could not add internal note' } }
async function runAction(action: ConversationAction) {
  if (!activeId.value || (action.confirm && !confirm(action.confirm))) return
  const note = action.requiresNote ? prompt('Internal note for this action:') : ''
  if (action.requiresNote && !note) return
  try { const result = await api<{ conversation: Conversation, event: Message }>(`/admin/conversations/${activeId.value}/actions/${action.key}`, { method: 'POST', body: note ? { note } : {} }); upsertConversation(result.conversation); messages.value = [...messages.value, result.event] } catch (error: any) { threadError.value = error?.message || 'Could not run host action' }
}
function retry(message: Message) { const entry = outbox.forScope(activeId.value).find(item => item.id === message.id); if (entry) void deliver(entry) }
function discard(message: Message) { outbox.forget(message.id) }
async function unsend(message: Message) {
  if (!confirm('Delete this message? It disappears for the customer too.')) return
  messages.value = messages.value.filter(item => item.id !== message.id); try { await api(`/admin/messages/${message.id}`, { method: 'DELETE' }) } catch (error: any) { threadError.value = error?.message || 'Could not unsend'; void select(activeId.value) }
}
function replaceMessage(updated: Message) {
  const index = messages.value.findIndex(item => item.id === updated.id)
  if (index === -1) return
  messages.value = [...messages.value.slice(0, index), updated, ...messages.value.slice(index + 1)]
}
async function react(message: Message, emoji: string) {
  if (message.delivery || !message.id) return
  try { const { message: updated } = await api<{ message: Message }>(`/admin/messages/${message.id}/reactions`, { method: 'POST', body: { emoji } }); replaceMessage(updated) } catch (error: any) { threadError.value = error?.message || 'Could not react' }
}
async function onCreated(conversationId: string) { await loadList(); await select(conversationId) }

useEventStream(computed(() => '/v1/admin/events'), token, (event: SupportEvent) => {
  upsertConversation(event.conversation)
  if (event.type === 'message.created') {
    if (event.message.sender === 'user' && event.conversationId !== activeId.value) totalUnread.value += 1
    if (event.conversationId === activeId.value) { if (!messages.value.some(message => message.id === event.message.id)) messages.value = [...messages.value, event.message]; if (event.message.sender === 'user') void markRead(activeId.value, true) }
  } else if (event.type === 'message.updated' && event.conversationId === activeId.value) {
    replaceMessage(event.message)
  } else if (event.type === 'message.deleted' && event.conversationId === activeId.value) messages.value = messages.value.filter(message => message.id !== event.messageId)
}, () => { void loadList(); if (activeId.value) void select(activeId.value) })

onMounted(async () => {
  outbox.hydrate()
  // Deep-link from a project's Conversations section: ?project scopes the queue, ?c opens a thread.
  if (typeof route.query.project === 'string' && route.query.project) projectFilter.value = route.query.project
  await Promise.all([loadProjects(), loadList(), api<{ agents: HumanAgent[] }>('/admin/agents').then(result => { humanAgents.value = result.agents }).catch(() => {})])
  const initial = typeof route.query.c === 'string' ? route.query.c : ''
  if (initial) void select(initial)
})
</script>

<style scoped>
/* Writing a note tints the comment box, so it's never mistaken for a reply. */
.composer-note :deep(.composer-card) { border-color: color-mix(in oklab, var(--ui-warning) 45%, transparent); background-color: color-mix(in oklab, var(--ui-warning) 5%, var(--ui-bg)); }
</style>
