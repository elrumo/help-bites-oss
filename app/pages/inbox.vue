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
              can-save-faq
              @load-earlier="loadEarlier"
              @retry="retry"
              @discard="discard"
              @unsend="unsend"
              @react="react"
              @save-faq="openSaveFaq"
            >
              <template #empty><EmptyState icon="i-lucide-message-square-dashed" :title="$t('inbox.noMessages')" :description="$t('inbox.noMessagesDescription')" /></template>
            </ChatTranscript>

            <ChatComposer
              ref="composerRef"
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
              <template #tools>
                <InboxComposerTools :conversation-id="activeId" :project-id="activeConversation?.projectId || ''" :person="replyPerson" :disabled="internalNote" @insert="insertText" @draft="insertText" />
              </template>
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
            :context="context"
            @triage="setTriage"
            @action="runAction"
            @open="select"
            @feedback="setFeedbackPosts"
          />
        </div>
      </template>
    </section>

    <USlideover v-model:open="showContext" class="xl:hidden" :title="$t('inbox.details')" :ui="{ content: 'max-w-80', body: 'p-0 sm:p-0' }">
      <template #body>
        <InboxConversationContext v-if="activeConversation && activeUser" class="h-full" :conversation="activeConversation" :user="activeUser" :project="activeProject" :type="activeType" :agents="humanAgents" :last-user-message="lastUserMessage" :context="context" @triage="setTriage" @action="runAction" @open="select" @feedback="setFeedbackPosts" />
      </template>
    </USlideover>

    <InboxSaveFaqModal v-model:open="faqOpen" :conversation-id="activeId" :models="context?.faqModels.models || []" :default-model-id="context?.faqModels.defaultModelId || ''" :initial="faqInitial" />

    <NewChatModal v-model:open="showNewChat" :projects="projects" :default-project-id="projectFilter === 'all' ? '' : projectFilter" @created="onCreated" />
  </div>
</template>

<script setup lang="ts">
import type { Attachment, Conversation, ConversationAction, ConversationType, Message } from '#shared/support'
import { conversationToText, replyTarget, sortByCreatedAt } from '#shared/conversations'
import { faqPrefill, type ConversationContextResponse, type HubFeedbackPost } from '#shared/conversationHub'
import type { SupportEvent } from '~~/server/utils/events'
import type { ChatListItem } from '~/components/chat/ChatConversationList.vue'
import type { InboxEndUser } from '~/components/inbox/ConversationContext.vue'
import { newOutboxId, useChatOutbox, type OutboxEntry } from '~/composables/useChatOutbox'

definePageMeta({ middleware: 'agent' })

type QueueView = 'all' | 'unassigned' | 'mine' | 'open' | 'unread' | 'archived'
type ViewCounts = Record<QueueView, number>
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
// Each view's count, from the server under the same filters as the list, so a pill's number is the rows it lists.
const viewCounts = ref<ViewCounts>({ all: 0, unassigned: 0, mine: 0, open: 0, unread: 0, archived: 0 })
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
  { key: 'all' as const, label: t('inbox.all'), count: viewCounts.value.all },
  { key: 'unassigned' as const, label: t('inbox.unassigned'), count: viewCounts.value.unassigned },
  { key: 'mine' as const, label: t('inbox.mine'), count: viewCounts.value.mine },
  { key: 'open' as const, label: t('inbox.open'), count: viewCounts.value.open },
  { key: 'unread' as const, label: t('inbox.unread'), count: viewCounts.value.unread },
  { key: 'archived' as const, label: t('inbox.archived'), count: viewCounts.value.archived }
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

// A view is a server query: the page holds that view's rows, not a slice of the last page.
async function setView(next: QueueView) {
  if (view.value === next) return
  view.value = next
  await loadList()
}

type QueuePage = { conversations: Conversation[], endUsers: Record<string, InboxEndUser>, hasMore: boolean, totalUnread: number, viewCounts?: ViewCounts }
function queueQuery() {
  return { project: projectFilter.value === 'all' ? undefined : projectFilter.value, status: statusFilter.value === 'any' ? undefined : statusFilter.value, priority: priorityFilter.value === 'any' ? undefined : priorityFilter.value, type: typeFilter.value || undefined, q: searchQuery.value.trim() || undefined, view: view.value === 'all' ? undefined : view.value }
}

async function loadList(more = false) {
  listLoading.value = true
  listError.value = ''
  try {
    const last = more ? conversations.value[conversations.value.length - 1] : null
    const result = await api<QueuePage>('/admin/conversations', { query: { ...queueQuery(), before: last?.lastMessageAt || undefined } })
    conversations.value = more ? [...conversations.value, ...result.conversations] : result.conversations
    endUsers.value = { ...endUsers.value, ...result.endUsers }
    hasMore.value = result.hasMore
    totalUnread.value = result.totalUnread
    if (result.viewCounts) viewCounts.value = result.viewCounts
  } catch (error: any) {
    listError.value = error?.message || t('inbox.loadError')
  } finally { listLoading.value = false }
}

// A row changed (triage, archive, a live event): the counts follow from the server, a moment later and once per burst.
let countsTimer: ReturnType<typeof setTimeout> | null = null
function refreshCounts() {
  if (countsTimer) clearTimeout(countsTimer)
  countsTimer = setTimeout(async () => {
    try {
      const result = await api<QueuePage>('/admin/conversations', { query: { ...queueQuery(), limit: 1 } })
      totalUnread.value = result.totalUnread
      if (result.viewCounts) viewCounts.value = result.viewCounts
    } catch {}
  }, 600)
}

const filteredConversations = computed(() => conversations.value.filter((conversation) => {
  if (view.value === 'unassigned') return !conversation.assigneeId
  if (view.value === 'mine') return conversation.assigneeId === agent.value?.id
  if (view.value === 'open') return conversation.statusCategory === 'open'
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
const composerRef = ref<{ focus: () => void } | null>(null)
// Who the open customer is, their plan, earlier conversations and linked feedback: one read per open conversation.
const context = ref<ConversationContextResponse | null>(null)
const faqOpen = ref(false)
const faqMessageId = ref('')

const activeConversation = computed(() => conversations.value.find(conversation => conversation.id === activeId.value) || null)
const activeProject = computed(() => activeConversation.value ? projectsById.value[activeConversation.value.projectId] || null : null)
const activeType = computed(() => typesByProject.value[activeConversation.value?.projectId || '']?.find(type => type.key === activeConversation.value?.type) || null)
const statusItems = computed(() => (activeType.value?.statuses || [{ key: 'open', label: t('inbox.open') }, { key: 'done', label: t('inbox.done') }]).map(status => ({ label: status.label, value: status.key })))
const failed = computed<Message[]>(() => outbox.forScope(activeId.value).map(entry => entryToMessage(entry, 'failed')))
const visibleMessages = computed(() => [...messages.value, ...sending.value, ...failed.value].sort(sortByCreatedAt))
// What a board item filed from the context panel starts with.
const lastUserMessage = computed(() => [...messages.value].reverse().find(message => message.sender === 'user' && message.kind === 'message' && message.body)?.body || '')
const replyingTo = computed(() => replyTarget(visibleMessages.value, threadId.value, 'agent'))
// Fills {{firstName}} and {{name}} in a saved reply.
const replyPerson = computed(() => ({ name: context.value?.contact.name ?? activeUser.value?.name ?? '', email: context.value?.contact.email ?? activeUser.value?.email ?? '' }))
const faqInitial = computed(() => faqPrefill([...messages.value].sort(sortByCreatedAt), faqMessageId.value))
const ownActor = computed(() => (agent.value?.id ? `agent:${agent.value.id}` : 'agent'))

function entryToMessage(entry: OutboxEntry, delivery: 'pending' | 'failed'): Message {
  return { id: entry.id, conversationId: entry.conversationId, sender: 'agent', senderName: t('inbox.you'), body: entry.body, attachments: entry.attachments, reactions: [], context: null, replyToId: entry.replyToId, clientId: entry.id, visibility: 'public', kind: 'message', createdAt: entry.createdAt, delivery, deliveryError: delivery === 'failed' ? entry.error : '' }
}

async function loadContext(id: string) {
  try {
    const result = await api<ConversationContextResponse>(`/admin/conversations/${id}/context`)
    if (activeId.value === id) context.value = result
  } catch {
    // The panel's extra sections just stay out; the thread itself still works.
    if (activeId.value === id) context.value = null
  }
}
function setFeedbackPosts(posts: HubFeedbackPost[]) { if (context.value) context.value = { ...context.value, feedbackPosts: posts } }
function openSaveFaq(message: Message) { faqMessageId.value = message.id; faqOpen.value = true }
// Put saved-reply or draft text in the reply box: after what is already typed, never over it.
function insertText(text: string) {
  const typed = draft.value.replace(/\s+$/, '')
  draft.value = typed ? `${typed}\n\n${text}` : text
  composerRef.value?.focus()
}

async function select(id: string) {
  activeId.value = id; threadId.value = ''; threadError.value = ''; messages.value = []; hasEarlier.value = false; activeUser.value = null; showContext.value = false; context.value = null
  await router.replace({ query: id ? { c: id } : {} })
  if (!id) return
  void loadContext(id)
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
  refreshCounts()
}
function upsertConversation(conversation: Conversation) {
  refreshCounts()
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
    if (!conversation.archivedAt && conversation.unreadByAgent > 0) totalUnread.value = Math.max(0, totalUnread.value - conversation.unreadByAgent)
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
    if (event.conversationId === activeId.value) {
      if (!messages.value.some(message => message.id === event.message.id)) messages.value = [...messages.value, event.message]
      if (event.message.sender === 'user') void markRead(activeId.value, true)
      // A teammate linked or unlinked a post from another window.
      if (event.message.kind === 'event' && String(event.message.event?.type || '').startsWith('feedback.')) void loadContext(activeId.value)
    }
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
