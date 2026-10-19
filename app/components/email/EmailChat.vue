<script setup lang="ts">
/**
 * The AI designer pane, laid out like ChatGPT or v0: a greeting with starting
 * points, then a transcript where each reply lists the edits it made (click
 * one to select its block), with follow-ups under the newest reply and a
 * floating composer that carries the selected block and the model picker.
 * Long messages fold away under Show more.
 *
 * It sends the live document with every turn, applies the model's edits as
 * they stream (each tool call is one `data-document`), and keeps a snapshot
 * from before each turn so a whole turn can be undone, or tried again, in one
 * click. Two model tiers: High (fast) and Ultra (strongest); the choice is
 * remembered on this device.
 *
 * A template has any number of chats. The newest opens with the editor;
 * History and New chat (rendered into `header`, the AI section's header) move
 * between them. A turn keeps running on the server when this page goes away:
 * opening its chat again, or coming back online, re-attaches to it and
 * replays it (server/utils/emailAiRuns.ts).
 */
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, isTextUIPart, isToolUIPart, type UIMessage } from 'ai'
import { useClipboard, useOnline } from '@vueuse/core'
import { findBlock, type EmailDocument } from '#shared/email/blocks'
import { EMAIL_AI_TIERS, emailAiTier, type EmailAiTier } from '#shared/email/ai'
import type { EmailIssue } from '#shared/email/lint'
import type { TemplateVariable } from '#shared/email/resolve'
import type { EmailComponentDef } from '#shared/email/components'
import type { EmailTemplate } from '~~/server/utils/emails'
import EmailChatClamp from '~/components/email/EmailChatClamp.vue'
import { formatChatListStamp } from '~/components/chat/chatTime'
import { EMAIL_BLOCK_META, emailBlockLabel } from '~/utils/emailBlocks'

const props = defineProps<{
  templateId: string
  token: string
  master: boolean
  document: EmailDocument
  variables: TemplateVariable[]
  selectedId: string | null
  actorId: string
  issues: EmailIssue[]
  /** Where History and New chat go: the AI section's header. */
  header?: HTMLElement | null
}>()

const emit = defineEmits<{
  (e: 'document', doc: EmailDocument): void
  (e: 'variables', variables: TemplateVariable[]): void
  (e: 'select', id: string | null): void
  (e: 'checkpoint'): void
  (e: 'restore', doc: EmailDocument): void
  /** Show the chat: one was picked from the header while it was folded away. */
  (e: 'open'): void
  /** The designer saved a component to the library. */
  (e: 'component', component: EmailComponentDef): void
  /** The email as the call being written would leave it, to show (not save); null when the turn is over. */
  (e: 'draft', doc: EmailDocument | null): void
}>()

const { api } = useAgent()
const toast = useToast()
const online = useOnline()
const { t } = useI18n()

// The designer's mark: an indigo orb, on the greeting and beside each reply.
const ORB = 'bg-linear-to-br from-primary-400 to-primary-600 text-white ring-1 ring-inset ring-white/20 shadow-primary-500/30'

// The two sides of the transcript: your bubble, and the designer's reply beside its mark.
const userProps = { side: 'right', variant: 'soft', ui: { container: 'max-w-[85%]', content: 'rounded-2xl bg-elevated px-3.5 py-2 text-highlighted dark:bg-accented' } } as const
const assistantProps = { side: 'left', variant: 'naked', avatar: { icon: 'i-lucide-sparkles', ui: { icon: 'size-3 text-white' } }, ui: { leading: 'min-h-5', leadingAvatar: `${ORB} shadow-sm` } } as const
// The thinking row rises in like a reply (UChatMessages draws it, so it takes the class here).
const indicatorProps = { ...assistantProps, ui: { ...assistantProps.ui, root: 'animate-chat-reply' } }

// ---- model tier ----------------------------------------------------------------
const TIER_KEY = 'sb:emailAiTier'
const tier = ref<EmailAiTier>('high')
onMounted(() => {
  try {
    tier.value = emailAiTier(localStorage.getItem(TIER_KEY))
  } catch {}
})
watch(tier, (value) => {
  try {
    localStorage.setItem(TIER_KEY, value)
  } catch {}
})
const tiers = Object.entries(EMAIL_AI_TIERS).map(([value, t]) => ({ value: value as EmailAiTier, icon: value === 'ultra' ? 'i-lucide-zap' : 'i-lucide-gauge', ...t }))
const currentTier = computed(() => tiers.find(t => t.value === tier.value) ?? tiers[0]!)
const tierItems = computed(() => tiers.map(t => ({
  label: t.label,
  description: `${t.hint} (${t.model.split('/').pop()})`,
  icon: t.icon,
  type: 'checkbox' as const,
  checked: t.value === tier.value,
  onSelect: () => { tier.value = t.value }
})))

// ---- chats -------------------------------------------------------------------------
type ChatState = { chatId: string | null, messages: UIMessage[], streamId: string | null }
type ChatSummary = { id: string, title: string, updatedAt: string, running: boolean }

// The turn to re-attach to; read when the transport asks where to reconnect.
let resumeId = ''
const { workspaceId, planLimit } = useAgent()
const workspaceHeader = (): Record<string, string> => workspaceId.value ? { 'X-Workspace': workspaceId.value } : {}
// A 402 (out of AI credits, or Ultra on a plan without it) opens the plan limit modal, as api() does.
const designerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await fetch(input, init)
  if (res.status === 402) {
    const body = await res.clone().json().catch(() => ({}))
    planLimit.value = { message: body.statusMessage || body.message || t('emailEditor.notInPlan'), ...body.data }
  }
  return res
}) as typeof fetch
const transport = new DefaultChatTransport<UIMessage>({
  api: `/v1/admin/emails/${props.templateId}/chat`,
  fetch: designerFetch,
  prepareSendMessagesRequest: ({ id, messages }) => ({
    headers: { Authorization: `Bearer ${props.token}`, ...workspaceHeader() },
    body: { chatId: id, messages: messages.slice(-20), document: props.document, variables: props.variables, selectedId: props.selectedId, tier: tier.value, actorId: props.actorId }
  }),
  prepareReconnectToStreamRequest: () => ({
    api: `/v1/admin/emails/${props.templateId}/chat/stream?id=${encodeURIComponent(resumeId)}`,
    headers: { Authorization: `Bearer ${props.token}`, ...workspaceHeader() }
  })
})

/**
 * One Chat per conversation, so a turn still streaming into the chat you left
 * can't write into the next. No onError: a failed turn shows above the composer.
 */
function makeChat(id: string, messages: UIMessage[] = []): Chat<UIMessage> {
  const instance: Chat<UIMessage> = new Chat<UIMessage>({
    id,
    messages,
    transport,
    onData: (part) => {
      if (chat.value !== instance) return
      if (part.type === 'data-document' && part.data) emit('document', part.data as unknown as EmailDocument)
      if (part.type === 'data-variables' && part.data) emit('variables', (part.data as { variables: TemplateVariable[] }).variables)
      if (part.type === 'data-component' && part.data) emit('component', part.data as unknown as EmailComponentDef)
      if (part.type === 'data-draft' && part.data) emit('draft', part.data as unknown as EmailDocument)
    }
  })
  return instance
}

const chat = shallowRef(makeChat(crypto.randomUUID()))
const switching = ref(true) // until the newest chat has loaded
const busy = computed(() => chat.value.status === 'submitted' || chat.value.status === 'streaming')
// A draft only lives while its turn does.
watch(busy, (working) => { if (!working) emit('draft', null) })
const stopping = ref(false)
const input = ref('')
const lastId = computed(() => chat.value.messages.at(-1)?.id)
/** The reply still being written. */
const working = (message: UIMessage) => busy.value && message.id === lastId.value

// Only what arrives while a chat is on screen animates in; opening a chat
// shows its history as it stands.
let settled = new Set<string>()
const fresh = (message: UIMessage) => !settled.has(message.id)

/** Shows a conversation, re-attaching to its turn while that is still running. */
function show(id: string, messages: UIMessage[] = [], streamId: string | null = null) {
  void chat.value.stop() // only this page stops listening: the server finishes the turn
  settled = new Set(messages.map(m => m.id))
  chat.value = makeChat(id, messages)
  if (streamId) {
    resumeId = streamId
    void chat.value.resumeStream()
  }
}

/** Opens a chat, the newest when `id` is left out. */
async function openChat(id?: string) {
  historyOpen.value = false
  if (id) emit('open')
  if (id === chat.value.id) return
  switching.value = true
  try {
    const state = await api<ChatState>(`/admin/emails/${props.templateId}/chat`, { query: id ? { chat: id } : undefined })
    // Something was asked (Fix with AI) before the newest chat came back: stay with it.
    if (!id && chat.value.messages.length) return
    show(state.chatId || crypto.randomUUID(), state.messages, state.streamId)
  } catch (error: any) {
    if (id) toast.add({ title: t('emailEditor.couldNotOpenChat'), description: error?.message, color: 'error' })
  } finally {
    switching.value = false
  }
}
onMounted(() => openChat())

function newChat() {
  historyOpen.value = false
  emit('open')
  show(crypto.randomUUID())
}

// The design before each turn, by the user message that started it.
const before = reactive(new Map<string, EmailDocument>())
let pending: EmailDocument | null = null
watch(() => chat.value.messages.length, () => {
  const last = chat.value.messages.at(-1)
  if (pending && last?.role === 'user') {
    before.set(last.id, pending)
    pending = null
  }
})

function send(text: string) {
  const message = text.trim()
  if (!message || busy.value || stopping.value || !online.value) return
  pending = JSON.parse(JSON.stringify(props.document))
  emit('checkpoint') // one undo step for the whole turn
  chat.value.sendMessage({ text: message })
  input.value = ''
}

/** Stops the turn here and on the server; what it changed so far stays. */
async function stop() {
  const current = chat.value
  const asked = current.messages.findLast(m => m.role === 'user')?.id
  stopping.value = true
  void current.stop()
  // The question's id stops a turn the server hasn't started yet, too.
  await api(`/admin/emails/${props.templateId}/chat/stream`, { method: 'DELETE', query: { chat: current.id, message: asked } }).catch(() => {})
  stopping.value = false
}

/** Runs the last turn again from the design it started with; undo goes back to this attempt. */
async function retry() {
  const current = chat.value
  const asked = current.messages.findLast(m => m.role === 'user')
  if (!asked || busy.value || stopping.value) return
  const snapshot = before.get(asked.id)
  if (snapshot) emit('restore', snapshot)
  else emit('checkpoint')
  await nextTick() // the request reads the restored document from props
  void current.regenerate()
}

// ---- history -----------------------------------------------------------------------
const historyOpen = ref(false)
const chats = ref<ChatSummary[]>([])
const loadingChats = ref(false)
const confirmDelete = ref<string | null>(null)

watch(historyOpen, async (open) => {
  confirmDelete.value = null
  if (!open) return
  loadingChats.value = true
  try {
    chats.value = (await api<{ chats: ChatSummary[] }>(`/admin/emails/${props.templateId}/chats`)).chats
  } catch {} finally {
    loadingChats.value = false
  }
})

/** Deletes a chat on the second click; deleting the open one starts a new chat. */
async function deleteChat(id: string) {
  if (confirmDelete.value !== id) {
    confirmDelete.value = id
    return
  }
  confirmDelete.value = null
  chats.value = chats.value.filter(c => c.id !== id)
  if (id === chat.value.id) show(crypto.randomUUID())
  await api(`/admin/emails/${props.templateId}/chat`, { method: 'DELETE', query: { chat: id } }).catch(() => {})
}

// ---- dropped connections -------------------------------------------------------------
// The server carries on with a turn whose page went offline or lost its
// connection, so pick it back up instead of calling it failed.
let dropped = false
let reattachedAt = 0
watch(online, (now) => {
  if (!now) dropped ||= busy.value
  else if (dropped) void reattach()
})
watch(() => chat.value.error, (error) => {
  // fetch reports a broken connection as a TypeError; refusals and model errors are plain Errors.
  if (!(error instanceof TypeError)) return
  if (!online.value) dropped = true
  else if (Date.now() - reattachedAt > 5_000) void reattach()
})

/** Re-attaches to the chat's turn if it's still running, or shows how it ended. False when neither. */
async function reattach(): Promise<boolean> {
  dropped = false
  reattachedAt = Date.now()
  const current = chat.value
  const state = await api<ChatState>(`/admin/emails/${props.templateId}/chat`, { query: { chat: current.id } }).catch(() => null)
  if (!state || chat.value !== current) return false
  const asked = current.messages.findLast(m => m.role === 'user')?.id
  const answered = !!asked && state.messages.at(-1)?.role === 'assistant' && state.messages.some(m => m.id === asked)
  if (!state.streamId && !answered) return false
  show(current.id, state.messages, state.streamId)
  // It ended while this page was away, and saved its design without us.
  if (!state.streamId) await syncDocument()
  return true
}

async function syncDocument() {
  const res = await api<{ template: EmailTemplate }>(`/admin/emails/${props.templateId}`).catch(() => null)
  if (!res?.template.document) return
  emit('document', res.template.document)
  emit('variables', res.template.variables)
}

/** Retry from the error notice: re-attach while the turn is still going, else run it again. */
async function recover() {
  if (chat.value.error instanceof TypeError && await reattach()) return
  await retry()
}

const errorText = computed(() => {
  const error = chat.value.error
  if (!error) return ''
  if (error instanceof TypeError) return t('emailEditor.lostConnection')
  // A refused request's message is the route's JSON error body.
  try {
    const body = JSON.parse(error.message)
    return body.statusMessage || body.message || error.message
  } catch {
    return error.message
  }
})

defineExpose({ send })

// ---- reading a turn --------------------------------------------------------------
const EDITING_TOOLS = new Set(['set_document', 'update_settings', 'update_blocks', 'add_block', 'replace_block', 'remove_block', 'move_block', 'set_theme', 'set_variables', 'save_component'])

type Change = { key: string, icon: string, text: string, blockId?: string, running: boolean, failed: boolean }
type Segment = { key: string, kind: 'text', text: string } | { key: string, kind: 'changes', changes: Change[] }

function blockName(id: string): string {
  const b = findBlock(props.document.blocks, id)
  if (!b) return t('emailEditor.aBlock')
  const clip = (s: string) => s.replace(/<[^>]+>/g, '').trim().slice(0, 32)
  if (b.type === 'heading') return t('emailEditor.blockHeading', { text: clip(b.text) })
  if (b.type === 'text') return t('emailEditor.blockText', { text: clip(b.html) })
  if (b.type === 'button') return t('emailEditor.blockButton', { text: clip(b.label) })
  if (b.type === 'component') return t('emailEditor.blockComponent', { text: clip(b.name) })
  return `${b.type}`
}

function describe(part: any, key: string): Change {
  const name = String(part.type).replace(/^tool-/, '')
  const input = part.input || {}
  const running = part.state === 'input-streaming' || part.state === 'input-available'
  const failed = part.state === 'output-error'
  const base = { key, running, failed }
  switch (name) {
    case 'set_document': return { ...base, icon: 'i-lucide-layout-template', text: running ? t('emailEditor.designing') : t('emailEditor.designed') }
    case 'update_settings': {
      const keys = Object.keys(input.patch || {})
      const what = keys.includes('title') ? (keys.includes('preheader') ? t('emailEditor.whatSubjectAndPreheader') : t('emailEditor.whatSubject')) : keys.includes('preheader') ? t('emailEditor.whatPreheader') : t('emailEditor.whatSettings')
      return { ...base, icon: 'i-lucide-settings-2', text: t('emailEditor.updatedWhat', { what }) }
    }
    case 'update_blocks': {
      const updates = Array.isArray(input.updates) ? input.updates : []
      if (updates.length === 1) return { ...base, icon: 'i-lucide-pencil', text: t('emailEditor.edited', { block: blockName(updates[0].id) }), blockId: updates[0].id }
      return { ...base, icon: 'i-lucide-pencil', text: updates.length ? t('emailEditor.editedCount', { n: updates.length }) : t('emailEditor.editingBlocks') }
    }
    case 'add_block': {
      const id = String(part.output || '').match(/"(blk_[^"]+)"/)?.[1]
      const type = input.type || t('emailEditor.blockWord')
      return { ...base, icon: 'i-lucide-plus', text: input.parentId ? t('emailEditor.addedIn', { type, place: blockName(input.parentId) }) : t('emailEditor.added', { type }), blockId: id }
    }
    case 'replace_block': {
      const n = (input.blocks || []).length
      return { ...base, icon: 'i-lucide-blocks', text: running ? t('emailEditor.rebuilding') : n ? t('emailEditor.rebuilt', n) : t('emailEditor.rebuiltNone') }
    }
    case 'save_component': return { ...base, icon: 'i-lucide-puzzle', text: running ? t('emailEditor.savingComponent') : t('emailEditor.savedComponent', { name: input.name || t('emailEditor.aComponent') }), blockId: String(part.output || '').match(/as block "(blk_[^"]+)"|"(blk_[^"]+)"\./)?.slice(1).find(Boolean) }
    case 'remove_block': return { ...base, icon: 'i-lucide-trash-2', text: t('emailEditor.removed') }
    case 'move_block': return { ...base, icon: 'i-lucide-arrow-up-down', text: t('emailEditor.moved', { block: blockName(input.id) }), blockId: input.id }
    case 'set_theme': return { ...base, icon: 'i-lucide-palette', text: input.preset ? t('emailEditor.appliedTheme', { preset: input.preset }) : t('emailEditor.restyled') }
    case 'set_variables': return { ...base, icon: 'i-lucide-braces', text: t('emailEditor.setVariables', { list: (input.variables || []).map((v: TemplateVariable) => `{{${v.key}}}`).join(', ') || t('emailEditor.variablesWord') }) }
    case 'check_email': {
      const out = String(part.output || '')
      const count = out && !out.startsWith('All checks') ? out.split('\n').length : 0
      return { ...base, icon: 'i-lucide-shield-check', text: running ? t('emailEditor.checking') : count ? t('emailEditor.foundIssues', count) : t('emailEditor.allChecksPass') }
    }
    default: return { ...base, icon: 'i-lucide-wand-2', text: name.replace(/_/g, ' ') }
  }
}

/** A reply's parts in order, with back-to-back tool calls gathered into one list. */
function segments(message: UIMessage): Segment[] {
  const out: Segment[] = []
  message.parts.forEach((part, i) => {
    const key = `${message.id}-${i}`
    const last = out.at(-1)
    if (isTextUIPart(part) && part.text.trim()) out.push({ key, kind: 'text', text: part.text })
    else if (isToolUIPart(part)) {
      if (last?.kind === 'changes') last.changes.push(describe(part, key))
      else out.push({ key, kind: 'changes', changes: [describe(part, key)] })
    }
  })
  return out
}

/** Nothing is streaming between steps, so say the designer is still at it. */
function thinking(message: UIMessage, segs: Segment[]): boolean {
  const last = segs.at(-1)
  return working(message) && (!last || (last.kind === 'changes' && !last.changes.some(c => c.running)))
}

const textOf = (message: UIMessage) => message.parts.filter(isTextUIPart).map(p => p.text).join('\n\n').trim()

const { copy: copyText, copied } = useClipboard({ copiedDuring: 1500 })
const copiedId = ref<string | null>(null)
function copy(message: UIMessage) {
  copiedId.value = message.id
  copyText(textOf(message))
}

function changedDesign(message: UIMessage): boolean {
  return message.parts.some(p => isToolUIPart(p) && EDITING_TOOLS.has(String(p.type).replace(/^tool-/, '')) && p.state === 'output-available')
}

/** The snapshot to restore for an assistant reply: the design before the user message it answers. */
function undoFor(message: UIMessage): EmailDocument | null {
  const i = chat.value.messages.findIndex(m => m.id === message.id)
  const asked = i > 0 ? chat.value.messages[i - 1] : null
  return asked?.role === 'user' ? before.get(asked.id) || null : null
}

function undoTurn(message: UIMessage) {
  const snapshot = undoFor(message)
  if (snapshot) emit('restore', snapshot)
}

// ---- suggestions -----------------------------------------------------------------
const selectedBlock = computed(() => props.selectedId ? findBlock(props.document.blocks, props.selectedId) : null)

const starters = computed(() => props.master
  ? [
      { icon: 'i-lucide-hand', label: t('emailEditor.starters.welcomeLabel'), prompt: t('emailEditor.starters.welcomeMasterPrompt', { firstName: '{{firstName}}', projectUrl: '{{project.url}}' }) },
      { icon: 'i-lucide-key-round', label: t('emailEditor.starters.resetLabel'), prompt: t('emailEditor.starters.resetPrompt', { resetUrl: '{{resetUrl}}', expiresIn: '{{expiresIn}}' }) },
      { icon: 'i-lucide-receipt', label: t('emailEditor.starters.receiptLabel'), prompt: t('emailEditor.starters.receiptPrompt', { orderId: '{{orderId}}', total: '{{total}}', orderUrl: '{{orderUrl}}' }) },
      { icon: 'i-lucide-newspaper', label: t('emailEditor.starters.updateLabel'), prompt: t('emailEditor.starters.updatePrompt', { unsubscribeUrl: '{{unsubscribeUrl}}' }) }
    ]
  : [
      { icon: 'i-lucide-hand', label: t('emailEditor.starters.welcomeLabel'), prompt: t('emailEditor.starters.welcomePrompt', { firstName: '{{firstName}}' }) },
      { icon: 'i-lucide-message-square-reply', label: t('emailEditor.starters.supportLabel'), prompt: t('emailEditor.starters.supportPrompt', { question: '{{question}}', articleUrl: '{{articleUrl}}' }) },
      { icon: 'i-lucide-calendar', label: t('emailEditor.starters.eventLabel'), prompt: t('emailEditor.starters.eventPrompt', { eventDate: '{{eventDate}}', rsvpUrl: '{{rsvpUrl}}' }) },
      { icon: 'i-lucide-sparkles', label: t('emailEditor.starters.launchLabel'), prompt: t('emailEditor.starters.launchPrompt') }
    ])

const quickActions = computed(() => {
  if (selectedBlock.value) {
    const type = selectedBlock.value.type
    return [
      ...(type === 'html' ? [{ icon: 'i-lucide-blocks', label: t('emailEditor.quick.convertLabel'), prompt: t('emailEditor.quick.convertPrompt') }] : []),
      ...(type === 'html' || type === 'section' ? [{ icon: 'i-lucide-puzzle', label: t('emailEditor.quick.reusableLabel'), prompt: t('emailEditor.quick.reusablePrompt') }] : []),
      { icon: 'i-lucide-wand-sparkles', label: t('emailEditor.quick.improveLabel'), prompt: t('emailEditor.quick.improvePrompt') },
      { icon: 'i-lucide-scissors', label: t('emailEditor.quick.shorterLabel'), prompt: t('emailEditor.quick.shorterPrompt') },
      { icon: 'i-lucide-smile', label: t('emailEditor.quick.friendlierLabel'), prompt: t('emailEditor.quick.friendlierPrompt') },
      { icon: 'i-lucide-sparkles', label: t('emailEditor.quick.popLabel'), prompt: t('emailEditor.quick.popPrompt') }
    ]
  }
  const actions = [
    { icon: 'i-lucide-pen-line', label: t('emailEditor.quick.improveCopyLabel'), prompt: t('emailEditor.quick.improveCopyPrompt') },
    { icon: 'i-lucide-paintbrush', label: t('emailEditor.quick.polishLabel'), prompt: t('emailEditor.quick.polishPrompt') },
    { icon: 'i-lucide-lightbulb', label: t('emailEditor.quick.subjectLabel'), prompt: t('emailEditor.quick.subjectPrompt') },
    { icon: 'i-lucide-smartphone', label: t('emailEditor.quick.mobileLabel'), prompt: t('emailEditor.quick.mobilePrompt') }
  ]
  if (props.issues.length) actions.unshift({ icon: 'i-lucide-wrench', label: t('emailEditor.quick.fixLabel', props.issues.length), prompt: fixPrompt(props.issues) })
  return actions
})

function fixPrompt(issues: EmailIssue[]): string {
  return t('emailEditor.quick.fixPrompt', { issues: issues.map(i => `- ${i.fix}`).join('\n') })
}

const placeholder = computed(() => selectedBlock.value ? t('emailEditor.askChangeSelected', { type: selectedBlock.value.type }) : t('emailEditor.describeEmail'))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">

    <Teleport v-if="header" :to="header">
      <UPopover v-model:open="historyOpen" :content="{ side: 'bottom', align: 'end' }">
        <UButton icon="i-lucide-history" size="xs" color="neutral" variant="ghost" :aria-label="$t('emailEditor.chatHistory')" :title="$t('emailEditor.chatHistory')" />
        <template #content>
          <div class="w-72 p-1">
            <p class="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">{{ $t('emailEditor.chats') }}</p>
            <div v-if="loadingChats && !chats.length" class="space-y-2.5 px-2 py-2" aria-hidden="true">
              <USkeleton class="h-3.5 w-4/5" />
              <USkeleton class="h-3.5 w-3/5" />
            </div>
            <p v-else-if="!chats.length" class="px-2 pt-1 pb-2 text-sm text-muted">{{ $t('emailEditor.noChats') }}</p>
            <ul v-else class="max-h-80 overflow-y-auto">
              <li
                v-for="(c, i) in chats"
                :key="c.id"
                class="group/chat flex animate-row-in items-center gap-1 rounded-md pe-1 transition-colors hover:bg-elevated"
                :class="c.id === chat.id && 'bg-elevated'"
                :style="{ animationDelay: `${Math.min(i, 8) * 30}ms` }"
              >
                <button type="button" class="flex min-w-0 flex-1 items-center gap-2 py-1.5 ps-2 text-left text-sm" @click="openChat(c.id)">
                  <UIcon v-if="c.running" name="i-lucide-loader-circle" class="size-3.5 shrink-0 animate-spin text-primary" />
                  <span class="min-w-0 flex-1 truncate" :class="c.id === chat.id ? 'text-highlighted' : 'text-toned'">{{ c.title || $t('emailEditor.untitledChat') }}</span>
                  <span class="shrink-0 text-xs text-dimmed">{{ formatChatListStamp(c.updatedAt) }}</span>
                </button>
                <UButton
                  v-if="!c.running"
                  :icon="confirmDelete === c.id ? undefined : 'i-lucide-trash-2'"
                  :label="confirmDelete === c.id ? $t('emailEditor.delete') : undefined"
                  size="xs"
                  :color="confirmDelete === c.id ? 'error' : 'neutral'"
                  :variant="confirmDelete === c.id ? 'soft' : 'ghost'"
                  :aria-label="confirmDelete === c.id ? $t('emailEditor.confirmDeleteChat') : $t('emailEditor.deleteChat')"
                  :class="confirmDelete !== c.id && '[@media(hover:hover)]:opacity-0 group-hover/chat:opacity-100 focus-visible:opacity-100'"
                  @click="deleteChat(c.id)"
                />
              </li>
            </ul>
          </div>
        </template>
      </UPopover>
      <UTooltip :text="$t('emailEditor.newChat')">
        <UButton icon="i-lucide-square-pen" size="xs" color="neutral" variant="ghost" :aria-label="$t('emailEditor.newChat')" :disabled="!chat.messages.length" @click="newChat" />
      </UTooltip>
    </Teleport>

    <Transition name="fade" mode="out-in">
      <!-- Empty: a greeting and starting points, like a new chat. -->
      <div v-if="!chat.messages.length" key="empty" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
        <div v-if="switching" class="space-y-4" aria-hidden="true">
          <USkeleton class="ms-auto h-9 w-3/5 rounded-2xl" />
          <div class="flex gap-1.5">
            <USkeleton class="size-5 shrink-0 rounded-full" />
            <div class="flex-1 space-y-2 pt-1">
              <USkeleton class="h-3 w-4/5" />
              <USkeleton class="h-3 w-3/5" />
            </div>
          </div>
        </div>
        <!-- The mark pops in, then the words and the starters follow it. -->
        <div v-else class="my-auto flex flex-col items-center text-center">
          <span class="grid size-10 animate-chat-pop place-items-center rounded-full shadow-lg" :class="ORB">
            <UIcon name="i-lucide-sparkles" class="size-5" />
          </span>
          <!-- Inline delays: .animate-row-in sits outside Tailwind's layers, so a delay utility would lose to it. -->
          <p class="mt-3 animate-row-in text-[15px] font-semibold text-highlighted" style="animation-delay: 80ms">{{ $t('emailEditor.greeting') }}</p>
          <p class="mt-1 max-w-72 animate-row-in text-xs text-muted" style="animation-delay: 130ms">
            {{ $t('emailEditor.describeIt') }} {{ master ? $t('emailEditor.masterHint') : $t('emailEditor.clickBlockHint') }}
          </p>
          <div class="mt-5 flex flex-wrap justify-center gap-1.5">
            <UButton
              v-for="(s, i) in starters"
              :key="s.label"
              :icon="s.icon"
              :label="s.label"
              :title="s.prompt"
              color="neutral"
              variant="outline"
              size="sm"
              class="animate-row-in"
              :style="{ animationDelay: `${180 + i * 45}ms` }"
              :ui="{ leadingIcon: 'text-muted' }"
              @click="send(s.prompt)"
            />
          </div>
        </div>
      </div>

      <!-- Positioned but not scrolling, so the jump-to-latest button stays put. Keyed by chat: each starts at its bottom. -->
      <div v-else :key="chat.id" class="relative flex min-h-0 flex-1 flex-col">
        <div class="min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-8">
          <UChatMessages
            :messages="chat.messages"
            :status="chat.status"
            :assistant="indicatorProps"
            :ui="{ root: 'px-0', autoScroll: 'z-10 bg-default shadow-md' }"
            compact
          >
            <!-- Drawn here rather than by UChatMessages, so a new message can rise in. -->
            <template #default="{ registerMessageRef }">
              <template v-for="message in chat.messages" :key="message.id">
                <UChatMessage
                  v-if="message.parts?.length"
                  :ref="(el: any) => registerMessageRef(message.id, el)"
                  v-bind="message.role === 'user' ? userProps : assistantProps"
                  :id="message.id"
                  :role="message.role"
                  :parts="message.parts"
                  compact
                  :class="fresh(message) && (message.role === 'user' ? 'animate-chat-sent' : 'animate-chat-reply')"
                >
                  <template #content>
                    <EmailChatClamp v-if="message.role === 'user'">
                      <p class="whitespace-pre-wrap">{{ textOf(message) }}</p>
                    </EmailChatClamp>
                    <template v-else>
                      <div v-for="segs in [segments(message)]" :key="message.id" class="space-y-2.5">
                        <!-- The newest reply stays open: it's the one being read. -->
                        <EmailChatClamp :disabled="message.id === lastId">
                          <div class="space-y-2.5">
                            <template v-for="seg in segs" :key="seg.key">
                              <MarkdownBlock
                                v-if="seg.kind === 'text'"
                                :text="seg.text"
                                class="[&>:first-child]:mt-0! [&>:last-child]:mb-0!"
                                :class="fresh(message) && 'animate-row-in'"
                              />
                              <!-- The edits, like v0's steps: each slides in as the designer makes it; click one to select its block. -->
                              <div v-else class="rounded-xl bg-elevated/50 p-1 ring ring-default" :class="fresh(message) && 'animate-row-in'">
                                <button
                                  v-for="c in seg.changes"
                                  :key="c.key"
                                  type="button"
                                  class="group/change flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors"
                                  :class="[c.failed ? 'text-warning' : 'text-toned', c.blockId ? 'hover:bg-accented/70 hover:text-highlighted' : 'cursor-default', fresh(message) && 'animate-row-in']"
                                  :disabled="!c.blockId"
                                  @click="c.blockId && emit('select', c.blockId)"
                                >
                                  <!-- Keyed by state, so a finished edit's icon pops in over the spinner. -->
                                  <UIcon
                                    :key="c.running ? 'running' : c.failed ? 'failed' : 'done'"
                                    :name="c.running ? 'i-lucide-loader-circle' : c.failed ? 'i-lucide-triangle-alert' : c.icon"
                                    class="size-3.5 shrink-0"
                                    :class="[c.running ? 'animate-spin text-primary' : !c.failed && 'text-muted', fresh(message) && !c.running && 'animate-chat-pop']"
                                  />
                                  <span class="min-w-0 truncate">
                                    <UChatShimmer v-if="c.running" :text="c.text" />
                                    <template v-else>{{ c.text }}</template>
                                  </span>
                                  <UIcon v-if="c.blockId" name="i-lucide-arrow-up-right" class="ms-auto size-3 shrink-0 opacity-0 transition-opacity group-hover/change:opacity-60" />
                                </button>
                              </div>
                            </template>

                            <p v-if="thinking(message, segs)" class="animate-[fade-in_300ms_var(--ease-out)]">
                              <UChatShimmer :text="$t('emailEditor.thinking')" class="text-sm" />
                            </p>
                          </div>
                        </EmailChatClamp>

                        <!-- Always under the newest reply; older ones show theirs on hover. -->
                        <div
                          v-if="!working(message)"
                          class="-ms-1.5 flex items-center gap-0.5 transition-opacity"
                          :class="[message.id !== lastId && '[@media(hover:hover)]:opacity-0 group-hover/message:opacity-100 focus-within:opacity-100', fresh(message) && 'animate-[fade-in_300ms_var(--ease-out)]']"
                        >
                          <UTooltip v-if="textOf(message)" :text="copied && copiedId === message.id ? $t('emailEditor.copied') : $t('emailEditor.copy')">
                            <UButton :icon="copied && copiedId === message.id ? 'i-lucide-check' : 'i-lucide-copy'" size="xs" color="neutral" variant="ghost" :aria-label="$t('emailEditor.copyReply')" @click="copy(message)" />
                          </UTooltip>
                          <UTooltip v-if="message.id === lastId" :text="$t('emailEditor.tryAgain')">
                            <UButton icon="i-lucide-refresh-cw" size="xs" color="neutral" variant="ghost" :aria-label="$t('emailEditor.tryAgain')" @click="retry" />
                          </UTooltip>
                          <UButton v-if="changedDesign(message) && undoFor(message)" icon="i-lucide-undo-2" :label="$t('emailEditor.undoChanges')" size="xs" color="neutral" variant="ghost" @click="undoTurn(message)" />
                        </div>

                        <!-- Follow-ups fan in once the reply is done, and again when the selection changes them. -->
                        <div v-if="message.id === lastId && !busy" class="flex flex-wrap gap-1.5">
                          <UButton
                            v-for="(a, i) in quickActions"
                            :key="a.label"
                            :icon="a.icon"
                            :label="a.label"
                            size="xs"
                            :color="a.icon === 'i-lucide-wrench' ? 'warning' : 'neutral'"
                            :variant="a.icon === 'i-lucide-wrench' ? 'soft' : 'outline'"
                            class="animate-row-in"
                            :style="{ animationDelay: `${i * 40}ms` }"
                            @click="send(a.prompt)"
                          />
                        </div>
                      </div>
                    </template>
                  </template>
                </UChatMessage>
              </template>
            </template>

            <template #indicator>
              <UChatShimmer :text="$t('emailEditor.thinking')" class="text-sm" />
            </template>
          </UChatMessages>
        </div>
      </div>
    </Transition>

    <!-- The composer floats over the end of the transcript, which fades under it. -->
    <div class="relative shrink-0 px-3 pb-3">
      <div class="pointer-events-none absolute inset-x-0 bottom-full h-6 bg-linear-to-t from-(--ui-bg) to-transparent" />

      <Transition name="fade" mode="out-in">
        <div v-if="!online" key="offline" class="mb-2 flex items-start gap-2 rounded-xl bg-elevated px-3 py-2 text-xs text-muted ring ring-default">
          <UIcon name="i-lucide-wifi-off" class="mt-px size-3.5 shrink-0" />
          <span>{{ $t('emailEditor.offline') }}</span>
        </div>
        <div v-else-if="chat.error" key="error" class="mb-2 flex items-start gap-2 rounded-xl bg-error/10 py-2 ps-3 pe-2 text-xs text-error">
          <UIcon name="i-lucide-circle-alert" class="mt-px size-3.5 shrink-0" />
          <span class="line-clamp-3 min-w-0 flex-1">{{ errorText }}</span>
          <UButton :label="$t('emailEditor.retry')" size="xs" color="error" variant="soft" class="-my-0.5" @click="recover" />
        </div>
      </Transition>

      <UChatPrompt
        v-model="input"
        :placeholder="placeholder"
        variant="naked"
        :maxrows="8"
        :ui="{
          root: 'gap-1.5 rounded-2xl bg-default px-2.5 pt-2.5 pb-2 ring ring-default shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.18)] transition-shadow duration-300 focus-within:shadow-[0_1px_2px_rgb(0_0_0/0.05),0_14px_32px_-12px_rgb(0_0_0/0.26)] focus-within:ring-accented dark:bg-elevated',
          base: 'px-1'
        }"
        @submit="send(input)"
      >
        <template v-if="selectedBlock" #header>
          <!-- Keyed by block, so pointing at another one pops the chip again. -->
          <span :key="selectedBlock.id" class="inline-flex min-w-0 max-w-full animate-[scale-in_200ms_var(--ease-out)] items-center gap-1.5 rounded-lg bg-elevated py-0.5 ps-2 pe-0.5 text-xs text-toned ring ring-default">
            <UIcon :name="EMAIL_BLOCK_META[selectedBlock.type].icon" class="size-3.5 shrink-0 text-primary" />
            <span class="truncate">{{ emailBlockLabel(selectedBlock) }}</span>
            <UButton icon="i-lucide-x" size="xs" color="neutral" variant="link" :aria-label="$t('emailEditor.clearSelection')" class="p-0.5" @click="emit('select', null)" />
          </span>
        </template>

        <template #footer>
          <UDropdownMenu :items="tierItems" :content="{ side: 'top', align: 'start' }" :ui="{ content: 'w-72', itemDescription: 'whitespace-normal!' }">
            <UButton
              :icon="currentTier.icon"
              :label="currentTier.label"
              trailing-icon="i-lucide-chevron-down"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="$t('emailEditor.modelName', { name: currentTier.label })"
              class="-ms-1"
              :ui="{ trailingIcon: 'size-3.5 text-dimmed' }"
            />
          </UDropdownMenu>
          <div class="flex-1" />
          <!-- Black and full size when there is something to send, like ChatGPT; Retry above handles errors. -->
          <span class="transition-transform duration-200 ease-out" :class="input.trim() || busy ? 'scale-100' : 'scale-90'">
            <UChatPromptSubmit
              :status="chat.status === 'error' ? 'ready' : chat.status"
              :disabled="!input.trim() || !online || stopping"
              color="neutral"
              :variant="input.trim() ? 'solid' : 'soft'"
              submitted-variant="solid"
              streaming-variant="solid"
              size="sm"
              @stop="stop"
            />
          </span>
        </template>
      </UChatPrompt>
    </div>

    <!-- The editor page uses the bare layout, which has no plan limit modal of its own. -->
    <PlanLimitModal />
  </div>
</template>

<style scoped>
/* The designer's mark breathes while it works: on the thinking row, then on the reply. */
:deep([data-status='submitted'] > article:last-of-type [data-slot='leadingAvatar']),
:deep([data-status='streaming'] > article:last-of-type [data-slot='leadingAvatar']) {
  animation: orb-breathe 1.6s ease-in-out infinite;
}

@keyframes orb-breathe {
  50% { transform: scale(0.82); opacity: 0.7; }
}
</style>
