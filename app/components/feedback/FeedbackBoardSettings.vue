<template>
  <form class="space-y-8" @submit.prevent="emit('save', toConfig())">
    <section v-if="!boardOnly" class="space-y-4">
      <USwitch v-model="draft.enabled" :label="$t('feedback.boardLive')" :description="$t('feedback.boardLiveDescription')" />
      <UFormField :label="$t('feedback.title')" :hint="$t('feedback.titleHint')">
        <UInput v-model="draft.title" class="w-full" :placeholder="$t('feedback.titlePlaceholder')" />
      </UFormField>
      <UFormField :label="$t('feedback.description')">
        <UTextarea v-model="draft.description" :rows="2" autoresize class="w-full" :placeholder="$t('feedback.descriptionPlaceholder')" />
      </UFormField>
      <UFormField :label="$t('feedback.postUrl')" :hint="$t('feedback.postUrlHint')">
        <UInput v-model="draft.postUrlTemplate" class="w-full font-mono text-xs" placeholder="https://app.example.com/feedback?feedback={id}" />
      </UFormField>
    </section>

    <section v-if="!boardOnly" class="space-y-3">
      <h3 class="text-sm font-semibold">{{ $t('feedback.options') }}</h3>
      <div class="grid sm:grid-cols-2 gap-3">
        <UCheckbox v-model="draft.allowComments" :label="$t('feedback.comments')" :description="$t('feedback.allowCommentsDescription')" />
        <UCheckbox v-model="draft.allowUserEdits" :label="$t('feedback.allowUserEdits')" :description="$t('feedback.allowUserEditsDescription')" />
        <UCheckbox v-model="draft.showAuthorNames" :label="$t('feedback.showAuthorNames')" :description="$t('feedback.showAuthorNamesDescription')" />
        <UCheckbox v-model="draft.emailNotifications" :label="$t('feedback.emailNotifications')" :description="$t('feedback.emailNotificationsDescription')" />
        <UCheckbox v-model="draft.roadmap" :label="$t('feedback.roadmapView')" :description="$t('feedback.roadmapViewDescription')" />
        <UCheckbox v-model="draft.changelog" :label="$t('sections.changelog')" :description="$t('feedback.changelogDescription')" />
      </div>
    </section>

    <section class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold">{{ $t('feedback.statuses') }}</h3>
        <p v-if="boardOnly" class="text-xs text-muted">{{ $t('feedback.statusesHelpBoard') }}</p>
        <p v-else class="text-xs text-muted">{{ $t('feedback.statusesHelpFeedback') }}</p>
      </div>
      <div class="space-y-2">
        <div v-for="(status, i) in draft.statuses" :key="status.uid" :ref="el => rowRef('statuses', i, el)" :class="rowClass('statuses', i)" class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-default bg-default p-2 transition-shadow sm:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_7rem_6rem_auto]" @dragover.prevent="dragOver('statuses', i)" @drop.prevent="dragDrop('statuses', i)">
          <button type="button" draggable="true" class="order-1 grid size-7 cursor-grab place-items-center rounded-md text-dimmed hover:bg-elevated hover:text-default active:cursor-grabbing sm:order-none" :title="$t('feedback.dragToReorder')" :aria-label="$t('feedback.dragToReorder')" @dragstart="dragStart($event, 'statuses', i)" @dragend="dragEnd" @keydown.up.prevent="move(draft.statuses, i, -1)" @keydown.down.prevent="move(draft.statuses, i, 1)">
            <UIcon name="i-lucide-grip-vertical" class="size-4" />
          </button>
          <UInput v-model="status.label" size="sm" class="order-2 sm:order-none" :placeholder="$t('feedback.label')" :aria-label="$t('feedback.statusLabel')" @blur="fillKey(status)">
            <template #leading><span class="size-2.5 rounded-full" :class="TONES[status.color] || TONES.neutral" /></template>
          </UInput>
          <div class="order-4 col-span-3 grid grid-cols-3 gap-2 sm:contents sm:order-none">
            <UInput v-model="status.key" size="sm" placeholder="key" class="font-mono" :aria-label="$t('feedback.statusKey')" />
            <USelect v-model="status.category" :items="categoryItems" size="sm" :aria-label="$t('feedback.category')" />
            <USelect v-model="status.color" :items="colorItems" size="sm" :aria-label="$t('feedback.color')" />
          </div>
          <div class="order-3 flex items-center justify-end gap-0.5 sm:order-none">
            <UTooltip :text="boardOnly ? $t('feedback.defaultForNewItem') : $t('feedback.defaultForNewPost')"><UButton :icon="status.isDefault ? 'i-lucide-star' : 'i-lucide-star-off'" size="xs" :color="status.isDefault ? 'primary' : 'neutral'" variant="ghost" square :aria-label="$t('feedback.makeDefault')" @click="makeDefault(i)" /></UTooltip>
            <UTooltip v-if="!boardOnly" :text="$t('feedback.notifyTooltip')"><UButton :icon="status.notify ? 'i-lucide-bell-ring' : 'i-lucide-bell-off'" size="xs" :color="status.notify ? 'primary' : 'neutral'" variant="ghost" square :aria-label="$t('feedback.notifyAuthor')" @click="status.notify = !status.notify" /></UTooltip>
            <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :disabled="draft.statuses.length < 2" :aria-label="$t('feedback.removeStatus')" @click="draft.statuses.splice(i, 1)" />
          </div>
        </div>
      </div>
      <UButton icon="i-lucide-plus" :label="$t('feedback.addStatus')" size="xs" color="neutral" variant="soft" @click="draft.statuses.push({ uid: uid(), key: '', label: '', category: 'open', color: 'neutral', isDefault: false, notify: false })" />
    </section>

    <section v-if="!boardOnly" class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold">{{ $t('feedback.postTypes') }}</h3>
        <p class="text-xs text-muted">{{ $t('feedback.iconHint', { example: 'lucide:bug' }) }}</p>
      </div>
      <div class="space-y-2">
        <div v-for="(type, i) in draft.types" :key="type.uid" :ref="el => rowRef('types', i, el)" :class="rowClass('types', i)" class="grid grid-cols-[2rem_1fr_1fr] sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-default bg-default p-2 transition-shadow" @dragover.prevent="dragOver('types', i)" @drop.prevent="dragDrop('types', i)">
          <span class="grid size-8 place-items-center rounded-lg bg-elevated"><FeedbackIcon :icon="type.icon" fallback="i-lucide-tag" class="size-4" /></span>
          <UInput v-model="type.label" size="sm" :placeholder="$t('feedback.label')" :aria-label="$t('feedback.typeLabel')" @blur="fillKey(type)" />
          <UInput v-model="type.key" size="sm" placeholder="key" class="font-mono" :aria-label="$t('feedback.typeKey')" />
          <UInput v-model="type.icon" size="sm" placeholder="lucide:bug" class="col-span-2 sm:col-span-1 font-mono" :aria-label="$t('feedback.icon')" />
          <div class="flex items-center gap-1 justify-end">
            <button type="button" draggable="true" class="grid size-6 cursor-grab place-items-center rounded-md text-dimmed hover:bg-elevated hover:text-default active:cursor-grabbing" :title="$t('feedback.dragToReorder')" :aria-label="$t('feedback.dragToReorder')" @dragstart="dragStart($event, 'types', i)" @dragend="dragEnd" @keydown.up.prevent="move(draft.types, i, -1)" @keydown.down.prevent="move(draft.types, i, 1)">
              <UIcon name="i-lucide-grip-vertical" class="size-4" />
            </button>
            <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="$t('feedback.removeType')" @click="draft.types.splice(i, 1)" />
          </div>
        </div>
      </div>
      <UButton icon="i-lucide-plus" :label="$t('feedback.addType')" size="xs" color="neutral" variant="soft" @click="draft.types.push({ uid: uid(), key: '', label: '', icon: '' })" />
    </section>

    <section v-if="!boardOnly" class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold">{{ $t('feedback.platforms') }}</h3>
        <p class="text-xs text-muted">{{ $t('feedback.platformsHelp') }}</p>
      </div>
      <div class="space-y-2">
        <div v-for="(platform, i) in draft.platforms" :key="platform.uid" class="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-xl border border-default p-2">
          <UInput v-model="platform.label" size="sm" :placeholder="$t('feedback.label')" :aria-label="$t('feedback.platformLabel')" @blur="fillKey(platform)" />
          <UInput v-model="platform.key" size="sm" placeholder="key" class="font-mono" :aria-label="$t('feedback.platformKey')" />
          <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="$t('feedback.removePlatform')" @click="draft.platforms.splice(i, 1)" />
        </div>
      </div>
      <UButton icon="i-lucide-plus" :label="$t('feedback.addPlatform')" size="xs" color="neutral" variant="soft" @click="draft.platforms.push({ uid: uid(), key: '', label: '' })" />
    </section>

    <section class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold">{{ boardOnly ? $t('feedback.labels') : $t('feedback.tags') }}</h3>
        <p v-if="boardOnly" class="text-xs text-muted">{{ $t('feedback.labelsHelpBoard') }}</p>
        <p v-else class="text-xs text-muted">{{ $t('feedback.tagsHelp') }}</p>
      </div>
      <div class="space-y-2">
        <div v-for="(tag, i) in draft.tags" :key="tag.uid" :ref="el => rowRef('tags', i, el)" :class="rowClass('tags', i)" class="grid grid-cols-[1fr_1fr] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6.5rem_auto] items-center gap-2 rounded-xl border border-default bg-default p-2 transition-shadow" @dragover.prevent="dragOver('tags', i)" @drop.prevent="dragDrop('tags', i)">
          <UInput v-model="tag.label" size="sm" :placeholder="$t('feedback.label')" :aria-label="boardOnly ? $t('feedback.labelName') : $t('feedback.tagLabel')" @blur="fillKey(tag)" />
          <UInput v-model="tag.key" size="sm" placeholder="key" class="font-mono" :aria-label="boardOnly ? $t('feedback.labelKey') : $t('feedback.tagKey')" />
          <USelect v-model="tag.color" :items="colorItems" size="sm" :aria-label="$t('feedback.color')" />
          <div class="flex items-center gap-1 justify-end">
            <button type="button" draggable="true" class="grid size-6 cursor-grab place-items-center rounded-md text-dimmed hover:bg-elevated hover:text-default active:cursor-grabbing" :title="$t('feedback.dragToReorder')" :aria-label="$t('feedback.dragToReorder')" @dragstart="dragStart($event, 'tags', i)" @dragend="dragEnd" @keydown.up.prevent="move(draft.tags, i, -1)" @keydown.down.prevent="move(draft.tags, i, 1)">
              <UIcon name="i-lucide-grip-vertical" class="size-4" />
            </button>
            <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="boardOnly ? $t('feedback.removeLabel') : $t('feedback.removeTag')" @click="draft.tags.splice(i, 1)" />
          </div>
        </div>
      </div>
      <UButton icon="i-lucide-plus" :label="boardOnly ? $t('feedback.addLabel') : $t('feedback.addTag')" size="xs" color="neutral" variant="soft" @click="draft.tags.push({ uid: uid(), key: '', label: '', color: 'neutral' })" />
    </section>

    <p v-if="error" class="text-sm text-error">{{ error }}</p>
    <div class="flex items-center gap-3">
      <UButton type="submit" color="primary" :loading="saving" :label="boardOnly ? $t('board.saveLists') : $t('feedback.saveBoardSettings')" />
      <span v-if="saved" class="text-sm text-muted">{{ $t('common.saved') }}</span>
    </div>
  </form>
</template>

<script setup lang="ts">
import {
  FEEDBACK_COLORS,
  FEEDBACK_STATUS_CATEGORIES,
  normalizeFeedbackKey,
  type FeedbackBoardConfig,
  type FeedbackColor
} from '#shared/feedback'

// `boardOnly`: the project board's settings — statuses and labels (the tag
// list, renamed), without the feedback board's text, options, types and platforms.
const props = defineProps<{ config: FeedbackBoardConfig, saving?: boolean, saved?: boolean, error?: string, boardOnly?: boolean }>()
const emit = defineEmits<{ (e: 'save', config: FeedbackBoardConfig): void }>()
const { t } = useI18n()

let counter = 0
const uid = () => `row-${++counter}`

const TONES: Record<string, string> = { neutral: 'bg-stone-400', primary: 'bg-primary-500', info: 'bg-sky-500', success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-rose-500' }
const categoryItems = computed(() => FEEDBACK_STATUS_CATEGORIES.map(value => ({ label: t(`feedback.categories.${value}`), value })))
const colorItems = computed(() => FEEDBACK_COLORS.map(value => ({ label: t(`feedback.colors.${value}`), value })))

function fromConfig(config: FeedbackBoardConfig) {
  return {
    ...config,
    statuses: config.statuses.map(s => ({ uid: uid(), key: s.key, label: s.label, category: s.category, color: s.color as FeedbackColor, isDefault: Boolean(s.isDefault), notify: Boolean(s.notify) })),
    types: config.types.map(t => ({ uid: uid(), key: t.key, label: t.label, icon: t.icon })),
    platforms: config.platforms.map(p => ({ uid: uid(), key: p.key, label: p.label })),
    tags: (config.tags || []).map(t => ({ uid: uid(), key: t.key, label: t.label, color: t.color as FeedbackColor }))
  }
}

const draft = reactive(fromConfig(props.config))
watch(() => props.config, config => Object.assign(draft, fromConfig(config)))

function fillKey(row: { key: string, label: string }) {
  if (!row.key.trim() && row.label.trim()) row.key = normalizeFeedbackKey(row.label)
}

// ---- drag to reorder ----
// Statuses, post types and tags are lists whose order shows on the board, the roadmap and in the pickers.
// Drag a row by its grip onto another to put it there; with the grip focused, the arrow keys move it too.
type ListName = 'statuses' | 'types' | 'tags'
const drag = reactive<{ list: ListName | '', from: number, over: number }>({ list: '', from: -1, over: -1 })
const rows = new Map<string, HTMLElement>()

function rowRef(list: ListName, index: number, el: unknown) {
  if (el instanceof HTMLElement) rows.set(`${list}:${index}`, el)
  else rows.delete(`${list}:${index}`)
}

function dragStart(event: DragEvent, list: ListName, index: number) {
  drag.list = list
  drag.from = index
  drag.over = index
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
  const row = rows.get(`${list}:${index}`)
  if (row) event.dataTransfer.setDragImage(row, 16, 16)
}

function dragOver(list: ListName, index: number) {
  if (drag.list === list) drag.over = index
}

function dragDrop(list: ListName, index: number) {
  if (drag.list === list && drag.from !== index) {
    const items = draft[list] as unknown[]
    const [moved] = items.splice(drag.from, 1)
    items.splice(index, 0, moved)
  }
  dragEnd()
}

function dragEnd() {
  drag.list = ''
  drag.from = -1
  drag.over = -1
}

/** The row being dragged fades; the one it would land on shows a ring. */
function rowClass(list: ListName, index: number) {
  if (drag.list !== list) return ''
  if (drag.from === index) return 'opacity-40'
  return drag.over === index ? 'ring-2 ring-primary/60' : ''
}

function makeDefault(index: number) {
  draft.statuses.forEach((s, i) => { s.isDefault = i === index })
}

function move<T>(list: T[], index: number, by: number) {
  const target = index + by
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item!)
}

function strip<T extends { uid: string }>(row: T): Omit<T, 'uid'> {
  const { uid: _, ...rest } = row
  return rest
}

function toConfig(): FeedbackBoardConfig {
  return {
    ...draft,
    statuses: draft.statuses.map(row => strip(row)).map(s => ({ ...s, key: s.key || normalizeFeedbackKey(s.label) })),
    types: draft.types.map(row => strip(row)).map(t => ({ ...t, key: t.key || normalizeFeedbackKey(t.label) })),
    platforms: draft.platforms.map(row => strip(row)).map(p => ({ ...p, key: p.key || normalizeFeedbackKey(p.label) })),
    tags: draft.tags.map(row => strip(row)).map(t => ({ ...t, key: t.key || normalizeFeedbackKey(t.label) }))
  }
}
</script>
