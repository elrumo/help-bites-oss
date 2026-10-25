<template>
  <UModal v-model:open="open" :title="$t('feedbackPlan.modalTitle')" :description="$t('feedbackPlan.modalDescription')">
    <template #body>
      <div class="space-y-4">
        <div class="flex items-center gap-3 rounded-lg border border-default p-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{{ $t('feedbackPlan.newItemTitle') }}</p>
            <p class="text-xs" :class="busy === '__new__' ? 'text-primary' : 'text-muted'">{{ busy === '__new__' ? $t('feedbackPlan.workingHint') : $t('feedbackPlan.newItemHint') }}</p>
          </div>
          <UButton icon="i-lucide-sparkles" :label="busy === '__new__' ? $t('feedbackPlan.working') : $t('feedbackPlan.createItem')" :loading="busy === '__new__'" :disabled="!!busy" @click="create" />
        </div>

        <div class="space-y-2">
          <UInput v-model="search" icon="i-lucide-search" size="sm" class="w-full" :placeholder="$t('feedbackPlan.searchItems')" :aria-label="$t('feedbackPlan.searchItems')" autofocus />
          <div v-if="loading" class="space-y-1.5"><USkeleton v-for="i in 4" :key="i" class="h-8" /></div>
          <ul v-else class="max-h-72 divide-y divide-default overflow-y-auto rounded-lg border border-default">
            <li v-for="item in matches" :key="item.id">
              <button type="button" class="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-elevated disabled:opacity-60 disabled:hover:bg-transparent" :disabled="!!busy || isLinked(item)" @click="attach(item)">
                <span class="size-2 shrink-0 rounded-full" :class="dotTone(item.status)" :title="statusLabel(item.status)" />
                <span v-if="item.number" class="shrink-0 tabular-nums text-muted">#{{ item.number }}</span>
                <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
                <span v-if="isLinked(item)" class="inline-flex shrink-0 items-center gap-1 text-xs text-success"><UIcon name="i-lucide-check" class="size-3.5" />{{ $t('feedbackPlan.linked') }}</span>
                <UIcon v-else-if="busy === item.id" name="i-lucide-loader-circle" class="size-3.5 shrink-0 animate-spin text-muted" />
              </button>
            </li>
            <li v-if="!matches.length" class="px-2.5 py-3 text-center text-xs text-muted">{{ $t('feedbackPlan.noItems') }}</li>
          </ul>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import Fuse from 'fuse.js'
import type { BoardItem } from '#shared/board'

// "Add to planning": make a new item from a feedback post (AI-written when the workspace has an AI
// provider) or search the board's items and attach the post to one. A post can feed several items.

const props = defineProps<{ projectId: string, post: { id: string, number?: number | null, title: string } | null }>()
const emit = defineEmits<{ changed: [] }>()
const open = defineModel<boolean>('open', { default: false })

const { api, projects } = useAgent()
const planning = useFeedbackPlanning(props.projectId)
const board = computed(() => projects.value.find(p => p.id === props.projectId)?.board || null)

const items = ref<BoardItem[]>([])
const loading = ref(false)
const search = ref('')
const busy = ref('')

const TONES: Record<string, string> = { neutral: 'bg-stone-400', primary: 'bg-primary-500', info: 'bg-sky-500', success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-rose-500' }
const statusOf = (key: string) => board.value?.statuses.find(s => s.key === key)
const statusLabel = (key: string) => statusOf(key)?.label || key
const dotTone = (key: string) => TONES[statusOf(key)?.color || 'neutral'] || TONES.neutral
const isLinked = (item: BoardItem) => Boolean(props.post && item.feedbackPostIds.includes(props.post.id))

const matches = computed(() => {
  const text = search.value.trim()
  if (!text) return items.value
  const number = /^#?(\d+)$/.exec(text)
  if (number) return items.value.filter(item => String(item.number) === number[1])
  return new Fuse(items.value, { keys: ['title', 'description', 'labels'], threshold: 0.38, ignoreLocation: true }).search(text).map(r => r.item)
})

async function load() {
  loading.value = true
  try {
    items.value = (await api<{ items: BoardItem[] }>('/admin/board-items', { query: { project: props.projectId } })).items
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

async function create() {
  if (!props.post) return
  busy.value = '__new__'
  const created = await planning.createFor(props.post)
  busy.value = ''
  if (created.length) { emit('changed'); open.value = false }
}

async function attach(item: BoardItem) {
  if (!props.post) return
  busy.value = item.id
  const next = await planning.attachTo(item.id, props.post)
  busy.value = ''
  if (next) { emit('changed'); open.value = false }
}

watch(open, (now) => {
  if (!now) return
  search.value = ''
  void load()
})
</script>
