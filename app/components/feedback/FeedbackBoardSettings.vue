<template>
  <form class="space-y-8" @submit.prevent="emit('save', toConfig())">
    <section v-if="!boardOnly" class="space-y-4">
      <USwitch v-model="draft.enabled" label="Board is live" description="Visitors can read it with the project's public key; signed-in users can post, vote and comment." />
      <UFormField label="Title" hint="Defaults to “{project} feedback”">
        <UInput v-model="draft.title" class="w-full" placeholder="Feature requests & bug reports" />
      </UFormField>
      <UFormField label="Description">
        <UTextarea v-model="draft.description" :rows="2" autoresize class="w-full" placeholder="Ideas, bugs and requests — vote on what matters to you." />
      </UFormField>
      <UFormField label="Post URL" hint="Where a post lives on your site; {id}, {number} and {slug} are replaced. Used in emails and the RSS feed.">
        <UInput v-model="draft.postUrlTemplate" class="w-full font-mono text-xs" placeholder="https://app.example.com/feedback?feedback={id}" />
      </UFormField>
    </section>

    <section v-if="!boardOnly" class="space-y-3">
      <h3 class="text-sm font-semibold">Options</h3>
      <div class="grid sm:grid-cols-2 gap-3">
        <UCheckbox v-model="draft.allowComments" label="Comments" description="Users can comment on posts." />
        <UCheckbox v-model="draft.allowUserEdits" label="Authors can edit" description="Title, text, type, platform and tags of their own posts, and their comments." />
        <UCheckbox v-model="draft.showAuthorNames" label="Show author names" description="Admins always see them." />
        <UCheckbox v-model="draft.emailNotifications" label="Email notifications" description="Status changes and new comments to a post's followers, mentions to whoever is mentioned." />
        <UCheckbox v-model="draft.roadmap" label="Roadmap view" description="Planned, in-progress and done columns in the embed." />
        <UCheckbox v-model="draft.changelog" label="Changelog" description="Done posts marked for the changelog, plus an RSS feed." />
      </div>
    </section>

    <section class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold">Statuses</h3>
        <p v-if="boardOnly" class="text-xs text-muted">The category is what a status means: public items in a planned, active or done status show on the roadmap; the rest stay private.</p>
        <p v-else class="text-xs text-muted">The category is what a status means everywhere: open, planned and active show on the board by default; done feeds the changelog and closes voting.</p>
      </div>
      <div class="space-y-2">
        <div v-for="(status, i) in draft.statuses" :key="status.uid" class="grid grid-cols-[1fr_1fr] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_7.5rem_6.5rem_auto] items-center gap-2 rounded-xl border border-default p-2">
          <UInput v-model="status.label" size="sm" placeholder="Label" aria-label="Status label" @blur="fillKey(status)" />
          <UInput v-model="status.key" size="sm" placeholder="key" class="font-mono" aria-label="Status key" />
          <USelect v-model="status.category" :items="categoryItems" size="sm" aria-label="Category" />
          <USelect v-model="status.color" :items="colorItems" size="sm" aria-label="Colour" />
          <div class="col-span-2 sm:col-span-1 flex items-center gap-1 justify-end">
            <UTooltip :text="boardOnly ? 'Default for new items' : 'Default for new posts'"><UButton :icon="status.isDefault ? 'i-lucide-star' : 'i-lucide-star-off'" size="xs" :color="status.isDefault ? 'primary' : 'neutral'" variant="ghost" square aria-label="Make default" @click="makeDefault(i)" /></UTooltip>
            <UTooltip v-if="!boardOnly" text="Email the post's followers when it moves here"><UButton :icon="status.notify ? 'i-lucide-bell-ring' : 'i-lucide-bell-off'" size="xs" :color="status.notify ? 'primary' : 'neutral'" variant="ghost" square aria-label="Notify author" @click="status.notify = !status.notify" /></UTooltip>
            <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="i === 0" aria-label="Move up" @click="move(draft.statuses, i, -1)" />
            <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :disabled="draft.statuses.length < 2" aria-label="Remove status" @click="draft.statuses.splice(i, 1)" />
          </div>
        </div>
      </div>
      <UButton icon="i-lucide-plus" label="Add status" size="xs" color="neutral" variant="soft" @click="draft.statuses.push({ uid: uid(), key: '', label: '', category: 'open', color: 'neutral', isDefault: false, notify: false })" />
    </section>

    <section v-if="!boardOnly" class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold">Post types</h3>
        <p class="text-xs text-muted">Icon: an Iconify name like <code class="font-mono">lucide:bug</code>, or an emoji.</p>
      </div>
      <div class="space-y-2">
        <div v-for="(type, i) in draft.types" :key="type.uid" class="grid grid-cols-[2rem_1fr_1fr] sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-default p-2">
          <span class="grid size-8 place-items-center rounded-lg bg-elevated"><FeedbackIcon :icon="type.icon" fallback="i-lucide-tag" class="size-4" /></span>
          <UInput v-model="type.label" size="sm" placeholder="Label" aria-label="Type label" @blur="fillKey(type)" />
          <UInput v-model="type.key" size="sm" placeholder="key" class="font-mono" aria-label="Type key" />
          <UInput v-model="type.icon" size="sm" placeholder="lucide:bug" class="col-span-2 sm:col-span-1 font-mono" aria-label="Icon" />
          <div class="flex items-center gap-1 justify-end">
            <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="i === 0" aria-label="Move up" @click="move(draft.types, i, -1)" />
            <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square aria-label="Remove type" @click="draft.types.splice(i, 1)" />
          </div>
        </div>
      </div>
      <UButton icon="i-lucide-plus" label="Add type" size="xs" color="neutral" variant="soft" @click="draft.types.push({ uid: uid(), key: '', label: '', icon: '' })" />
    </section>

    <section v-if="!boardOnly" class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold">Platforms</h3>
        <p class="text-xs text-muted">Optional. Leave empty to hide the platform picker.</p>
      </div>
      <div class="space-y-2">
        <div v-for="(platform, i) in draft.platforms" :key="platform.uid" class="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-xl border border-default p-2">
          <UInput v-model="platform.label" size="sm" placeholder="Label" aria-label="Platform label" @blur="fillKey(platform)" />
          <UInput v-model="platform.key" size="sm" placeholder="key" class="font-mono" aria-label="Platform key" />
          <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square aria-label="Remove platform" @click="draft.platforms.splice(i, 1)" />
        </div>
      </div>
      <UButton icon="i-lucide-plus" label="Add platform" size="xs" color="neutral" variant="soft" @click="draft.platforms.push({ uid: uid(), key: '', label: '' })" />
    </section>

    <section class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold">{{ boardOnly ? 'Labels' : 'Tags' }}</h3>
        <p v-if="boardOnly" class="text-xs text-muted">Labels items can carry several of — areas, teams, anything. The roadmap shows them only if you turn that on.</p>
        <p v-else class="text-xs text-muted">Optional labels a post can carry several of (up to 4) — areas, components, anything. Leave empty to hide the tag picker.</p>
      </div>
      <div class="space-y-2">
        <div v-for="(tag, i) in draft.tags" :key="tag.uid" class="grid grid-cols-[1fr_1fr] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6.5rem_auto] items-center gap-2 rounded-xl border border-default p-2">
          <UInput v-model="tag.label" size="sm" placeholder="Label" :aria-label="boardOnly ? 'Label name' : 'Tag label'" @blur="fillKey(tag)" />
          <UInput v-model="tag.key" size="sm" placeholder="key" class="font-mono" :aria-label="boardOnly ? 'Label key' : 'Tag key'" />
          <USelect v-model="tag.color" :items="colorItems" size="sm" aria-label="Colour" />
          <div class="flex items-center gap-1 justify-end">
            <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="i === 0" aria-label="Move up" @click="move(draft.tags, i, -1)" />
            <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="boardOnly ? 'Remove label' : 'Remove tag'" @click="draft.tags.splice(i, 1)" />
          </div>
        </div>
      </div>
      <UButton icon="i-lucide-plus" :label="boardOnly ? 'Add label' : 'Add tag'" size="xs" color="neutral" variant="soft" @click="draft.tags.push({ uid: uid(), key: '', label: '', color: 'neutral' })" />
    </section>

    <p v-if="error" class="text-sm text-error">{{ error }}</p>
    <div class="flex items-center gap-3">
      <UButton type="submit" color="primary" :loading="saving" label="Save board settings" />
      <span v-if="saved" class="text-sm text-muted">Saved</span>
    </div>
  </form>
</template>

<script setup lang="ts">
import {
  FEEDBACK_COLORS,
  FEEDBACK_STATUS_CATEGORIES,
  normalizeFeedbackKey,
  type FeedbackBoardConfig,
  type FeedbackColor,
  type FeedbackStatusCategory
} from '#shared/feedback'

// `boardOnly`: the project board's settings — statuses and labels (the tag
// list, renamed), without the feedback board's text, options, types and platforms.
const props = defineProps<{ config: FeedbackBoardConfig, saving?: boolean, saved?: boolean, error?: string, boardOnly?: boolean }>()
const emit = defineEmits<{ (e: 'save', config: FeedbackBoardConfig): void }>()

let counter = 0
const uid = () => `row-${++counter}`

const CATEGORY_LABELS: Record<FeedbackStatusCategory, string> = { open: 'Open', planned: 'Planned', active: 'Active', done: 'Done', closed: 'Closed' }
const categoryItems = FEEDBACK_STATUS_CATEGORIES.map(value => ({ label: CATEGORY_LABELS[value], value }))
const colorItems = FEEDBACK_COLORS.map(value => ({ label: value[0]!.toUpperCase() + value.slice(1), value }))

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
