<script lang="ts">
import type { Ref } from 'vue'
import type { CmsStyle } from '#shared/cms/content'

export type LayerActions = {
  select: (id: string) => void
  add: (parentId: string, field: string, key: string) => void
  move: (id: string, parentId: string, field: string, index: number) => void
  toggleHidden: (id: string) => void
  /** Blocks whose children are folded away. */
  collapsed: Set<string>
  toggleCollapsed: (id: string) => void
  /** The block the pointer is on, in these layers or in the page. */
  hovered: Ref<string | null>
  hover: (id: string | null) => void
  /** What the add menu's previews are drawn with. */
  pageStyle: Ref<CmsStyle>
  projectAccent: string
  pk: string
  dragging: Ref<string | null>
}
</script>

<script setup lang="ts">
/**
 * Layers: the blocks under `block`, field by field, indented to any depth.
 * Click selects; drag a row onto another to move it before or after that one,
 * into any list that takes it (the editor checks); each list ends with an add
 * menu of the components it takes. The editor provides the actions. A hidden
 * block stays here, dimmed, with an eye to show it again; a block with lists
 * folds them away behind its chevron. While searching
 * (`shown` is the blocks to keep, `matches` the ones with the text) the tree
 * narrows to them (folds open) and nothing moves. The top-level add menu is
 * pinned to the bottom of the pane so it is always in reach.
 */
import type { CmsBlock, CmsLibrary } from '#shared/cms/content'
import { childFields } from '#shared/cms/content'

const props = defineProps<{ block: CmsBlock, library: CmsLibrary, selectedId?: string | null, depth?: number, shown?: Set<string> | null, matches?: Set<string>, query?: string }>()
const actions = inject<LayerActions>('cmsLayers')!
const depth = computed(() => props.depth ?? 0)

const fields = computed(() => childFields(props.block, props.library).map(key => ({
  key,
  field: props.library.get(props.block.component)!.fields.find(f => f.key === key)!,
  list: (Array.isArray(props.block[key]) ? props.block[key] as CmsBlock[] : []).filter(b => !props.shown || props.shown.has(b._uid))
})))

const TITLE_KEYS = ['headline', 'title', 'name', 'label', 'question', 'value', 'brand', 'text', 'code']
function title(b: CmsBlock): string {
  const key = TITLE_KEYS.find(k => typeof b[k] === 'string' && (b[k] as string).trim())
  return key ? String(b[key]).replace(/[*_#`]/g, '').slice(0, 48) : ''
}

/** Where the search text is, a few words around it: why this block matched. */
function snippet(b: CmsBlock): string {
  const needle = (props.query || '').trim().toLowerCase()
  if (!needle || !props.matches?.has(b._uid)) return ''
  for (const [k, v] of Object.entries(b)) {
    if (k.startsWith('_') || k === 'component' || typeof v !== 'string') continue
    const at = v.toLowerCase().indexOf(needle)
    if (at === -1) continue
    const from = Math.max(0, at - 16)
    return `${from ? '…' : ''}${v.slice(from, at + needle.length + 32).replace(/[\n*_#`]/g, ' ')}`
  }
  return ''
}

const hasLists = (b: CmsBlock) => childFields(b, props.library).length > 0
const childCount = (b: CmsBlock) => childFields(b, props.library).reduce((n, k) => n + (Array.isArray(b[k]) ? (b[k] as unknown[]).length : 0), 0)

// Where a drop lands: before the row's middle goes before it, below goes after.
const dropAt = ref<{ field: string, index: number } | null>(null)

function onDragStart(e: DragEvent, id: string) {
  if (props.shown) return e.preventDefault()
  actions.dragging.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}

function onDragOver(e: DragEvent, field: string, index: number) {
  if (!actions.dragging.value) return
  e.preventDefault()
  e.stopPropagation()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dropAt.value = { field, index: e.clientY > rect.top + Math.min(rect.height, 32) / 2 ? index + 1 : index }
}

function onDrop(e: DragEvent) {
  e.stopPropagation()
  const id = actions.dragging.value
  if (id && dropAt.value) actions.move(id, props.block._uid, dropAt.value.field, dropAt.value.index)
  actions.dragging.value = null
  dropAt.value = null
}
</script>

<template>
  <div :class="depth ? 'ms-3 border-s border-default ps-1.5' : ''">
    <div v-for="f in fields" :key="f.key" class="space-y-px" @dragleave.self="dropAt = null">
      <p v-if="f.list.length && (depth || fields.length > 1)" class="px-2 pt-1 text-[11px] text-dimmed">{{ f.field.label }}</p>
      <TransitionGroup tag="div" name="layer-move" class="space-y-px">
      <div v-for="(child, i) in f.list" :key="child._uid" class="relative" @dragover="onDragOver($event, f.key, i)" @drop.prevent="onDrop">
        <span v-if="dropAt?.field === f.key && dropAt.index === i" class="pointer-events-none absolute inset-x-1 -top-px z-10 h-0.5 rounded-full bg-primary" />
        <UButton
          :color="selectedId === child._uid ? 'primary' : 'neutral'"
          :variant="selectedId === child._uid ? 'soft' : 'ghost'"
          :size="depth ? 'xs' : 'sm'"
          block
          :data-layer-id="child._uid"
          :draggable="!shown"
          class="group justify-start rounded-md"
          :class="[!shown && 'cursor-grab active:cursor-grabbing', actions.dragging.value === child._uid && 'opacity-40', child._hidden && 'opacity-50', matches?.has(child._uid) && 'ring-1 ring-primary/50', actions.hovered.value === child._uid && 'bg-elevated shadow-[inset_2px_0_0_var(--ui-primary)]']"
          @dragstart="onDragStart($event, child._uid)"
          @dragend="actions.dragging.value = null; dropAt = null"
          @mouseenter="actions.hover(child._uid)"
          @mouseleave="actions.hover(null)"
          @click="actions.select(child._uid)"
        >
          <template #leading>
            <span
              v-if="hasLists(child)"
              role="button"
              tabindex="0"
              class="-ms-1 shrink-0 rounded p-0.5 text-dimmed hover:text-highlighted"
              :aria-expanded="!!shown || !actions.collapsed.has(child._uid)"
              :aria-label="actions.collapsed.has(child._uid) ? $t('projectTools.pages.expand') : $t('projectTools.pages.collapse')"
              @click.stop="actions.toggleCollapsed(child._uid)"
              @keydown.enter.stop.prevent="actions.toggleCollapsed(child._uid)"
              @keydown.space.stop.prevent="actions.toggleCollapsed(child._uid)"
            >
              <UIcon name="i-lucide-chevron-right" class="block size-3.5 transition-transform" :class="(shown || !actions.collapsed.has(child._uid)) && 'rotate-90'" />
            </span>
            <span v-else class="-ms-1 inline-block size-4.5 shrink-0" />
            <UIcon :name="!library.get(child.component) ? 'i-lucide-circle-help' : library.get(child.component)!.builtin ? 'i-lucide-box' : 'i-lucide-puzzle'" class="size-4 shrink-0" />
          </template>
          <span class="truncate">{{ library.get(child.component)?.name || $t('projectTools.pages.missingComponent', { key: child.component }) }}</span>
          <span v-if="snippet(child) || title(child)" class="truncate font-normal text-dimmed" :class="child._hidden && 'line-through'">{{ snippet(child) || title(child) }}</span>
          <template #trailing>
            <span v-if="!shown && hasLists(child) && actions.collapsed.has(child._uid)" class="ms-auto shrink-0 rounded-full bg-elevated px-1.5 text-[10px] text-muted">{{ childCount(child) }}</span>
            <UIcon v-if="child._anim" name="i-lucide-sparkles" class="size-3 shrink-0 text-dimmed" :class="!(!shown && hasLists(child) && actions.collapsed.has(child._uid)) && 'ms-auto'" />
            <span
              role="button"
              tabindex="0"
              class="shrink-0 rounded p-0.5 text-dimmed hover:text-highlighted"
              :class="[!child._anim && !(!shown && hasLists(child) && actions.collapsed.has(child._uid)) && 'ms-auto', child._hidden ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100']"
              :aria-label="child._hidden ? $t('projectTools.pages.showBlock') : $t('projectTools.pages.hideBlock')"
              :title="child._hidden ? $t('projectTools.pages.showBlock') : $t('projectTools.pages.hideBlock')"
              @click.stop="actions.toggleHidden(child._uid)"
              @keydown.enter.stop.prevent="actions.toggleHidden(child._uid)"
              @keydown.space.stop.prevent="actions.toggleHidden(child._uid)"
            >
              <UIcon :name="child._hidden ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="block size-3.5" />
            </span>
            <UIcon v-if="!shown" name="i-lucide-grip-vertical" class="size-3.5 shrink-0 text-dimmed opacity-0 transition-opacity group-hover:opacity-100" />
          </template>
        </UButton>
        <CmsLayers v-if="shown || !actions.collapsed.has(child._uid)" :block="child" :library="library" :selected-id="selectedId" :depth="depth + 1" :shown="shown" :matches="matches" :query="query" />
        <span v-if="i === f.list.length - 1 && dropAt?.field === f.key && dropAt.index === f.list.length" class="pointer-events-none absolute inset-x-1 -bottom-px z-10 h-0.5 rounded-full bg-primary" />
      </div>
      </TransitionGroup>
      <!-- An empty list is one quiet line: its add menu, which a dragged block can also drop on. -->
      <div v-if="!shown || !depth" class="rounded-md" :class="[!f.list.length && dropAt?.field === f.key && 'ring-1 ring-primary', !depth && 'sticky bottom-0 z-10 -mx-2 border-t border-default bg-default px-2 py-1.5']" @dragover="!f.list.length && onDragOver($event, f.key, 0)" @drop.prevent="!f.list.length && onDrop($event)">
        <CmsAddMenu :library="library" :allow="f.field.allow" :page-style="actions.pageStyle.value" :project-accent="actions.projectAccent" :pk="actions.pk" @add="actions.add(block._uid, f.key, $event)">
          <UButton icon="i-lucide-plus" :label="f.list.length ? (depth ? undefined : $t('projectTools.pages.addBlock')) : (depth || fields.length > 1 ? f.field.label : $t('projectTools.pages.addBlock'))" size="xs" color="neutral" variant="ghost" class="text-dimmed" :aria-label="$t('projectTools.pages.addTo', { field: f.field.label })" />
        </CmsAddMenu>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layer-move-move { transition: transform 240ms cubic-bezier(.2, .8, .2, 1); }
@media (prefers-reduced-motion: reduce) { .layer-move-move { transition: none; } }
</style>
