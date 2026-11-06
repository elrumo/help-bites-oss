<script setup lang="ts">
/**
 * The Pages editor, laid out like the email studio:
 *
 *   ┌──────────┬────────────────────┬────────────┐
 *   │ AI  │ Layers │  live preview  │ Inspector  │
 *   │ (tabs)   │ (click, drag)      │ (fields,   │
 *   │          │                    │  style)    │
 *   └──────────┴────────────────────┴────────────┘
 *
 * One `content` tree is the source of truth. The preview, layers, inspector and
 * the assistant all replace it through the pure ops in shared/cms/content.ts;
 * every change is an undo step (a burst of typing is one) and autosaves the
 * working copy. Publishing freezes it for visitors.
 */
import { addBlock, allBlocks, findBlock, moveBlock, newBlock, removeBlock, searchBlocks, updateBlock, type CmsBlock, type CmsLibrary, type CmsStyle } from '#shared/cms/content'
import { previewUrlFor } from '#shared/cms/content'
import { useDebounceFn } from '@vueuse/core'
import type { CmsEntryView } from '~~/server/utils/cms'
import type CmsPreview from '~/components/cms/CmsPreview.vue'

const props = defineProps<{
  entry: CmsEntryView
  library: CmsLibrary
  projectId: string
  pk: string
  projectAccent: string
  previewUrl: string
}>()
const emit = defineEmits<{ (e: 'library'): void }>()

const { api } = useAgent()
const { t } = useI18n()
const toast = useToast()
const appUrl = useAppUrl()

const content = ref<CmsBlock>(props.entry.content!)
const style = ref<CmsStyle>(props.entry.style!)
const name = ref(props.entry.name)
const slug = ref(props.entry.slug)
const status = ref({ status: props.entry.status, changed: props.entry.changed, version: props.entry.version, path: props.entry.path })
const selectedId = ref<string | null>(null)
const leftTab = ref<string | number>('layers')
const query = ref('')
/** The block under the pointer, in the layers or the page; the other side lights it and scrolls to it. */
const hovered = ref<{ id: string, from: 'layers' | 'preview' } | null>(null)
const layersEl = ref<HTMLElement | null>(null)
const previewHover = ref<string | null>(null)
const syncHover = useDebounceFn((h: typeof hovered.value) => {
  previewHover.value = h?.from === 'layers' ? h.id : null
  if (h?.from === 'preview') layersEl.value?.querySelector(`[data-layer-id="${CSS.escape(h.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}, 120)
watch(hovered, h => syncHover(h))
/** Blocks folded shut in the layers. */
const collapsed = reactive(new Set<string>())
const found = computed(() => searchBlocks(content.value, props.library, query.value))
const searching = computed(() => query.value.trim() !== '')
/** Enter in the search box goes to the first block with the text. */
function selectFirstMatch() {
  const first = allBlocks(content.value, props.library).find(b => found.value.matches.has(b._uid))
  if (first) selectedId.value = first._uid === content.value._uid ? null : first._uid
}

// ---- undo / redo -----------------------------------------------------------
type Snapshot = { content: CmsBlock, style: CmsStyle, name: string }
const { push: pushHistory, undo: undoPop, redo: redoPop, canUndo, canRedo } = useUndoRedo<Snapshot>()
let skipHistory = false
let lastEditAt = 0
const snapshot = (): Snapshot => ({ content: content.value, style: style.value, name: name.value })

function apply(snap: Snapshot) {
  skipHistory = true
  lastEditAt = 0
  content.value = snap.content
  style.value = snap.style
  name.value = snap.name
}
const undo = () => { const s = undoPop(snapshot()); if (s) apply(s) }
const redo = () => { const s = redoPop(snapshot()); if (s) apply(s) }

watch([content, style, name], (_n, [prevContent, prevStyle, prevName]) => {
  if (skipHistory) {
    skipHistory = false
  } else {
    const now = Date.now()
    if (now - lastEditAt > 600) pushHistory({ content: prevContent as CmsBlock, style: prevStyle as CmsStyle, name: prevName as string })
    lastEditAt = now
  }
  saveSoon()
})

/** Replace the content from outside the pane that edits it (the assistant) as one step, or none. */
function replaceContent(next: CmsBlock, options: { history?: boolean } = {}) {
  if (options.history === false) skipHistory = true
  content.value = next
}

function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  if (target?.closest?.('input, textarea, select, [contenteditable]')) return
  const key = e.key.toLowerCase()
  if (e.metaKey || e.ctrlKey) {
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
    else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo() }
  } else if ((key === 'delete' || key === 'backspace') && selectedId.value && selectedId.value !== content.value._uid
    && (target === window.document.body || target?.closest?.('[data-cms-layers]'))) {
    e.preventDefault()
    const res = removeBlock(content.value, props.library, selectedId.value)
    if (res.ok) content.value = res.content
    selectedId.value = null
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// ---- saving ----------------------------------------------------------------
const saving = ref(false)
const saveError = ref(false)
const publishing = ref(false)

function took(entry: CmsEntryView) {
  status.value = { status: entry.status, changed: entry.changed, version: entry.version, path: entry.path }
}

const saveSoon = useDebounceFn(save, 800)
async function save(extra: Record<string, unknown> = {}) {
  saving.value = true
  try {
    const { entry, issues } = await api<{ entry: CmsEntryView, issues: string[] }>(`/admin/cms/entries/${props.entry.id}`, { method: 'PATCH', body: { content: content.value, style: style.value, name: name.value.trim() || props.entry.name, ...extra } })
    took(entry)
    slug.value = entry.slug
    saveError.value = false
    if (issues.length) toast.add({ title: t('projectTools.pages.fixedOnSave'), description: issues.slice(0, 3).join('\n'), color: 'warning' })
  } catch (e: any) {
    saveError.value = true
    toast.add({ title: t('projectTools.pages.saveError'), description: e?.data?.statusMessage || e?.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function setSlug(next: string) {
  const before = slug.value
  slug.value = next
  await save({ slug: next })
  if (saveError.value) slug.value = before
}

async function publish(action: 'publish' | 'unpublish' = 'publish') {
  publishing.value = true
  try {
    await save()
    const { entry } = await api<{ entry: CmsEntryView }>(`/admin/cms/entries/${props.entry.id}/${action}`, { method: 'POST' })
    took(entry)
    toast.add({ title: action === 'publish' ? t('projectTools.pages.published') : t('projectTools.pages.unpublished'), icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    toast.add({ title: t('projectTools.pages.publishError'), description: e?.data?.statusMessage || e?.message, color: 'error' })
  } finally {
    publishing.value = false
  }
}

// ---- layers ----------------------------------------------------------------------
const dragging = ref<string | null>(null)
provide('cmsLayers', {
  select: (id: string) => (selectedId.value = id),
  add(parentId: string, field: string, key: string) {
    const def = props.library.get(key)
    if (!def) return
    const block = newBlock(def)
    const res = addBlock(content.value, props.library, parentId, field, block)
    if (!res.ok) return toast.add({ title: res.message, color: 'warning' })
    content.value = res.content
    query.value = ''
    selectedId.value = block._uid
  },
  move(id: string, parentId: string, field: string, index: number) {
    if (id === parentId) return
    const res = moveBlock(content.value, props.library, id, parentId, field, index)
    if (!res.ok) return toast.add({ title: res.message, color: 'warning' })
    content.value = res.content
  },
  collapsed,
  hovered: computed(() => hovered.value?.id ?? null),
  hover: (id: string | null) => { hovered.value = id ? { id, from: 'layers' } : null },
  pageStyle: style,
  projectAccent: props.projectAccent,
  pk: props.pk,
  toggleCollapsed: (id: string) => { if (!collapsed.delete(id)) collapsed.add(id) },
  toggleHidden(id: string) {
    const at = findBlock(content.value, id, props.library)
    const res = at && updateBlock(content.value, props.library, id, { _hidden: !at.block._hidden })
    if (res?.ok) content.value = res.content
  },
  dragging
})

/** A drop in the preview: top-level blocks, `to` is where it ends up. */
function onPreviewMove({ id, to }: { id: string, to: number }) {
  selectedId.value = id
  const from = (content.value.body as CmsBlock[]).findIndex(b => b._uid === id)
  if (from === -1 || from === to) return
  const res = moveBlock(content.value, props.library, id, content.value._uid, 'body', to > from ? to + 1 : to)
  if (res.ok) content.value = res.content
}

// Selecting a block (in the page, by the assistant) unfolds the parents it sits in.
watch(selectedId, (id) => {
  for (let at = id ? findBlock(content.value, id, props.library) : null; at?.parent; at = findBlock(content.value, at.parent._uid, props.library)) collapsed.delete(at.parent._uid)
})

// ---- preview -------------------------------------------------------------------
const devices = [
  { id: 'desktop', icon: 'i-lucide-monitor', width: 1280 },
  { id: 'tablet', icon: 'i-lucide-tablet', width: 820 },
  { id: 'phone', icon: 'i-lucide-smartphone', width: 390 }
] as const
const deviceId = ref<(typeof devices)[number]['id']>('desktop')
const width = computed(() => devices.find(d => d.id === deviceId.value)!.width)
const source = ref<'helpbites' | 'site'>('helpbites')
const siteUrl = computed(() => source.value === 'site' && props.previewUrl ? previewUrlFor(props.previewUrl, slug.value) : '')
const bridgeEntry = computed(() => ({ id: props.entry.id, slug: slug.value, name: name.value, type: props.entry.type, version: status.value.version, content: content.value, style: style.value }))
const preview = ref<InstanceType<typeof CmsPreview> | null>(null)
const liveUrl = computed(() => `${appUrl.value}${status.value.path}`)

const moreItems = computed(() => [[
  { label: t('projectTools.pages.openLive'), icon: 'i-lucide-external-link', disabled: status.value.status !== 'published', onSelect: () => window.open(liveUrl.value, '_blank') },
  { label: t('projectTools.pages.unpublish'), icon: 'i-lucide-eye-off', disabled: status.value.status !== 'published', onSelect: () => publish('unpublish') }
], [
  { label: t('projectTools.pages.components'), icon: 'i-lucide-boxes', to: `/projects/${props.projectId}/pages?tab=components` },
  { label: t('projectTools.pages.reloadComponents'), icon: 'i-lucide-refresh-cw', onSelect: () => emit('library') }
]])

const handleUi = 'after:absolute after:inset-y-0 after:-left-px after:w-0.5 after:transition-colors hover:after:bg-primary/60'

/** The assistant renamed the page or restyled it (it saves them itself when its turn ends). */
function applyPage(page: { name?: string, slug?: string, style?: Partial<CmsStyle> }) {
  skipHistory = true
  if (page.name) name.value = page.name
  if (page.slug) slug.value = page.slug
  if (page.style) style.value = { ...style.value, ...page.style }
}

defineExpose({ replaceContent, applyPage, pushHistory: () => pushHistory(snapshot()) })
useHead({ title: () => name.value || t('sections.pages') })
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-(--pc-bg)">
    <header class="flex h-12 shrink-0 items-center gap-1 border-b border-default bg-default px-2.5">
      <UButton :to="`/projects/${projectId}/pages`" color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-left" :aria-label="$t('projectTools.pages.back')" />
      <UInput v-model="name" variant="none" :ui="{ base: 'text-sm font-medium px-1' }" class="min-w-0 max-w-[16rem] flex-1" :aria-label="$t('projectTools.pages.name')" />
      <UBadge v-if="status.status === 'published'" :label="status.changed ? $t('projectTools.pages.unpublishedChanges') : $t('projectTools.pages.publishedVersion', { version: status.version })" :color="status.changed ? 'warning' : 'success'" variant="soft" size="sm" class="hidden shrink-0 sm:inline-flex" />
      <UBadge v-else :label="$t('projectTools.pages.draft')" color="neutral" variant="soft" size="sm" class="hidden shrink-0 sm:inline-flex" />
      <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-default bg-elevated px-2 py-0.5 text-[11px] font-medium text-muted">
        <UIcon v-if="saving" name="i-lucide-loader-circle" class="size-3 animate-spin" />
        <span v-else class="size-1.5 rounded-full" :class="saveError ? 'bg-error' : 'bg-success'" />
        <span class="hidden sm:inline">{{ saving ? $t('projectTools.pages.saving') : saveError ? $t('projectTools.pages.notSaved') : $t('common.saved') }}</span>
      </span>
      <div class="flex-1" />
      <UButton icon="i-lucide-undo-2" color="neutral" variant="ghost" size="xs" :aria-label="$t('projectTools.pages.undo')" :disabled="!canUndo" @click="undo" />
      <UButton icon="i-lucide-redo-2" color="neutral" variant="ghost" size="xs" :aria-label="$t('projectTools.pages.redo')" :disabled="!canRedo" @click="redo" />
      <div class="mx-1 h-4 w-px bg-(--ui-border)" />
      <div class="hidden items-center rounded-md border border-default p-0.5 md:flex">
        <UButton v-for="d in devices" :key="d.id" :icon="d.icon" size="xs" :color="deviceId === d.id ? 'primary' : 'neutral'" :variant="deviceId === d.id ? 'soft' : 'ghost'" :aria-label="$t(`projectTools.pages.devices.${d.id}`)" @click="deviceId = d.id" />
      </div>
      <UTooltip :text="previewUrl ? '' : $t('projectTools.pages.siteNeedsUrl')">
        <div class="hidden items-center rounded-md border border-default p-0.5 lg:flex">
          <UButton :label="$t('projectTools.pages.sourceHelpBites')" size="xs" :color="source === 'helpbites' ? 'primary' : 'neutral'" :variant="source === 'helpbites' ? 'soft' : 'ghost'" @click="source = 'helpbites'" />
          <UButton :label="$t('projectTools.pages.sourceSite')" size="xs" :disabled="!previewUrl" :color="source === 'site' ? 'primary' : 'neutral'" :variant="source === 'site' ? 'soft' : 'ghost'" @click="source = 'site'" />
        </div>
      </UTooltip>
      <UButton v-if="source === 'helpbites'" icon="i-lucide-play" :label="$t('projectTools.pages.playAnimations')" color="neutral" variant="ghost" size="xs" :ui="{ label: 'hidden xl:inline' }" @click="preview?.play()" />
      <UDropdownMenu :items="moreItems">
        <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="xs" :aria-label="$t('projectTools.shared.more')" />
      </UDropdownMenu>
      <UButton :label="status.status === 'published' && status.changed ? $t('projectTools.pages.publishChanges') : $t('projectTools.pages.publish')" size="xs" :loading="publishing" :disabled="status.status === 'published' && !status.changed" @click="publish()" />
    </header>

    <UDashboardGroup storage="local" storage-key="cms-editor" unit="px" class="relative inset-auto min-h-0 flex-1">
      <UDashboardSidebar id="cms-left" resizable :toggle="false" :default-size="320" :min-size="240" :max-size="560" :ui="{ root: 'min-h-0 bg-default', body: 'gap-0 overflow-hidden p-0', handle: handleUi }">
        <div class="shrink-0 border-b border-default p-2">
          <UTabs v-model="leftTab" :items="[{ label: $t('projectTools.pages.assistant'), icon: 'i-lucide-sparkles', value: 'ai' }, { label: $t('projectTools.pages.layers'), icon: 'i-lucide-layers', value: 'layers' }]" :content="false" color="neutral" size="xs" class="w-full" />
        </div>
        <div v-show="leftTab === 'layers'" ref="layersEl" data-cms-layers class="min-h-0 flex-1 overflow-y-auto p-2">
          <UInput v-model="query" icon="i-lucide-search" size="sm" class="mb-2 w-full" :placeholder="$t('projectTools.pages.searchLayers')" :aria-label="$t('projectTools.pages.searchLayers')" @keydown.enter="selectFirstMatch" @keydown.esc="query = ''">
            <template v-if="query" #trailing>
              <UButton icon="i-lucide-x" color="neutral" variant="link" size="xs" :aria-label="$t('projectTools.pages.clearSearch')" @click="query = ''" />
            </template>
          </UInput>
          <p v-if="searching && !found.shown.size" class="px-2 py-3 text-xs text-muted">{{ $t('projectTools.pages.noSearchResults', { query: query.trim() }) }}</p>
          <UButton v-else icon="i-lucide-file" :label="library.get(content.component)?.name || content.component" :color="!selectedId || selectedId === content._uid ? 'primary' : 'neutral'" :variant="!selectedId || selectedId === content._uid ? 'soft' : 'ghost'" size="sm" block class="mb-1 justify-start rounded-md" :class="searching && found.matches.has(content._uid) && 'ring-1 ring-primary/50'" @click="selectedId = null" />
          <CmsLayers v-if="!searching || found.shown.size" :block="content" :library="library" :selected-id="selectedId" :shown="searching ? found.shown : null" :matches="found.matches" :query="query" />
        </div>
        <div v-show="leftTab === 'ai'" class="flex min-h-0 flex-1 flex-col">
          <slot name="assistant" :content="content" :selected-id="selectedId" />
        </div>
      </UDashboardSidebar>

      <main class="min-w-0 flex-1">
        <CmsPreview
          ref="preview"
          :name="name"
          :content="content"
          :page-style="style"
          :library="library"
          :project-accent="projectAccent"
          :pk="pk"
          :selected-id="selectedId"
          :width="width"
          :site-url="siteUrl || undefined"
          :entry="bridgeEntry"
          :hover-id="previewHover"
          @select="selectedId = $event"
          @hover="hovered = $event ? { id: $event, from: 'preview' } : null"
          @move="onPreviewMove"
        />
      </main>

      <UDashboardSidebar id="cms-right" side="right" resizable :toggle="false" :default-size="340" :min-size="280" :max-size="520" class="border-s border-default" :ui="{ root: 'min-h-0 bg-default', body: 'gap-0 overflow-hidden p-0', handle: handleUi }">
        <CmsInspector
          v-model:content="content"
          v-model:page-style="style"
          v-model:name="name"
          :slug="slug"
          :library="library"
          :selected-id="selectedId"
          :project-id="projectId"
          :project-accent="projectAccent"
          :page-path="liveUrl"
          @update:slug="setSlug"
          @select="selectedId = $event"
        />
      </UDashboardSidebar>
    </UDashboardGroup>
  </div>
</template>
