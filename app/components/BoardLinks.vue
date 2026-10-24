<template>
  <!-- The board items a conversation or post feeds: open one, unlink it, or file a new one. -->
  <div class="space-y-1.5">
    <NuxtLink v-if="board && !board.enabled" :to="`/projects/${projectId}/board`" class="-mx-1 flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] text-muted transition-colors hover:bg-elevated hover:text-default">
      <UIcon name="i-lucide-square-kanban" class="size-3.5 shrink-0" />{{ $t('board.setUpBoard') }}
    </NuxtLink>
    <template v-else>
      <div v-if="loading && !linked.length" class="h-7 animate-pulse rounded-md bg-elevated" />
      <div v-for="item in linked" :key="item.id" class="group -mx-1 flex items-center gap-1.5 rounded-lg px-1 text-[13px] transition-colors hover:bg-elevated">
        <NuxtLink :to="`/projects/${projectId}/board?item=${item.id}`" class="flex min-w-0 flex-1 items-center gap-2 py-1">
          <span class="size-2 shrink-0 rounded-full" :class="dotTone(item.status)" :title="statusLabel(item.status)" />
          <span v-if="item.number" class="shrink-0 tabular-nums text-muted">#{{ item.number }}</span>
          <span class="min-w-0 truncate text-default">{{ item.title }}</span>
          <UIcon v-if="item.public" name="i-lucide-globe" class="size-3 shrink-0 text-dimmed" :aria-label="$t('board.publicRoadmapLabel')" />
        </NuxtLink>
        <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" :aria-label="$t('board.unlinkItem', { number: item.number ?? '', title: item.title })" :loading="busy === item.id" @click="unlink(item)" />
      </div>
      <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
        <UButton :icon="kind === 'feedback' ? 'i-lucide-sparkles' : 'i-lucide-plus'" :label="$t('board.newItem')" size="xs" color="neutral" variant="outline" :loading="creating" @click="createItem" />
        <USelectMenu
          v-model="picked"
          :items="candidates"
          value-key="value"
          size="xs"
          class="min-w-0 flex-1"
          :placeholder="$t('board.addToExisting')"
          :search-input="{ placeholder: $t('board.searchItems') }"
          :loading="loadingAll"
          @update:open="open => open && loadAll()"
          @update:model-value="addExisting"
        />
      </div>
      <p v-if="error" class="text-xs text-error">{{ error }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { feedbackPlainText } from '#shared/feedback'
import type { BoardItem } from '#shared/board'

// Used by the inbox (kind "conversation") and the feedback post editor (kind
// "feedback"). "New item" files one straight away, already linked; the board page is where it
// gets triaged. From a conversation it is prefilled with `title` and `description`; from a post the
// server writes it (AI when configured, else a copy of the post).

const props = defineProps<{ projectId: string, kind: 'feedback' | 'conversation', targetId: string, title: string, description?: string }>()

const { api, projects } = useAgent()
const { t } = useI18n()
const board = computed(() => projects.value.find(p => p.id === props.projectId)?.board || null)

const linked = ref<BoardItem[]>([])
const all = ref<BoardItem[]>([])
const loading = ref(false)
const loadingAll = ref(false)
const creating = ref(false)
const busy = ref('')
const error = ref('')
const picked = ref<string | undefined>(undefined)

const TONES: Record<string, string> = { neutral: 'bg-stone-400', primary: 'bg-primary-500', info: 'bg-sky-500', success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-rose-500' }
const statusOf = (key: string) => board.value?.statuses.find(s => s.key === key)
const statusLabel = (key: string) => statusOf(key)?.label || key
const dotTone = (key: string) => TONES[statusOf(key)?.color || 'neutral'] || TONES.neutral

const candidates = computed(() => all.value
  .filter(item => !linked.value.some(l => l.id === item.id))
  .map(item => ({ label: `${item.number ? `#${item.number} ` : ''}${item.title}`, value: item.id })))

async function load() {
  if (!props.targetId || !props.projectId) { linked.value = []; return }
  loading.value = true
  error.value = ''
  try {
    const query = { project: props.projectId, [props.kind === 'feedback' ? 'feedbackPost' : 'conversation']: props.targetId }
    linked.value = (await api<{ items: BoardItem[] }>('/admin/board-items', { query })).items
  } catch (e: any) {
    error.value = e?.message || t('board.loadError')
  } finally {
    loading.value = false
  }
}

async function loadAll() {
  loadingAll.value = true
  try {
    all.value = (await api<{ items: BoardItem[] }>('/admin/board-items', { query: { project: props.projectId } })).items
  } catch (e: any) {
    error.value = e?.message || t('board.loadError')
  } finally {
    loadingAll.value = false
  }
}

async function link(itemId: string, on: boolean) {
  const { item } = await api<{ item: BoardItem }>(`/admin/board-items/${itemId}/links`, { method: 'POST', body: { kind: props.kind, id: props.targetId, linked: on } })
  return item
}

async function addExisting(itemId: string | undefined) {
  if (!itemId) return
  busy.value = itemId
  error.value = ''
  try {
    const item = await link(itemId, true)
    if (!linked.value.some(l => l.id === item.id)) linked.value = [...linked.value, item]
  } catch (e: any) {
    error.value = e?.message || t('board.linkItemError')
  } finally {
    busy.value = ''
    picked.value = undefined
  }
}

async function unlink(item: BoardItem) {
  busy.value = item.id
  error.value = ''
  try {
    await link(item.id, false)
    linked.value = linked.value.filter(l => l.id !== item.id)
  } catch (e: any) {
    error.value = e?.message || t('board.unlinkItemError')
  } finally {
    busy.value = ''
  }
}

async function createItem() {
  creating.value = true
  error.value = ''
  const text = (props.description || '').trim()
  const title = props.title.trim() || feedbackPlainText(text, 80).split('\n')[0] || t('board.untitled')
  try {
    if (props.kind === 'feedback') {
      // A post gets an item written from it (by the AI, when there is one) rather than an empty one.
      const { item } = await api<{ item: BoardItem }>('/admin/board-items/from-feedback', { method: 'POST', query: { project: props.projectId }, body: { postId: props.targetId } })
      linked.value = [...linked.value, item]
      all.value = []
      return
    }
    const { item } = await api<{ item: BoardItem }>('/admin/board-items', {
      method: 'POST',
      query: { project: props.projectId },
      body: { title: title.slice(0, 200), description: text, [props.kind === 'feedback' ? 'feedbackPostIds' : 'conversationIds']: [props.targetId] }
    })
    linked.value = [...linked.value, item]
    all.value = []
  } catch (e: any) {
    error.value = e?.message || t('board.createError')
  } finally {
    creating.value = false
  }
}

watch(() => [props.projectId, props.kind, props.targetId], () => { all.value = []; void load() }, { immediate: true })
</script>
