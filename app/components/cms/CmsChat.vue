<script setup lang="ts">
/**
 * The Pages assistant, modelled on the email designer's chat: a greeting with
 * starting points, then a transcript where each reply lists what it changed
 * (click one to select its block), follow-ups under the newest reply, and a
 * composer with the selected block and the model picker.
 *
 * One chat per page (or per component). Every turn sends the live content;
 * the assistant's edits arrive as they stream (`data-content`, `data-page`)
 * and a snapshot from before the turn undoes it in one click. A turn keeps
 * running on the server if this page goes away; opening the chat again
 * re-attaches to it (server/utils/emailAiRuns.ts, keyed per scope).
 */
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, isTextUIPart, isToolUIPart, type UIMessage } from 'ai'
import { useOnline } from '@vueuse/core'
import { findBlock, type CmsBlock, type CmsLibrary } from '#shared/cms/content'
import { EMAIL_AI_TIERS, emailAiTier, type EmailAiTier } from '#shared/email/ai'
import EmailChatClamp from '~/components/email/EmailChatClamp.vue'

const props = defineProps<{
  projectId: string
  entryId?: string
  componentId?: string
  content?: CmsBlock
  selectedId?: string | null
  library: CmsLibrary
  /** Sent once, when the chat opens empty (the wizard's brief). */
  firstPrompt?: string
  /** Shown instead of the composer (a component not saved yet). */
  disabledReason?: string
}>()

const emit = defineEmits<{
  (e: 'content', content: CmsBlock): void
  (e: 'page', page: { name: string, slug: string, style: Record<string, unknown> }): void
  (e: 'component', key: string): void
  (e: 'select', id: string | null): void
  (e: 'checkpoint'): void
  (e: 'restore', content: CmsBlock): void
}>()

const { api, token, workspaceId, planLimit } = useAgent()
const online = useOnline()
const { t } = useI18n()

const ORB = 'bg-linear-to-br from-primary-400 to-primary-600 text-white ring-1 ring-inset ring-white/20 shadow-primary-500/30'
const userProps = { side: 'right', variant: 'soft', ui: { container: 'max-w-[85%]', content: 'rounded-2xl bg-elevated px-3.5 py-2 text-highlighted dark:bg-accented' } } as const
const assistantProps = { side: 'left', variant: 'naked', avatar: { icon: 'i-lucide-sparkles', ui: { icon: 'size-3 text-white' } }, ui: { leading: 'min-h-5', leadingAvatar: `${ORB} shadow-sm` } } as const

// ---- model tier (shared with the email designer) -----------------------------------
const TIER_KEY = 'sb:emailAiTier'
const tier = ref<EmailAiTier>('high')
onMounted(() => {
  try { tier.value = emailAiTier(localStorage.getItem(TIER_KEY)) } catch {}
})
watch(tier, (value) => {
  try { localStorage.setItem(TIER_KEY, value) } catch {}
})
const tierItems = computed(() => Object.entries(EMAIL_AI_TIERS).map(([value, x]) => ({
  label: x.label, description: x.hint, icon: value === 'ultra' ? 'i-lucide-zap' : 'i-lucide-gauge', type: 'checkbox' as const, checked: value === tier.value, onSelect: () => { tier.value = value as EmailAiTier }
})))

// ---- the chat ----------------------------------------------------------------------
const scope = computed(() => ({ project: props.projectId, ...(props.entryId ? { entry: props.entryId } : {}), ...(props.componentId ? { component: props.componentId } : {}) }))
const scopeQuery = () => new URLSearchParams(scope.value as Record<string, string>).toString()
const headers = (): Record<string, string> => ({ Authorization: `Bearer ${token.value}`, ...(workspaceId.value ? { 'X-Workspace': workspaceId.value } : {}) })
let resumeId = ''

const designerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await fetch(input, init)
  if (res.status === 402) {
    const body = await res.clone().json().catch(() => ({}))
    planLimit.value = { message: body.statusMessage || body.message || t('emailEditor.notInPlan'), ...body.data }
  }
  return res
}) as typeof fetch

const transport = new DefaultChatTransport<UIMessage>({
  api: '/v1/admin/cms/chat',
  fetch: designerFetch,
  prepareSendMessagesRequest: ({ messages }) => ({
    headers: headers(),
    body: { ...scope.value, messages: messages.slice(-20), content: props.content, selectedId: props.selectedId, tier: tier.value }
  }),
  prepareReconnectToStreamRequest: () => ({ api: `/v1/admin/cms/chat/stream?${scopeQuery()}&id=${encodeURIComponent(resumeId)}`, headers: headers() })
})

function makeChat(messages: UIMessage[] = []): Chat<UIMessage> {
  const instance: Chat<UIMessage> = new Chat<UIMessage>({
    messages,
    transport,
    onData: (part) => {
      if (chat.value !== instance || !part.data) return
      if (part.type === 'data-content') emit('content', part.data as unknown as CmsBlock)
      if (part.type === 'data-page') emit('page', part.data as never)
      if (part.type === 'data-component') emit('component', String((part.data as { key?: string }).key || ''))
    }
  })
  return instance
}

const chat = shallowRef(makeChat())
const loading = ref(true)
const busy = computed(() => chat.value.status === 'submitted' || chat.value.status === 'streaming')
const input = ref('')
const lastId = computed(() => chat.value.messages.at(-1)?.id)
const working = (m: UIMessage) => busy.value && m.id === lastId.value

async function load() {
  if (props.disabledReason) return void (loading.value = false)
  try {
    const state = await api<{ messages: UIMessage[], streamId: string | null }>('/admin/cms/chat', { query: scope.value })
    chat.value = makeChat(state.messages)
    if (state.streamId) {
      resumeId = state.streamId
      void chat.value.resumeStream()
    } else if (!state.messages.length && props.firstPrompt) {
      send(props.firstPrompt)
    }
  } catch {} finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.componentId, () => {
  if (props.componentId) load()
})

// The content before each turn, by the user message that started it.
const before = reactive(new Map<string, CmsBlock>())
let pending: CmsBlock | null = null
watch(() => chat.value.messages.length, () => {
  const last = chat.value.messages.at(-1)
  if (pending && last?.role === 'user') {
    before.set(last.id, pending)
    pending = null
  }
})

function send(text: string) {
  const message = text.trim()
  if (!message || busy.value || !online.value || props.disabledReason) return
  if (props.content) {
    pending = JSON.parse(JSON.stringify(props.content))
    emit('checkpoint')
  }
  chat.value.sendMessage({ text: message })
  input.value = ''
}

async function stop() {
  const asked = chat.value.messages.findLast(m => m.role === 'user')?.id
  void chat.value.stop()
  await api('/admin/cms/chat/stream', { method: 'DELETE', query: { ...scope.value, message: asked } }).catch(() => {})
}

async function clear() {
  if (busy.value) await stop()
  await api('/admin/cms/chat', { method: 'DELETE', query: scope.value }).catch(() => {})
  chat.value = makeChat()
  before.clear()
}

async function retry() {
  const asked = chat.value.messages.findLast(m => m.role === 'user')
  if (!asked || busy.value) return
  const snapshot = before.get(asked.id)
  if (snapshot) emit('restore', snapshot)
  await nextTick()
  void chat.value.regenerate()
}

// A dropped connection: the server carries on, so pick the turn back up.
watch(() => chat.value.error, async (error) => {
  if (!(error instanceof TypeError) || !online.value) return
  const state = await api<{ messages: UIMessage[], streamId: string | null }>('/admin/cms/chat', { query: scope.value }).catch(() => null)
  if (!state) return
  chat.value = makeChat(state.messages)
  if (state.streamId) {
    resumeId = state.streamId
    void chat.value.resumeStream()
  }
})

const errorText = computed(() => {
  const error = chat.value.error
  if (!error) return ''
  if (error instanceof TypeError) return t('emailEditor.lostConnection')
  try {
    const body = JSON.parse(error.message)
    return body.statusMessage || body.message || error.message
  } catch {
    return error.message
  }
})

// ---- reading a turn --------------------------------------------------------------
type Change = { key: string, icon: string, text: string, uid?: string, running: boolean, failed: boolean }
type Segment = { key: string, kind: 'text', text: string } | { key: string, kind: 'changes', changes: Change[] }
const EDITS = new Set(['set_content', 'apply_template', 'add_block', 'update_blocks', 'move_block', 'remove_block', 'update_page'])

function blockName(uid: string): string {
  const b = props.content ? findBlock(props.content, uid, props.library)?.block : null
  return b ? props.library.get(b.component)?.name || b.component : t('projectTools.pages.ai.aBlock')
}

function describe(part: any, key: string): Change {
  const name = String(part.type).replace(/^tool-/, '')
  const input = part.input || {}
  const running = part.state === 'input-streaming' || part.state === 'input-available'
  const base = { key, running, failed: part.state === 'output-error' }
  switch (name) {
    case 'set_content': return { ...base, icon: 'i-lucide-layout-template', text: running ? t('projectTools.pages.ai.designing') : t('projectTools.pages.ai.designed') }
    case 'apply_template': return { ...base, icon: 'i-lucide-layout-template', text: t('projectTools.pages.ai.template', { name: input.template || '' }) }
    case 'add_block': return { ...base, icon: 'i-lucide-plus', text: t('projectTools.pages.ai.added', { name: props.library.get(input.block?.component)?.name || input.block?.component || '' }) }
    case 'update_blocks': {
      const updates = Array.isArray(input.updates) ? input.updates : []
      return updates.length === 1
        ? { ...base, icon: 'i-lucide-pencil', text: t('projectTools.pages.ai.edited', { name: blockName(updates[0].uid) }), uid: updates[0].uid }
        : { ...base, icon: 'i-lucide-pencil', text: t('projectTools.pages.ai.editedCount', { n: updates.length }) }
    }
    case 'move_block': return { ...base, icon: 'i-lucide-arrow-up-down', text: t('projectTools.pages.ai.moved', { name: blockName(input.uid) }), uid: input.uid }
    case 'remove_block': return { ...base, icon: 'i-lucide-trash-2', text: t('projectTools.pages.ai.removed') }
    case 'update_page': return { ...base, icon: 'i-lucide-palette', text: t('projectTools.pages.ai.page') }
    case 'save_component': return { ...base, icon: 'i-lucide-puzzle', text: running ? t('projectTools.pages.ai.writingComponent') : t('projectTools.pages.ai.savedComponent', { name: input.name || input.key || '' }) }
    case 'get_component': return { ...base, icon: 'i-lucide-box', text: t('projectTools.pages.ai.readComponent', { name: input.key || '' }) }
    case 'update_brief': return { ...base, icon: 'i-lucide-target', text: t('projectTools.pages.ai.brief') }
    case 'read_repo': return { ...base, icon: 'i-lucide-github', text: running ? t('projectTools.pages.ai.readingRepo') : t('projectTools.pages.ai.readRepo', { name: input.repo || '' }) }
    default: return { ...base, icon: 'i-lucide-wand-2', text: name.replace(/_/g, ' ') }
  }
}

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

const textOf = (m: UIMessage) => m.parts.filter(isTextUIPart).map(p => p.text).join('\n\n').trim()
const changed = (m: UIMessage) => m.parts.some(p => isToolUIPart(p) && EDITS.has(String(p.type).replace(/^tool-/, '')) && p.state === 'output-available')
function undoFor(message: UIMessage): CmsBlock | null {
  const i = chat.value.messages.findIndex(m => m.id === message.id)
  const asked = i > 0 ? chat.value.messages[i - 1] : null
  return asked?.role === 'user' ? before.get(asked.id) || null : null
}

// ---- suggestions -----------------------------------------------------------------
const selected = computed(() => props.selectedId && props.content ? findBlock(props.content, props.selectedId, props.library)?.block ?? null : null)
const p = (k: string) => ({ label: t(`projectTools.pages.ai.starters.${k}`), prompt: t(`projectTools.pages.ai.prompts.${k}`) })
const starters = computed(() => props.componentId
  ? [{ icon: 'i-lucide-puzzle', ...p('writeComponent') }, { icon: 'i-lucide-smartphone', ...p('responsive') }, { icon: 'i-lucide-list-plus', ...p('fields') }]
  : [{ icon: 'i-lucide-github', ...p('fromRepo') }, { icon: 'i-lucide-target', ...p('valueProp') }, { icon: 'i-lucide-pen-line', ...p('hero') }, { icon: 'i-lucide-sparkles', ...p('animate') }, { icon: 'i-lucide-puzzle', ...p('newComponent') }])
const quick = computed(() => props.componentId
  ? [{ icon: 'i-lucide-paintbrush', ...p('polish') }, { icon: 'i-lucide-smartphone', ...p('responsive') }]
  : selected.value
    ? [{ icon: 'i-lucide-pen-line', ...p('rewrite') }, { icon: 'i-lucide-scissors', ...p('shorter') }, { icon: 'i-lucide-sparkles', ...p('animateOne') }, { icon: 'i-lucide-puzzle', ...p('toComponent') }]
    : [{ icon: 'i-lucide-pen-line', ...p('copy') }, { icon: 'i-lucide-target', ...p('valueProp') }, { icon: 'i-lucide-quote', ...p('proof') }, { icon: 'i-lucide-message-circle-question', ...p('faq') }])
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="disabledReason" class="my-auto px-6 py-10 text-center text-xs text-muted">{{ disabledReason }}</div>
    <template v-else>
      <div v-if="!chat.messages.length" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
        <USkeleton v-if="loading" class="h-24 w-full" />
        <div v-else class="my-auto flex flex-col items-center text-center">
          <span class="grid size-10 place-items-center rounded-full shadow-lg" :class="ORB"><UIcon name="i-lucide-sparkles" class="size-5" /></span>
          <p class="mt-3 text-[15px] font-semibold text-highlighted">{{ $t('projectTools.pages.ai.greeting') }}</p>
          <p class="mt-1 max-w-72 text-xs text-muted">{{ componentId ? $t('projectTools.pages.ai.componentHint') : $t('projectTools.pages.ai.pageHint') }}</p>
          <div class="mt-5 flex flex-wrap justify-center gap-1.5">
            <UButton v-for="s in starters" :key="s.label" :icon="s.icon" :label="s.label" :title="s.prompt" color="neutral" variant="outline" size="sm" :ui="{ leadingIcon: 'text-muted' }" @click="send(s.prompt)" />
          </div>
        </div>
      </div>

      <div v-else class="relative flex min-h-0 flex-1 flex-col">
        <div class="flex shrink-0 justify-end px-2 pt-1">
          <UButton icon="i-lucide-square-pen" :label="$t('projectTools.pages.ai.clear')" size="xs" color="neutral" variant="ghost" @click="clear" />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
          <UChatMessages :messages="chat.messages" :status="chat.status" :assistant="assistantProps" :ui="{ root: 'px-0', autoScroll: 'z-10 bg-default shadow-md' }" compact>
            <template #default="{ registerMessageRef }">
              <template v-for="message in chat.messages" :key="message.id">
                <UChatMessage v-if="message.parts?.length" :id="message.id" :ref="(el: any) => registerMessageRef(message.id, el)" v-bind="message.role === 'user' ? userProps : assistantProps" :role="message.role" :parts="message.parts" compact>
                  <template #content>
                    <EmailChatClamp v-if="message.role === 'user'"><p class="whitespace-pre-wrap">{{ textOf(message) }}</p></EmailChatClamp>
                    <div v-else class="space-y-2.5">
                      <template v-for="seg in segments(message)" :key="seg.key">
                        <MarkdownBlock v-if="seg.kind === 'text'" :text="seg.text" class="[&>:first-child]:mt-0! [&>:last-child]:mb-0!" />
                        <div v-else class="rounded-xl bg-elevated/50 p-1 ring ring-default">
                          <button v-for="c in seg.changes" :key="c.key" type="button" class="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors" :class="[c.failed ? 'text-warning' : 'text-toned', c.uid ? 'hover:bg-accented/70' : 'cursor-default']" :disabled="!c.uid" @click="c.uid && emit('select', c.uid)">
                            <UIcon :name="c.running ? 'i-lucide-loader-circle' : c.failed ? 'i-lucide-triangle-alert' : c.icon" class="size-3.5 shrink-0" :class="c.running ? 'animate-spin text-primary' : 'text-muted'" />
                            <span class="min-w-0 truncate"><UChatShimmer v-if="c.running" :text="c.text" /><template v-else>{{ c.text }}</template></span>
                          </button>
                        </div>
                      </template>
                      <div v-if="!working(message)" class="-ms-1.5 flex items-center gap-0.5">
                        <UButton v-if="message.id === lastId" icon="i-lucide-refresh-cw" size="xs" color="neutral" variant="ghost" :aria-label="$t('emailEditor.tryAgain')" @click="retry" />
                        <UButton v-if="changed(message) && undoFor(message)" icon="i-lucide-undo-2" :label="$t('emailEditor.undoChanges')" size="xs" color="neutral" variant="ghost" @click="emit('restore', undoFor(message)!)" />
                      </div>
                      <div v-if="message.id === lastId && !busy" class="flex flex-wrap gap-1.5">
                        <UButton v-for="a in quick" :key="a.label" :icon="a.icon" :label="a.label" size="xs" color="neutral" variant="outline" @click="send(a.prompt)" />
                      </div>
                    </div>
                  </template>
                </UChatMessage>
              </template>
            </template>
            <template #indicator><UChatShimmer :text="$t('emailEditor.thinking')" class="text-sm" /></template>
          </UChatMessages>
        </div>
      </div>

      <div class="relative shrink-0 px-3 pb-3">
        <div v-if="chat.error" class="mb-2 flex items-start gap-2 rounded-xl bg-error/10 py-2 ps-3 pe-2 text-xs text-error">
          <UIcon name="i-lucide-circle-alert" class="mt-px size-3.5 shrink-0" />
          <span class="line-clamp-3 min-w-0 flex-1">{{ errorText }}</span>
          <UButton :label="$t('emailEditor.retry')" size="xs" color="error" variant="soft" class="-my-0.5" @click="retry" />
        </div>
        <UChatPrompt
          v-model="input"
          :placeholder="selected ? $t('projectTools.pages.ai.askSelected', { name: library.get(selected.component)?.name || selected.component }) : componentId ? $t('projectTools.pages.ai.askComponent') : $t('projectTools.pages.ai.ask')"
          variant="naked"
          :maxrows="8"
          :ui="{ root: 'gap-1.5 rounded-2xl bg-default px-2.5 pt-2.5 pb-2 ring ring-default shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.18)] focus-within:ring-accented dark:bg-elevated', base: 'px-1' }"
          @submit="send(input)"
        >
          <template v-if="selected" #header>
            <span class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-elevated py-0.5 ps-2 pe-0.5 text-xs text-toned ring ring-default">
              <UIcon name="i-lucide-box" class="size-3.5 shrink-0 text-primary" />
              <span class="truncate">{{ library.get(selected.component)?.name || selected.component }}</span>
              <UButton icon="i-lucide-x" size="xs" color="neutral" variant="link" :aria-label="$t('emailEditor.clearSelection')" class="p-0.5" @click="emit('select', null)" />
            </span>
          </template>
          <template #footer>
            <UDropdownMenu :items="tierItems" :content="{ side: 'top', align: 'start' }" :ui="{ content: 'w-64', itemDescription: 'whitespace-normal!' }">
              <UButton :icon="tier === 'ultra' ? 'i-lucide-zap' : 'i-lucide-gauge'" :label="EMAIL_AI_TIERS[tier].label" trailing-icon="i-lucide-chevron-down" color="neutral" variant="ghost" size="xs" class="-ms-1" :ui="{ trailingIcon: 'size-3.5 text-dimmed' }" />
            </UDropdownMenu>
            <div class="flex-1" />
            <UChatPromptSubmit :status="chat.status === 'error' ? 'ready' : chat.status" :disabled="!input.trim() || !online" color="neutral" :variant="input.trim() ? 'solid' : 'soft'" submitted-variant="solid" streaming-variant="solid" size="sm" @stop="stop" />
          </template>
        </UChatPrompt>
      </div>
      <PlanLimitModal />
    </template>
  </div>
</template>
