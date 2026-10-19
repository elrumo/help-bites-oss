<template>
  <div class="flex min-h-0 flex-1">
    <aside class="flex min-h-0 w-full shrink-0 flex-col border-r border-default md:w-80 lg:w-96 xl:w-[26rem]" :class="activeId ? 'hidden md:flex' : 'flex'">
      <header class="flex h-12 shrink-0 items-center gap-1 border-b border-default pl-4 pr-2">
        <UInput
          v-if="searchOpen"
          v-model="searchQuery"
          icon="i-lucide-search"
          :placeholder="$t('inbox.searchPlaceholder')"
          variant="none"
          size="sm"
          autofocus
          class="min-w-0 flex-1"
          :ui="{ base: 'ps-6 pe-1', leading: 'ps-0' }"
          :aria-label="$t('inbox.searchPlaceholder')"
          @update:model-value="scheduleLoad"
          @keydown.esc="closeSearch"
        />
        <h1 v-else class="mr-auto text-[13px] font-medium text-highlighted">{{ $t('nav.inbox') }}</h1>
        <UTooltip :text="searchOpen ? $t('inbox.closeSearch') : $t('common.search')">
          <UButton :icon="searchOpen ? 'i-lucide-x' : 'i-lucide-search'" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="searchOpen ? $t('inbox.closeSearch') : $t('inbox.searchPlaceholder')" @click="searchOpen ? closeSearch() : (searchOpen = true)" />
        </UTooltip>
        <UPopover :content="{ align: 'end' }">
          <UChip :show="filtersActive" size="sm" inset>
            <UButton icon="i-lucide-list-filter" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="$t('inbox.filterConversations')" />
          </UChip>
          <template #content>
            <div class="grid w-72 grid-cols-2 gap-2 p-3">
              <p class="section-label col-span-2">{{ $t('inbox.filter') }}</p>
              <USelect v-model="projectFilter" :items="projectItems" size="sm" class="col-span-2" :aria-label="$t('inbox.project')" @update:model-value="loadList()" />
              <USelect v-model="statusFilter" :items="statusFilterItems" size="sm" :aria-label="$t('inbox.status')" @update:model-value="loadList()" />
              <USelect v-model="priorityFilter" :items="priorityFilterItems" size="sm" :aria-label="$t('inbox.priority')" @update:model-value="loadList()" />
              <UInput v-model="typeFilter" :placeholder="$t('inbox.ticketType')" size="sm" class="col-span-2" :aria-label="$t('inbox.ticketType')" @update:model-value="scheduleLoad" />
              <UButton v-if="filtersActive" :label="$t('inbox.clearFilters')" color="neutral" variant="ghost" size="sm" class="col-span-2 justify-center" @click="clearFilters" />
            </div>
          </template>
        </UPopover>
        <UTooltip :text="$t('inbox.refresh')">
          <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="$t('inbox.refreshQueue')" :loading="listLoading" @click="loadList()" />
        </UTooltip>
        <UTooltip :text="$t('nav.newConversation')" :kbds="['c']">
          <UButton icon="i-lucide-square-pen" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="$t('nav.newConversation')" @click="showNewChat = true" />
        </UTooltip>
      </header>

      <div class="flex shrink-0 gap-1 overflow-x-auto px-3 py-2.5 [scrollbar-width:none]" role="tablist" :aria-label="$t('inbox.queueViews')">
        <button v-for="item in viewItems" :key="item.key" type="button" role="tab" :aria-selected="view === item.key" class="chip h-6 px-2.5 text-xs" :class="view === item.key ? 'chip-active' : ''" @click="setView(item.key)">
          {{ item.label }}<span class="tabular-nums text-dimmed">{{ item.count }}</span>
        </button>
      </div>

      <p v-if="listError" class="px-4 pb-2 text-[13px] text-error">{{ listError }}</p>
      <ChatConversationList
        :items="listItems"
        :active-id="activeId"
        :loading="listLoading"
        :searchable="false"
        :empty-text="$t('inbox.emptyQueue')"
        @select="select"
        @toggle-read="toggleRead"
        @toggle-done="toggleDone"
        @toggle-archive="toggleArchive"
        @delete="remove"
      >
        <template #empty>
          <EmptyState v-if="view === 'archived'" icon="i-lucide-archive" :title="$t('inbox.nothingArchived')" :description="$t('inbox.nothingArchivedDescription')" />
          <EmptyState v-else icon="i-lucide-inbox" :title="$t('inbox.nothingInView')" :description="$t('inbox.nothingInViewDescription')" />
        </template>
      </ChatConversationList>
      <button v-if="hasMore" type="button" class="h-10 shrink-0 border-t border-default text-[13px] font-medium text-muted transition-colors hover:bg-elevated hover:text-highlighted" @click="loadList(true)">{{ $t('inbox.loadOlder') }}</button>
    </aside>

    <section class="flex min-w-0 flex-1 flex-col" :class="activeId ? 'flex' : 'hidden md:flex'">
      <EmptyState v-if="!activeId" icon="i-lucide-messages-square" :title="$t('inbox.pickConversation')" :description="$t('inbox.pickConversationDescription')" class="flex-1" />
      <template v-else>
        <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default px-2 sm:px-4">
          <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="sm" square class="md:hidden" :aria-label="$t('inbox.backToInbox')" @click="select('')" />
          <nav class="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium" :aria-label="$t('inbox.breadcrumb')">
            <template v-if="activeProject">
              <NuxtLink :to="`/projects/${activeProject.id}/overview`" class="hidden min-w-0 shrink items-center gap-2 text-muted transition-colors hover:text-highlighted sm:flex">
                <ProjectDot tile :project-id="activeProject.id" :accent="activeProject.theme?.accent" :name="activeProject.name" :icon-url="activeProject.iconUrl" />
                <span class="truncate">{{ activeProject.name }}</span>
              </NuxtLink>
              <UIcon name="i-lucide-chevron-right" class="hidden size-3.5 shrink-0 text-dimmed sm:block" />
            </template>
            <h2 class="truncate text-highlighted">{{ activeUser?.name || activeUser?.email || activeUser?.externalId || $t('inbox.conversation') }}</h2>
            <span v-if="activeConversation?.subject || activeConversation?.context?.label" class="hidden truncate font-normal text-muted lg:inline">{{ activeConversation?.subject || activeConversation?.context?.label }}</span>
          </nav>
          <USelect v-if="activeConversation" :model-value="activeConversation.status" :items="statusItems" color="neutral" variant="outline" size="sm" class="w-auto xl:hidden" :ui="{ base: 'rounded-full' }" aria-label="Status" @update:model-value="setStatus(activeId, String($event))">
            <template #leading><StatusIcon :category="activeConversation.statusCategory" /></template>
          </USelect>
          <UTooltip v-if="activeConversation" :text="$t('inbox.copyConversation')">
            <UButton :icon="copiedConversation ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="$t('inbox.copyConversation')" :loading="copyingConversation" @click="copyConversation" />
          </UTooltip>
          <UTooltip v-if="activeConversation" :text="activeConversation.archivedAt ? $t('inbox.unarchive') : $t('inbox.archive')">
            <UButton :icon="activeConversation.archivedAt ? 'i-lucide-archive-restore' : 'i-lucide-archive'" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="activeConversation.archivedAt ? $t('inbox.unarchiveConversation') : $t('inbox.archiveConversation')" @click="toggleArchive(activeId)" />
          </UTooltip>
          <UTooltip v-if="activeConversation" :text="$t('inbox.delete')">
            <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="sm" square class="text-muted hover:text-error" :aria-label="$t('inbox.deleteConversation')" @click="remove(activeId)" />
          </UTooltip>
          <UTooltip :text="$t('inbox.details')">
            <UButton icon="i-lucide-panel-right" color="neutral" variant="ghost" size="sm" square class="text-muted xl:hidden" :aria-label="$t('inbox.openDetails')" @click="showContext = true" />
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
              <template #empty><EmptyState icon="i-lucide-message-square-dashed" :title="$t('inbox.noMessages')" :description="$t('inbox.noMessagesDescription')" /></template>
            </ChatTranscript>

            <ChatComposer
              v-model="draft"
              :placeholder="internalNote ? $t('inbox.addInternalNote') : $t('inbox.replyPlaceholder')"
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
                <div class="mb-2 flex items-center gap-1.5" role="tablist" :aria-label="$t('inbox.messageType')">
                  <button type="button" role="tab" :aria-selected="!internalNote" class="chip h-6 px-2.5 text-xs" :class="!internalNote ? 'chip-active' : ''" @click="internalNote = false"><UIcon name="i-lucide-reply" class="size-3.5" />{{ $t('inbox.reply') }}</button>
                  <button type="button" role="tab" :aria-selected="internalNote" class="chip h-6 px-2.5 text-xs" :class="internalNote ? 'chip-active' : ''" @click="internalNote = true"><UIcon name="i-lucide-lock-keyhole" class="size-3.5" />{{ $t('inbox.internalNote') }}</button>
                </div>
              </template>
              <template #below>
                <label v-if="!internalNote" class="mt-2 flex items-center gap-2 px-1 text-xs text-muted"><USwitch v-model="notifyByEmail" size="xs" />{{ $t('inbox.alsoEmail', { email: activeUser?.email || $t('inbox.thisCustomer') }) }}</label>
                <p v-else class="mt-2 px-1 text-xs text-muted"><UIcon name="i-lucide-lock-keyhole" class="mr-1 inline size-3 align-[-1px] text-warning" />{{ $t('inbox.internalNoteHint') }}</p>
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

    <USlideover v-model:open="showContext" class="xl:hidden" :title="$t('inbox.details')" :ui="{ content: 'max-w-80', body: 'p-0 sm:p-0' }">
      <template #body>
        <InboxConversationContext v-if="activeConversation && activeUser" class="h-full" :conversation="activeConversation" :user="activeUser" :project="activeProject" :type="activeType" :agents="humanAgents" :last-user-message="lastUserMessage" @triage="setTriage" @action="runAction" />
      </template>
    </USlideover>

    <NewChatModal v-model:open="showNewChat" :projects="projects" :default-project-id="projectFilter === 'all' ? '' : projectFilter" @created="onCreated" />
  </div>
</template>

<script setup lang="ts">
import type { Attachment, Conversation, ConversationAction, ConversationType, Message } from '#shared/support'
import { conversationToText, replyTarget, sortByCreatedAt } from '#shared/conversations'
import type { SupportEvent } from '~~/server/utils/events'
import type { ChatListItem } from '~/components/chat/ChatConversationList.vue'
import type { InboxEndUser } from '~/components/inbox/ConversationContext.vue'
import { newOutboxId, useChatOutbox, type OutboxEntry } from '~/composables/useChatOutbox'

definePageMeta({ middleware: 'agent' })

type QueueView = 'all' | 'unassigned' | 'mine' | 'open' | 'unread' | 'archived'
type QueueCounts = { status: Record<string, number>, type: Record<string, number>, assignee: Record<string, number> }
type HumanAgent = { id: string, username: string, email: string, name: string }

const { api, token, agent, projects, loadProjects, agentHeaders } = useAgent()
const route = useRoute()
const router = useRouter()
const outbox = useChatOutbox()
const toast = useToast()
const { t } = useI18n()
const totalUnread = useState<number>('inbox-total-unread', () => 0)

const conversations = ref<Conversation[]>([])
const endUsers = ref<Record<string, InboxEndUser>>({})
const listLoading = ref(false)
const listError = ref('')
const hasMore = ref(false)
const queueCounts = ref<QueueCounts>({ status: {}, type: {}, assignee: {} })
const archivedCount = ref(0)
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
const projectItems = computed(() => [{ label: t('inbox.allProjects'), value: 'all' }, ...projects.value.map(project => ({ label: project.name, value: project.id }))])
const statusFilterItems = computed(() => [{ label: t('inbox.anyStatus'), value: 'any' }, { label: t('inbox.open'), value: 'open' }, { label: t('inbox.done'), value: 'done' }])
const priorityFilterItems = computed(() => [{ label: t('inbox.anyPriority'), value: 'any' }, { label: t('inbox.low'), value: 'low' }, { label: t('inbox.normal'), value: 'normal' }, { label: t('inbox.high'), value: 'high' }, { label: t('inbox.urgent'), value: 'urgent' }])
const viewItems = computed(() => [
  { key: 'all' as const, label: t('inbox.all'), count: conversations.value.length },
  { key: 'unassigned' as const, label: t('inbox.unassigned'), count: queueCounts.value.assignee.unassigned || 0 },
  { key: 'mine' as const, label: t('inbox.mine'), count: agent.value?.id ? queueCounts.value.assignee[agent.value.id] || 0 : 0 },
  { key: 'open' as const, label: t('inbox.open'), count: queueCounts.value.status.open || 0 },
  { key: 'unread' as const, label: t('inbox.unread'), count: totalUnread.value },
  { key: 'archived' as const, label: t('inbox.archived'), count: archivedCount.value }
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

// Archived threads live on the server side of the query, not in the loaded page.
async function setView(next: QueueView) {
  const refetch = (view.value === 'archived') !== (next === 'archived')
  view.value = next
  if (refetch) await loadList()
}

async function loadList(more = false) {
  listLoading.value = true
  listError.value = ''
  try {
    const last = more ? conversations.value[conversations.value.length - 1] : null
    const result = await api<{ conversations: Conversation[], endUsers: Record<string, InboxEndUser>, hasMore: boolean, totalUnread: number, counts: QueueCounts, archivedCount: number }>('/admin/conversations', {
      query: { project: projectFilter.value === 'all' ? undefined : projectFilter.value, status: statusFilter.value === 'any' ? undefined : statusFilter.value, priority: priorityFilter.value === 'any' ? undefined : priorityFilter.value, type: typeFilter.value || undefined, q: searchQuery.value.trim() || undefined, archived: view.value === 'archived' ? 'true' : undefined, before: last?.lastMessageAt || undefined }
    })
    conversations.value = more ? [...conversations.value, ...result.conversations] : result.conversations
    endUsers.value = { ...endUsers.value, ...result.endUsers }
    hasMore.value = result.hasMore
    totalUnread.value = result.totalUnread
    queueCounts.value = result.counts
    archivedCount.value = result.archivedCount || 0
  } catch (error: any) {
    listError.value = error?.message || t('inbox.loadError')
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
  return { id: conversation.id, title: user?.name || user?.email || user?.externalId || t('inbox.unknownCustomer'), subtitle: conversation.subject || conversation.context?.label || '', preview: conversation.lastMessageFrom === 'agent' ? t('inbox.youPreview', { text: conversation.lastMessagePreview }) : conversation.lastMessagePreview, timestamp: conversation.lastMessageAt, unreadCount: conversation.unreadByAgent, projectId: conversation.projectId, projectName: project?.name, projectAccent: project?.theme?.accent, projectIconUrl: project?.iconUrl, priority: conversation.priority, archived: Boolean(conversation.archivedAt), done: conversation.statusCategory === 'resolved' || conversation.statusCategory === 'closed' || conversation.status === 'done' }
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
// Unsent text is kept per conversation, so switching tickets doesn't lose or leak it.
const drafts = ref<Record<string, string>>({})
const draft = computed({ get: () => drafts.value[activeId.value] || '', set: (value: string) => { drafts.value[activeId.value] = value } })
const notifyByEmail = ref(true)
const internalNote = ref(false)
const transcriptRef = ref<{ scrollToLatest: () => void } | null>(null)

const activeConversation = computed(() => conversations.value.find(conversation => conversation.id === activeId.value) || null)
const activeProject = computed(() => activeConversation.value ? projectsById.value[activeConversation.value.projectId] || null : null)
const activeType = computed(() => typesByProject.value[activeConversation.value?.projectId || '']?.find(type => type.key === activeConversation.value?.type) || null)
const statusItems = computed(() => (activeType.value?.statuses || [{ key: 'open', label: t('inbox.open') }, { key: 'done', label: t('inbox.done') }]).map(status => ({ label: status.label, value: status.key })))
const failed = computed<Message[]>(() => outbox.forScope(activeId.value).map(entry => entryToMessage(entry, 'failed')))
const visibleMessages = computed(() => [...messages.value, ...sending.value, ...failed.value].sort(sortByCreatedAt))
// What a board item filed from the context panel starts with.
const lastUserMessage = computed(() => [...messages.value].reverse().find(message => message.sender === 'user' && message.kind === 'message' && message.body)?.body || '')
const replyingTo = computed(() => replyTarget(visibleMessages.value, threadId.value, 'agent'))
const ownActor = computed(() => (agent.value?.id ? `agent:${agent.value.id}` : 'agent'))

function entryToMessage(entry: OutboxEntry, delivery: 'pending' | 'failed'): Message {
  return { id: entry.id, conversationId: entry.conversationId, sender: 'agent', senderName: t('inbox.you'), body: entry.body, attachments: entry.attachments, reactions: [], context: null, replyToId: entry.replyToId, clientId: entry.id, visibility: 'public', kind: 'message', createdAt: entry.createdAt, delivery, deliveryError: delivery === 'failed' ? entry.error : '' }
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
    // A deep link to an archived thread opens the Archived view so its row exists.
    if (detail.conversation.archivedAt && view.value !== 'archived') { view.value = 'archived'; await loadList() }
    upsertConversation(detail.conversation)
    await loadTypes(detail.conversation.projectId)
    messages.value = list.messages
    hasEarlier.value = list.hasMore
    notifyByEmail.value = Boolean(detail.endUser.email)
    if (detail.conversation.unreadByAgent > 0) void markRead(id, true)
  } catch (error: any) { threadError.value = error?.message || t('inbox.conversationLoadError') } finally { threadLoading.value = false }
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
  } catch (error: any) { threadError.value = error?.message || t('inbox.earlierLoadError') } finally { loadingEarlier.value = false }
}

async function loadTypes(projectId: string) {
  if (typesByProject.value[projectId]) return
  try { const { types } = await api<{ types: ConversationType[] }>(`/admin/projects/${projectId}/types`); typesByProject.value = { ...typesByProject.value, [projectId]: types } } catch { /* The built-in support type remains usable. */ }
}
function removeConversation(id: string) {
  conversations.value = conversations.value.filter(item => item.id !== id)
  if (activeId.value === id) void select('')
}
function upsertConversation(conversation: Conversation) {
  // Archived rows belong to the Archived view only, and the queue never shows them.
  if (Boolean(conversation.archivedAt) !== (view.value === 'archived')) {
    const hadRow = conversations.value.some(item => item.id === conversation.id)
    if (hadRow) removeConversation(conversation.id)
    return
  }
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
const copyingConversation = ref(false)
const copiedConversation = ref(false)
// Copies the whole thread as plain text for an LLM, pulling in any pages that are not loaded yet.
async function copyConversation() {
  const conversation = activeConversation.value
  if (!conversation || copyingConversation.value) return
  copyingConversation.value = true
  try {
    let all = messages.value
    let more = hasEarlier.value
    while (more && all[0]) {
      const page = await api<{ messages: Message[], hasMore: boolean }>(`/admin/conversations/${conversation.id}/messages`, { query: { before: all[0].createdAt } })
      const known = new Set(all.map(message => message.id))
      all = [...page.messages.filter(message => !known.has(message.id)), ...all]
      more = page.hasMore && page.messages.length > 0
    }
    const user = activeUser.value
    await navigator.clipboard.writeText(conversationToText(conversation, all, { customer: [user?.name, user?.email].filter(Boolean).join(' · ') || user?.externalId, project: activeProject.value?.name }))
    copiedConversation.value = true
    setTimeout(() => { copiedConversation.value = false }, 1500)
    toast.add({ title: t('inbox.copied'), icon: 'i-lucide-copy' })
  } catch (error: any) { toast.add({ title: t('inbox.copyError'), description: error?.message, color: 'error', icon: 'i-lucide-circle-alert' }) } finally { copyingConversation.value = false }
}

async function toggleArchive(id: string) {
  const conversation = conversations.value.find(item => item.id === id)
  if (!conversation) return
  const archive = !conversation.archivedAt
  try {
    const { conversation: updated } = await api<{ conversation: Conversation }>(`/admin/conversations/${id}/archive`, { method: 'POST', body: { archived: archive } })
    archivedCount.value = Math.max(0, archivedCount.value + (archive ? 1 : -1))
    if (archive && conversation.unreadByAgent > 0) totalUnread.value = Math.max(0, totalUnread.value - conversation.unreadByAgent)
    upsertConversation(updated)
    toast.add({ title: archive ? t('inbox.archivedToast') : t('inbox.unarchivedToast'), icon: archive ? 'i-lucide-archive' : 'i-lucide-archive-restore' })
  } catch (error: any) { threadError.value = listError.value = error?.message || t('inbox.archiveError') }
}
async function remove(id: string) {
  const conversation = conversations.value.find(item => item.id === id)
  if (!conversation || !confirm(t('inbox.deleteConfirm'))) return
  try {
    await api(`/admin/conversations/${id}`, { method: 'DELETE' })
    if (conversation.archivedAt) archivedCount.value = Math.max(0, archivedCount.value - 1)
    else if (conversation.unreadByAgent > 0) totalUnread.value = Math.max(0, totalUnread.value - conversation.unreadByAgent)
    removeConversation(id)
    toast.add({ title: t('inbox.deleted'), icon: 'i-lucide-trash-2' })
  } catch (error: any) { threadError.value = listError.value = error?.message || t('inbox.deleteError') }
}
async function setStatus(id: string, status: string) {
  const conversation = conversations.value.find(item => item.id === id)
  if (!conversation || !status) return
  upsertConversation({ ...conversation, status })
  try { const { conversation: updated } = await api<{ conversation: Conversation }>(`/admin/conversations/${id}/status`, { method: 'POST', body: { status } }); upsertConversation(updated) } catch (error: any) { threadError.value = error?.message || t('inbox.updateError'); void loadList() }
}
async function setTriage(body: Record<string, unknown>) {
  if (!activeId.value) return
  try { const { conversation } = await api<{ conversation: Conversation }>(`/admin/conversations/${activeId.value}`, { method: 'PATCH', body }); upsertConversation(conversation) } catch (error: any) { threadError.value = error?.message || t('inbox.updateError') }
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
    if (notifyByEmail.value && !result.emailSent && result.emailError && result.emailError !== 'throttled') threadError.value = t('inbox.sentEmailFailed', { error: result.emailError })
  } catch (error: any) { outbox.remember({ ...entry, error: error?.message || t('inbox.sendError') }) } finally { sending.value = sending.value.filter(message => message.id !== entry.id) }
}
function send(body: string, attachments: Attachment[]) {
  if (!activeId.value) return
  threadError.value = ''
  if (internalNote.value) { void sendNote(body); return }
  void deliver({ id: newOutboxId(), scope: activeId.value, body, subject: '', conversationId: activeId.value, replyToId: threadId.value, attachments, context: null, createdAt: new Date().toISOString(), error: '' })
}
async function sendNote(body: string) { try { const { message } = await api<{ message: Message }>(`/admin/conversations/${activeId.value}/notes`, { method: 'POST', body: { body } }); messages.value = [...messages.value, message]; internalNote.value = false } catch (error: any) { threadError.value = error?.message || t('inbox.noteError') } }
async function runAction(action: ConversationAction) {
  if (!activeId.value || (action.confirm && !confirm(action.confirm))) return
  const note = action.requiresNote ? prompt(t('inbox.actionNotePrompt')) : ''
  if (action.requiresNote && !note) return
  try { const result = await api<{ conversation: Conversation, event: Message }>(`/admin/conversations/${activeId.value}/actions/${action.key}`, { method: 'POST', body: note ? { note } : {} }); upsertConversation(result.conversation); messages.value = [...messages.value, result.event] } catch (error: any) { threadError.value = error?.message || t('inbox.actionError') }
}
function retry(message: Message) { const entry = outbox.forScope(activeId.value).find(item => item.id === message.id); if (entry) void deliver(entry) }
function discard(message: Message) { outbox.forget(message.id) }
async function unsend(message: Message) {
  if (!confirm(t('inbox.unsendConfirm'))) return
  messages.value = messages.value.filter(item => item.id !== message.id); try { await api(`/admin/messages/${message.id}`, { method: 'DELETE' }) } catch (error: any) { threadError.value = error?.message || t('inbox.unsendError'); void select(activeId.value) }
}
function replaceMessage(updated: Message) {
  const index = messages.value.findIndex(item => item.id === updated.id)
  if (index === -1) return
  messages.value = [...messages.value.slice(0, index), updated, ...messages.value.slice(index + 1)]
}
async function react(message: Message, emoji: string) {
  if (message.delivery || !message.id) return
  try { const { message: updated } = await api<{ message: Message }>(`/admin/messages/${message.id}/reactions`, { method: 'POST', body: { emoji } }); replaceMessage(updated) } catch (error: any) { threadError.value = error?.message || t('inbox.reactError') }
}
async function onCreated(conversationId: string) { await loadList(); await select(conversationId) }

useEventStream(computed(() => '/v1/admin/events'), token, (event: SupportEvent) => {
  if (event.type === 'conversation.deleted') { removeConversation(event.conversationId); return }
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
