<template>
  <div class="flex-1 min-h-0 overflow-y-auto pb-2">
    <div v-if="loading && !items.length" class="space-y-1 p-2">
      <USkeleton v-for="i in 5" :key="i" class="h-12 rounded-lg" />
    </div>

    <div v-else-if="!items.length" class="h-full flex items-center justify-center">
      <slot name="empty">
        <p class="px-4 py-10 text-center text-[13px] text-muted">{{ emptyText ?? $t('chat.noConversations') }}</p>
      </slot>
    </div>

    <template v-else>
      <div v-if="searchable" class="sticky top-0 z-10 bg-default/90 px-3 pb-2 pt-2 backdrop-blur">
        <UInput v-model="searchQuery" icon="i-lucide-search" :placeholder="$t('chat.searchConversations')" size="sm" class="w-full" />
      </div>
      <!-- Linear's list rows: inset, quiet grey selection, one line of preview. -->
      <UContextMenu v-for="item in filteredItems" :key="item.id" :items="contextItems(item)">
        <button
          type="button"
          class="mx-2 flex w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors"
          :class="item.id === activeId ? 'bg-accented' : 'hover:bg-elevated'"
          @click="emit('select', item.id)"
        >
          <span class="size-1.5 shrink-0 rounded-full" :class="item.unreadCount ? 'bg-primary-500' : 'bg-transparent'" />

          <span class="relative shrink-0">
            <span class="grid size-7 place-items-center rounded-full bg-elevated text-[11px] font-semibold text-toned" :class="item.id === activeId ? 'bg-default' : ''">
              {{ initials(item.title) }}
            </span>
            <ProjectDot v-if="item.projectId" :project-id="item.projectId" :accent="item.projectAccent" :name="item.projectName" :icon-url="item.projectIconUrl" class="absolute -bottom-0.5 -right-0.5 size-2" />
          </span>

          <span class="min-w-0 flex-1">
            <span class="flex items-center justify-between gap-2">
              <span class="truncate text-[13px] text-highlighted" :class="item.unreadCount ? 'font-semibold' : 'font-medium'">{{ item.title }}</span>
              <span class="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                <UIcon v-if="item.viaEmail" name="i-lucide-mail" class="size-3.5" :title="$t('inbox.viaEmail')" />
                <PriorityIcon v-if="item.priority === 'high' || item.priority === 'urgent'" :priority="item.priority" :title="item.priority === 'urgent' ? $t('chat.urgentPriority') : $t('chat.highPriority')" />
                <StatusIcon v-if="item.done" category="resolved" :title="$t('chat.done')" />
                {{ formatShort(item.timestamp) }}
              </span>
            </span>
            <span class="mt-0.5 block truncate text-xs text-muted">
              <span v-if="item.subtitle" class="mr-1.5 font-medium text-toned">{{ item.subtitle }}</span>{{ item.preview || (emptyPreview ?? $t('chat.noMessagesYet')) }}
            </span>
          </span>
        </button>
      </UContextMenu>
    </template>
  </div>
</template>

<script setup lang="ts">
import Fuse from 'fuse.js'
import type { ConversationPriority } from '#shared/support'
import { formatChatListStamp } from './chatTime'

const { t } = useI18n()

export interface ChatListItem {
  id: string
  title: string
  subtitle?: string
  preview: string
  timestamp: string | null
  unreadCount: number
  projectId?: string
  projectName?: string
  projectAccent?: string
  projectIconUrl?: string
  /** The panel flags high and urgent tickets; the end user's inbox has no priority. */
  priority?: ConversationPriority
  /** The conversation started as an email to one of the project's addresses. */
  viaEmail?: boolean
  /** Undefined where the concept does not exist (the end user's own inbox). */
  done?: boolean
  /** Undefined where the team cannot archive or delete (the end user's own inbox). */
  archived?: boolean
}

const props = withDefaults(defineProps<{
  items: ChatListItem[]
  activeId?: string
  loading?: boolean
  emptyText?: string
  emptyPreview?: string
  searchable?: boolean
}>(), { activeId: '', loading: false, searchable: true })

const emit = defineEmits<{ (event: 'select' | 'toggle-read' | 'toggle-done' | 'toggle-archive' | 'delete', id: string): void }>()

const searchQuery = ref('')

function initials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

function contextItems(item: ChatListItem) {
  return [[
    { label: item.unreadCount ? t('chat.markRead') : t('chat.markUnread'), icon: item.unreadCount ? 'i-lucide-circle-check' : 'i-lucide-eye-off', onSelect: () => emit('toggle-read', item.id) },
    ...(item.done === undefined ? [] : [{ label: item.done ? t('chat.reopen') : t('chat.markDone'), icon: item.done ? 'i-lucide-reply' : 'i-lucide-check', onSelect: () => emit('toggle-done', item.id) }])
  ], ...(item.archived === undefined ? [] : [[
    { label: item.archived ? t('chat.unarchive') : t('chat.archive'), icon: item.archived ? 'i-lucide-archive-restore' : 'i-lucide-archive', onSelect: () => emit('toggle-archive', item.id) },
    { label: t('chat.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => emit('delete', item.id) }
  ]])]
}

const filteredItems = computed(() => {
  const text = searchQuery.value.trim()
  if (!text) return props.items
  return new Fuse(props.items, { keys: ['title', 'subtitle', 'preview'], threshold: 0.4 }).search(text).map(result => result.item)
})

const formatShort = formatChatListStamp
</script>
