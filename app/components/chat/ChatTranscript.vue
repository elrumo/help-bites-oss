<template>
  <div ref="scrollerRef" class="relative flex-1 min-h-0 overflow-y-auto pl-6 pr-4 py-3" @click="onScrollerClick">
    <div v-if="loading && !messages.length" class="flex flex-col gap-2 py-3">
      <div v-for="i in 5" :key="i" class="flex" :class="i % 2 === 0 ? 'justify-end' : 'justify-start'">
        <div class="max-w-[65%] h-10 rounded-[18px] animate-pulse" :class="[i % 2 === 0 ? 'bg-primary-200 dark:bg-primary-900' : 'bg-stone-200 dark:bg-stone-800', i === 1 || i === 4 ? 'w-40' : 'w-28']" />
      </div>
    </div>

    <div v-else-if="!messages.length" class="h-full flex flex-col items-center justify-center text-center">
      <slot name="empty"><p class="text-sm text-stone-500 dark:text-stone-400">{{ emptyText ?? $t('chat.noMessagesYet') }}</p></slot>
    </div>

    <div v-else ref="contentRef" class="min-h-full flex flex-col">
      <div class="mt-auto" />

      <div v-if="hasEarlier" class="flex justify-center pb-2">
        <UButton :label="$t('chat.loadEarlier')" color="neutral" variant="ghost" size="xs" :loading="loadingEarlier" @click="emit('load-earlier')" />
      </div>

      <div
        v-for="bracket in brackets"
        :key="bracket.id"
        class="absolute left-1.5 w-2.5 rounded-l-lg border-l-2 border-y-2 border-stone-300 dark:border-stone-600 pointer-events-none transition-opacity"
        :style="{ top: `${bracket.top}px`, height: `${bracket.height}px` }"
        aria-hidden="true"
      />

      <div v-for="group in groups" :key="group.key">
        <p class="text-center text-[11px] text-stone-500/80 dark:text-stone-400/80 font-medium my-3 transition-[filter,opacity] duration-200" :class="openThreadId && !group.runs.some(run => run.messages.some(inThread)) ? 'opacity-30 blur-[1px]' : ''">
          <span class="font-semibold text-stone-600 dark:text-stone-300">{{ separator(group.startedAt).day }}</span>
          {{ separator(group.startedAt).time }}
        </p>

        <div v-for="run in group.runs" :key="run.key" class="flex flex-col mb-2 last:mb-0" :class="run.sender === ownSender ? 'items-end' : 'items-start'">
          <div
            v-for="(message, index) in run.messages"
            :key="message.clientId || message.id"
            :data-message-id="message.id"
            :data-in-thread="inThread(message) ? 'true' : undefined"
            :inert="dimmed(message)"
            class="flex flex-col transition-[filter,opacity] duration-200"
            :class="[run.sender === ownSender ? 'items-end max-w-[75%]' : 'items-start max-w-[75%]', dimmed(message) ? 'blur-[2px] opacity-40' : '']"
          >
            <!-- Who answered: AI assistant vs human teammate. Shown once atop each source run. -->
            <span
              v-if="sourceTag(run, index)"
              class="mb-0.5 flex items-center gap-1 px-1 text-[11px] font-medium"
              :class="sourceTag(run, index)!.ai ? 'text-primary-600 dark:text-primary-400' : 'text-stone-500 dark:text-stone-400'"
            >
              <img v-if="sourceTag(run, index)!.ai && assistantLogo" :src="assistantLogo" alt="" class="size-3.5 rounded-full object-cover shrink-0">
              <UIcon v-else :name="sourceTag(run, index)!.ai ? 'i-lucide-sparkles' : 'i-lucide-user'" class="size-3 shrink-0" />
              {{ sourceTag(run, index)!.text }}
            </span>
            <p v-if="message.kind === 'event'" class="my-2 px-2 text-[11px] font-medium text-stone-500 dark:text-stone-400">
              {{ eventLabel(message) }}
            </p>
            <span v-else-if="message.visibility === 'internal'" class="mb-0.5 flex items-center gap-1 px-1 text-[11px] font-medium text-amber-700 dark:text-amber-300"><UIcon name="i-lucide-lock-keyhole" class="size-3" />{{ $t('chat.internalNote') }}</span>
            <!-- Context card: what this message is about in the host app. -->
            <a
              v-if="message.context"
              :href="message.context.url || undefined"
              :target="message.context.url ? '_blank' : undefined"
              rel="noopener noreferrer"
              class="flex items-center gap-2.5 max-w-full px-3 py-2 mb-1 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-left"
              :class="message.context.url ? 'hover:border-stone-400 dark:hover:border-stone-500' : 'cursor-default'"
            >
              <img v-if="message.context.thumbnailUrl" :src="message.context.thumbnailUrl" alt="" class="size-9 rounded-lg object-cover shrink-0 bg-stone-100 dark:bg-stone-800" loading="lazy">
              <UIcon v-else name="i-lucide-link" class="size-4 shrink-0 text-stone-400" />
              <span class="min-w-0">
                <span class="block text-xs font-semibold truncate">{{ message.context.label }}</span>
                <span class="block text-[11px] text-stone-500 dark:text-stone-400 truncate">{{ message.context.type }}<span v-if="message.context.url"> · {{ hostOf(message.context.url) }}</span></span>
              </span>
            </a>

            <button
              v-if="quoteFor(message)"
              type="button"
              class="flex items-center gap-1 max-w-full mb-0.5 text-[11px] text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
              :title="quoteFor(message)!.body"
              @click="openThread(rootIdOf(message))"
            >
              <UIcon name="i-lucide-reply" class="size-3 shrink-0" />
              <span class="truncate">{{ messagePreview(quoteFor(message)!.body, 60) }}</span>
            </button>

            <!-- Hover (or right-click) pops Messages' tapback bar over the bubble. -->
            <div v-if="message.kind !== 'event'" class="relative group/bubble w-fit max-w-full flex flex-col" :class="run.sender === ownSender ? 'items-end' : 'items-start'">
              <div
                v-if="canReact(message)"
                class="absolute -top-1 z-20 -translate-y-full flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 shadow-lg opacity-0 group-hover/bubble:opacity-100 focus-within:opacity-100 transition-opacity [@media(hover:none)]:hidden animate-reaction-bar"
                :class="run.sender === ownSender ? 'right-0' : 'left-0'"
              >
                <button
                  v-for="emoji in REACTION_EMOJIS"
                  :key="emoji"
                  type="button"
                  class="size-8 rounded-full text-[17px] leading-none flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-700 active:scale-90 transition-transform"
                  :aria-label="$t('chat.reactWith', { emoji })"
                  @click="emit('react', message, emoji)"
                >{{ emoji }}</button>
              </div>

              <!-- Images get their own bubbles, the way Messages renders pictures. -->
              <button
                v-for="file in message.attachments"
                :key="file.url"
                type="button"
                class="block max-w-[260px] mb-0.5 rounded-[18px] overflow-hidden bg-stone-100 dark:bg-stone-800 shadow-lg hover:shadow-xl hover:scale-105 hover:translate-y-[-10px] hover:translate-x-[-6px] transition-all duration-200 cursor-zoom-in"
                :class="[message.delivery === 'pending' ? 'opacity-60' : '', isNew(message) ? (run.sender === ownSender ? 'animate-bubble-out' : 'animate-bubble-in') : '']"
                @click="openPreview(file.url)"
              >
                <img :src="file.url" :alt="$t('chat.attachment')" class="block max-w-full max-h-[320px] object-contain" loading="lazy">
              </button>

              <div v-if="message.body" class="relative max-w-full">
                <UContextMenu :items="bubbleMenu(message)">
                  <div
                    :data-bubble-id="message.id"
                    class="relative mb-0.5 rounded-2xl px-3 py-1.5 transition-opacity last:mb-0"
                    :class="[
                      message.visibility === 'internal' ? 'bg-amber-500/12 text-stone-900 ring-1 ring-inset ring-amber-500/30 dark:text-stone-100' : run.sender === ownSender ? 'bg-primary-600 text-white' : 'bubble-them',
                      isNew(message) ? (run.sender === ownSender ? 'animate-bubble-out' : 'animate-bubble-in') : '',
                      message.delivery === 'pending' ? 'opacity-60' : '',
                      message.delivery === 'failed' ? 'opacity-80 ring-1 ring-red-500/70' : ''
                    ]"
                  >
                    <p class="whitespace-pre-wrap break-words text-[14px] leading-5">
                      <template v-for="(seg, i) in linkify(message.body)" :key="i">
                        <a v-if="seg.href" :href="seg.href" target="_blank" rel="noopener noreferrer nofollow" class="underline">{{ seg.text }}</a>
                        <template v-else>{{ seg.text }}</template>
                      </template>
                    </p>
                  </div>
                </UContextMenu>
              </div>
              <span v-else-if="message.attachments.length" :data-bubble-id="message.id" class="sr-only">{{ $t('chat.image') }}</span>

              <UButton
                v-if="canReply(message)"
                icon="i-lucide-reply"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                class="absolute top-1/2 -translate-y-1/2 rounded-full opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100 transition-opacity [@media(hover:none)]:hidden"
                :class="run.sender === ownSender ? '-left-8' : '-right-8'"
                :aria-label="$t('chat.reply')"
                @click="reply(message)"
              />
            </div>

            <!-- Tapbacks, one pill per emoji; click to add or take back yours. -->
            <div v-if="reactionGroups(message).length" class="flex flex-wrap gap-1 mb-0.5" :class="run.sender === ownSender ? 'justify-end' : 'justify-start'">
              <button
                v-for="group in reactionGroups(message)"
                :key="group.emoji"
                type="button"
                class="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[12px] border transition-colors active:scale-95"
                :class="group.mine
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300'
                  : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:border-stone-400 dark:hover:border-stone-500'"
                :title="group.names"
                @click="emit('react', message, group.emoji)"
              >
                <span>{{ group.emoji }}</span>
                <span v-if="group.count > 1" class="tabular-nums font-medium">{{ group.count }}</span>
              </button>
            </div>

            <div v-if="message.delivery === 'failed'" class="flex items-center gap-2 mb-1.5 max-w-full">
              <span class="text-[11px] text-error text-right">{{ message.deliveryError || $t('chat.notDelivered') }}</span>
              <button type="button" class="text-[11px] font-semibold text-primary-600 hover:underline shrink-0" @click="emit('retry', message)">{{ $t('chat.retry') }}</button>
              <button type="button" class="text-[11px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 shrink-0" @click="emit('discard', message)">{{ $t('chat.delete') }}</button>
            </div>

            <span
              v-if="index === run.messages.length - 1 && run.sender === ownSender && !message.delivery && readAt && readAt >= message.createdAt && message.id === lastOwnId"
              class="text-[11px] text-stone-500 dark:text-stone-400 mb-1 mr-1"
            >{{ $t('chat.read') }}</span>

            <button
              v-if="replyCount(message)"
              type="button"
              class="flex items-center gap-0.5 mt-0.5 mb-1 text-xs font-semibold text-primary-600 hover:underline"
              :aria-expanded="openThreadId === message.id"
              @click="toggleThread(message)"
            >
              {{ $t('chat.replies', replyCount(message)) }}
              <UIcon name="i-lucide-chevron-right" class="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Image lightbox: Messages opens attachments full-bleed, not in a new tab. -->
  <UModal v-model:open="previewOpen" :ui="{ content: 'sm:max-w-3xl bg-stone-950 dark:bg-stone-950 border-stone-800 dark:border-stone-800' }">
    <template #body>
      <img v-if="previewUrl" :src="previewUrl" :alt="$t('chat.attachment')"class="mx-auto max-h-[80vh] w-auto max-w-full object-contain">
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { onKeyStroke, useResizeObserver } from '@vueuse/core'
import type { ContextMenuItem } from '@nuxt/ui'
import { buildThreads, eventLabel, groupMessagesForDisplay } from '#shared/conversations'
import { messagePreview, MESSAGE_REACTION_EMOJIS, type Message } from '#shared/support'
import { chatSeparatorParts } from './chatTime'

const { t } = useI18n()

const REACTION_EMOJIS = MESSAGE_REACTION_EMOJIS

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+?(?=[.,;:!?)\]]*(?:\s|$))/gi
function linkify(body: string): { text: string, href?: string }[] {
  const out: { text: string, href?: string }[] = []
  let last = 0
  for (const m of body.matchAll(URL_RE)) {
    const start = m.index ?? 0
    if (start > last) out.push({ text: body.slice(last, start) })
    const text = m[0]
    out.push({ text, href: /^www\./i.test(text) ? `https://${text}` : text })
    last = start + text.length
  }
  if (last < body.length) out.push({ text: body.slice(last) })
  return out
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

// A support reply is AI when it carries a supportAgentId, otherwise a human
// teammate. Labelled once at the top of each same-source run; user messages and
// system events are never tagged.
function sourceTag(run: { messages: Message[] }, index: number): { text: string, ai: boolean } | null {
  const message = run.messages[index]
  if (!message || message.sender !== 'agent' || message.kind === 'event' || message.visibility === 'internal') return null
  const ai = Boolean(message.supportAgentId)
  const previous = run.messages[index - 1]
  const prevSameSource = previous && previous.sender === 'agent' && previous.kind !== 'event' && previous.visibility !== 'internal' && Boolean(previous.supportAgentId) === ai
  if (prevSameSource) return null
  return { text: ai ? `${message.senderName || t('chat.assistant')} · AI` : (message.senderName || t('chat.support')), ai }
}

const props = withDefaults(defineProps<{
  messages: Message[]
  /** Which `sender` value is "me": 'user' in the embed, 'agent' in the panel. */
  ownSender?: 'user' | 'agent'
  /** This client's reaction `actor` key ('user' or 'agent:<id>'); marks my tapbacks. */
  ownActor?: string
  /** When the other side last read; drives the "Read" receipt under my last message. */
  readAt?: string | null
  loading?: boolean
  emptyText?: string
  /** Optional avatar shown beside AI-generated replies (the project's assistant logo). */
  assistantLogo?: string
  /** Older messages exist on the server; shows "Load earlier messages" up top. */
  hasEarlier?: boolean
  loadingEarlier?: boolean
  /** Offers "Save as FAQ" on the team's own public replies (the inbox). */
  canSaveFaq?: boolean
}>(), { ownSender: 'user', ownActor: '', readAt: null, loading: false, assistantLogo: '', hasEarlier: false, loadingEarlier: false, canSaveFaq: false })

const emit = defineEmits<{
  (event: 'retry' | 'discard' | 'unsend', message: Message): void
  (event: 'react', message: Message, emoji: string): void
  (event: 'save-faq', message: Message): void
  (event: 'load-earlier'): void
}>()

const thread = defineModel<string>('thread', { default: '' })

const scrollerRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)

// Only messages that arrive while this transcript is on screen pop in; the
// backlog is already there when it opens.
const openedAt = new Date().toISOString()
function isNew(message: Message): boolean { return message.createdAt > openedAt }

const groups = computed(() => groupMessagesForDisplay(props.messages))
const separator = chatSeparatorParts
const lastOwnId = computed(() => [...props.messages].reverse().find(m => m.sender === props.ownSender && !m.delivery)?.id || '')

const byId = computed(() => new Map(props.messages.map(message => [message.id, message])))
const threads = computed(() => buildThreads(props.messages))
const openThreadId = computed(() => (thread.value && byId.value.has(thread.value) ? thread.value : ''))

function rootIdOf(message: Message): string { return threads.value.rootOf.get(message.id) || '' }
function replyCount(message: Message): number { return threads.value.replies.get(message.id)?.length || 0 }
function inThread(message: Message): boolean {
  const id = openThreadId.value
  return Boolean(id) && (message.id === id || rootIdOf(message) === id)
}
function dimmed(message: Message): boolean { return Boolean(openThreadId.value) && !inThread(message) }
function canReply(message: Message): boolean { return !message.delivery }
function canReact(message: Message): boolean { return !message.delivery && Boolean(message.id) && message.kind !== 'event' }

// Tapbacks collapsed per emoji: count, who, and whether one of mine is in there.
function reactionGroups(message: Message): { emoji: string, count: number, mine: boolean, names: string }[] {
  const map = new Map<string, { emoji: string, count: number, mine: boolean, names: string[] }>()
  for (const reaction of message.reactions || []) {
    const entry = map.get(reaction.emoji) || { emoji: reaction.emoji, count: 0, mine: false, names: [] }
    entry.count += 1
    if (props.ownActor ? reaction.actor === props.ownActor : reaction.side === props.ownSender) entry.mine = true
    if (reaction.actorName) entry.names.push(reaction.actorName)
    map.set(reaction.emoji, entry)
  }
  return [...map.values()].map(entry => ({ emoji: entry.emoji, count: entry.count, mine: entry.mine, names: entry.names.join(', ') }))
}

const previewUrl = ref('')
const previewOpen = computed({
  get: () => Boolean(previewUrl.value),
  set: (open: boolean) => { if (!open) previewUrl.value = '' }
})
function openPreview(url: string) { previewUrl.value = url }

const quoted = computed(() => {
  const ids = new Set<string>()
  props.messages.forEach((message, index) => {
    const root = rootIdOf(message)
    if (!root) return
    const previous = props.messages[index - 1]
    const adjacent = Boolean(previous) && (previous!.id === root || rootIdOf(previous!) === root)
    if (!adjacent) ids.add(message.id)
  })
  return ids
})
function quoteFor(message: Message): Message | null {
  return quoted.value.has(message.id) ? (byId.value.get(rootIdOf(message)) || null) : null
}

function bubbleMenu(message: Message) {
  // Messages puts the tapback row first; on web it lives in the context menu too.
  const react: ContextMenuItem[] = REACTION_EMOJIS.map(emoji => ({
    label: t('chat.reactWith', { emoji }),
    onSelect: () => emit('react', message, emoji)
  }))
  const items: ContextMenuItem[] = [
    { label: t('chat.copy'), icon: 'i-lucide-clipboard', onSelect: () => void navigator.clipboard?.writeText(message.body).catch(() => undefined) }
  ]
  if (canReply(message)) items.push({ label: t('chat.reply'), icon: 'i-lucide-reply', onSelect: () => reply(message) })
  if (props.canSaveFaq && message.sender === 'agent' && message.visibility !== 'internal' && message.body && !message.delivery) items.push({ label: t('chat.saveAsFaq'), icon: 'i-lucide-book-open-check', onSelect: () => emit('save-faq', message) })
  if (message.sender === props.ownSender && !message.delivery) items.push({ label: t('chat.unsend'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('unsend', message) })
  return canReact(message) ? [react, items] : [items]
}

function reply(message: Message) { openThread(rootIdOf(message) || message.id) }
function openThread(id: string) { thread.value = id }
function toggleThread(message: Message) { thread.value = thread.value === message.id ? '' : message.id }

function onScrollerClick(event: MouseEvent) {
  if (!openThreadId.value) return
  if ((event.target as HTMLElement | null)?.closest('[data-in-thread="true"]')) return
  thread.value = ''
}

onKeyStroke('Escape', () => {
  if (!thread.value || document.querySelector('[data-dismissable-layer]')) return
  thread.value = ''
})

function bubbleElement(id: string): HTMLElement | null {
  return scrollerRef.value?.querySelector<HTMLElement>(`[data-bubble-id="${CSS.escape(id)}"]`) || null
}

type Bracket = { id: string, top: number, height: number }
const brackets = ref<Bracket[]>([])

function measureBrackets() {
  const scroller = scrollerRef.value
  if (!scroller) { brackets.value = []; return }
  const list = props.messages
  const position = new Map(list.map((message, index) => [message.id, index]))
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop
  const next: Bracket[] = []
  for (const [rootId, replies] of threads.value.replies) {
    const open = openThreadId.value === rootId
    if (openThreadId.value && !open) continue
    if (!open) {
      const start = position.get(rootId)
      const end = position.get(replies[replies.length - 1]!.id)
      if (start === undefined || end === undefined) continue
      let contiguous = true
      for (let i = start + 1; i <= end && contiguous; i++) contiguous = rootIdOf(list[i]!) === rootId
      if (!contiguous) continue
    }
    const first = bubbleElement(rootId)
    const last = bubbleElement(replies[replies.length - 1]!.id)
    if (!first || !last) continue
    const a = first.getBoundingClientRect()
    const b = last.getBoundingClientRect()
    const top = a.top + a.height / 2 - base
    const bottom = b.top + b.height / 2 - base
    next.push({ id: rootId, top, height: Math.max(0, bottom - top) })
  }
  brackets.value = next
}

useResizeObserver(contentRef, measureBrackets)

async function scrollToLatest() {
  await nextTick()
  const element = scrollerRef.value
  if (element) element.scrollTop = element.scrollHeight
}

async function scrollToThread(id: string) {
  await nextTick()
  const scroller = scrollerRef.value
  const bubble = bubbleElement(id)
  if (!scroller || !bubble) return
  const offset = bubble.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  scroller.scrollTo({ top: offset - (scroller.clientHeight - bubble.offsetHeight) / 2, behavior: 'smooth' })
}

watch(() => props.messages[props.messages.length - 1]?.id, () => { void scrollToLatest() }, { immediate: true })
// Older messages prepended above: keep the reader where they were. Runs before
// the DOM update, so the old height is still measurable.
watch(() => props.messages[0]?.id, (id, previous) => {
  const scroller = scrollerRef.value
  if (!scroller || !id || !previous || !byId.value.has(previous)) return
  const { scrollTop, scrollHeight } = scroller
  void nextTick(() => { scroller.scrollTop = scrollTop + scroller.scrollHeight - scrollHeight })
})
watch(() => props.messages, () => { void nextTick(measureBrackets) }, { deep: false, immediate: true })
watch(openThreadId, (id) => {
  if (id) void scrollToThread(id)
  else thread.value = ''
  void nextTick(measureBrackets)
})

defineExpose({ scrollToLatest })
</script>
