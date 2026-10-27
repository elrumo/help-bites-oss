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
      <ul class="divide-y divide-default overflow-hidden rounded-xl border border-default bg-white dark:bg-elevated">
        <li v-for="(status, i) in draft.statuses" :key="status.uid" data-row class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 p-2 transition-opacity sm:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1fr)_7.5rem_6.5rem_auto]" :class="dragging?.list === draft.statuses && dragging.index === i ? 'opacity-40' : ''" @dragover.prevent="overRow(draft.statuses, i)" @drop.prevent="endDrag">
          <button type="button" draggable="true" class="cursor-grab rounded p-1 text-dimmed hover:text-default active:cursor-grabbing" :title="$t('feedback.dragToReorder')" :aria-label="$t('feedback.dragToReorder')" @dragstart="startDrag($event, draft.statuses, i)" @dragend="endDrag" @keydown.up.prevent="move(draft.statuses, i, -1)" @keydown.down.prevent="move(draft.statuses, i, 1)">
            <UIcon name="i-lucide-grip-vertical" class="size-4" />
          </button>
          <UInput v-model="status.label" size="sm" :placeholder="$t('feedback.label')" :aria-label="$t('feedback.statusLabel')" @blur="fillKey(status)" />
          <div class="flex items-center justify-end gap-1 sm:order-last">
            <UTooltip :text="boardOnly ? $t('feedback.defaultForNewItem') : $t('feedback.defaultForNewPost')"><UButton :icon="status.isDefault ? 'i-lucide-star' : 'i-lucide-star-off'" size="xs" :color="status.isDefault ? 'primary' : 'neutral'" variant="ghost" square :aria-label="$t('feedback.makeDefault')" @click="makeDefault(i)" /></UTooltip>
            <UTooltip v-if="!boardOnly" :text="$t('feedback.notifyTooltip')"><UButton :icon="status.notify ? 'i-lucide-bell-ring' : 'i-lucide-bell-off'" size="xs" :color="status.notify ? 'primary' : 'neutral'" variant="ghost" square :aria-label="$t('feedback.notifyAuthor')" @click="status.notify = !status.notify" /></UTooltip>
            <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :disabled="draft.statuses.length < 2" :aria-label="$t('feedback.removeStatus')" @click="draft.statuses.splice(i, 1)" />
          </div>
          <UInput v-model="status.key" size="sm" placeholder="key" class="col-span-3 font-mono sm:col-span-1" :aria-label="$t('feedback.statusKey')" />
          <USelect v-model="status.category" :items="categoryItems" size="sm" class="col-span-2 sm:col-span-1" :aria-label="$t('feedback.category')" />
          <USelect v-model="status.color" :items="colorItems" size="sm" :aria-label="$t('feedback.color')" />
        </li>
      </ul>
      <UButton icon="i-lucide-plus" :label="$t('feedback.addStatus')" size="xs" color="neutral" variant="soft" @click="draft.statuses.push({ uid: uid(), key: '', label: '', category: 'open', color: 'neutral', isDefault: false, notify: false })" />
    </section>

    <section v-if="!boardOnly" class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold">{{ $t('feedback.postTypes') }}</h3>
        <p class="text-xs text-muted">{{ $t('feedback.iconHint', { example: 'lucide:bug' }) }}</p>
      </div>
      <ul class="divide-y divide-default overflow-hidden rounded-xl border border-default bg-white dark:bg-elevated">
        <li v-for="(type, i) in draft.types" :key="type.uid" data-row class="grid grid-cols-[auto_2rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 p-2 transition-opacity sm:grid-cols-[auto_2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" :class="dragging?.list === draft.types && dragging.index === i ? 'opacity-40' : ''" @dragover.prevent="overRow(draft.types, i)" @drop.prevent="endDrag">
          <button type="button" draggable="true" class="cursor-grab rounded p-1 text-dimmed hover:text-default active:cursor-grabbing" :title="$t('feedback.dragToReorder')" :aria-label="$t('feedback.dragToReorder')" @dragstart="startDrag($event, draft.types, i)" @dragend="endDrag" @keydown.up.prevent="move(draft.types, i, -1)" @keydown.down.prevent="move(draft.types, i, 1)">
            <UIcon name="i-lucide-grip-vertical" class="size-4" />
          </button>
          <span class="grid size-8 place-items-center rounded-lg bg-elevated"><FeedbackIcon :icon="type.icon" fallback="i-lucide-tag" class="size-4" /></span>
          <UInput v-model="type.label" size="sm" :placeholder="$t('feedback.label')" :aria-label="$t('feedback.typeLabel')" @blur="fillKey(type)" />
          <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square class="sm:order-last" :aria-label="$t('feedback.removeType')" @click="draft.types.splice(i, 1)" />
          <UInput v-model="type.key" size="sm" placeholder="key" class="col-span-2 font-mono sm:col-span-1" :aria-label="$t('feedback.typeKey')" />
          <UInput v-model="type.icon" size="sm" placeholder="lucide:bug" class="col-span-2 font-mono sm:col-span-1" :aria-label="$t('feedback.icon')" />
        </li>
      </ul>
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
      <ul class="divide-y divide-default overflow-hidden rounded-xl border border-default bg-white dark:bg-elevated">
        <li v-for="(tag, i) in draft.tags" :key="tag.uid" data-row class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 p-2 transition-opacity sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_6.5rem_auto]" :class="dragging?.list === draft.tags && dragging.index === i ? 'opacity-40' : ''" @dragover.prevent="overRow(draft.tags, i)" @drop.prevent="endDrag">
          <button type="button" draggable="true" class="cursor-grab rounded p-1 text-dimmed hover:text-default active:cursor-grabbing" :title="$t('feedback.dragToReorder')" :aria-label="$t('feedback.dragToReorder')" @dragstart="startDrag($event, draft.tags, i)" @dragend="endDrag" @keydown.up.prevent="move(draft.tags, i, -1)" @keydown.down.prevent="move(draft.tags, i, 1)">
            <UIcon name="i-lucide-grip-vertical" class="size-4" />
          </button>
          <UInput v-model="tag.label" size="sm" :placeholder="$t('feedback.label')" :aria-label="boardOnly ? $t('feedback.labelName') : $t('feedback.tagLabel')" @blur="fillKey(tag)" />
          <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square class="sm:order-last" :aria-label="boardOnly ? $t('feedback.removeLabel') : $t('feedback.removeTag')" @click="draft.tags.splice(i, 1)" />
          <UInput v-model="tag.key" size="sm" placeholder="key" class="col-span-2 font-mono sm:col-span-1" :aria-label="boardOnly ? $t('feedback.labelKey') : $t('feedback.tagKey')" />
          <USelect v-model="tag.color" :items="colorItems" size="sm" class="col-span-1" :aria-label="$t('feedback.color')" />
        </li>
      </ul>
      <UButton icon="i-lucide-plus" :label="boardOnly ? $t('feedback.addLabel') : $t('feedback.addTag')" size="xs" color="neutral" variant="soft" @click="draft.tags.push({ uid: uid(), key: '', label: '', color: 'neutral' })" />
    </section>

    <p v-if="error" class="text-sm text-error">{{ error }}</p>
    <div class="sticky bottom-0 z-10 -mx-4 -mb-4 flex items-center gap-3 border-t border-default bg-default/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6">
      <UButton type="submit" color="primary" :loading="saving" :label="$t('feedback.saveBoardSettings')" />
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

function makeDefault(index: number) {
  draft.statuses.forEach((s, i) => { s.isDefault = i === index })
}

function move<T>(list: T[], index: number, by: number) {
  const target = index + by
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item!)
}

/** The row being dragged by its handle: rows swap as it passes over them, so the list shows the drop before it lands. */
const dragging = ref<{ list: unknown[], index: number } | null>(null)

function startDrag(event: DragEvent, list: unknown[], index: number) {
  dragging.value = { list, index }
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', '')
  const row = (event.currentTarget as HTMLElement).closest('[data-row]')
  if (row) event.dataTransfer.setDragImage(row, 16, 16)
}

function overRow(list: unknown[], index: number) {
  const drag = dragging.value
  if (!drag || drag.list !== list || drag.index === index) return
  move(list, drag.index, index - drag.index)
  drag.index = index
}

function endDrag() {
  dragging.value = null
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
