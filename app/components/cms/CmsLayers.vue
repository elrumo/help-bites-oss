<script lang="ts">
import type { Ref } from 'vue'

export type LayerActions = {
  select: (id: string) => void
  add: (parentId: string, field: string, key: string) => void
  move: (id: string, parentId: string, field: string, index: number) => void
  dragging: Ref<string | null>
}
</script>

<script setup lang="ts">
/**
 * Layers: the blocks under `block`, field by field, indented to any depth.
 * Click selects; drag a row onto another to move it before or after that one,
 * into any list that takes it (the editor checks); each list ends with an add
 * menu of the components it takes. The editor provides the actions.
 */
import type { CmsBlock, CmsLibrary } from '#shared/cms/content'
import { childFields } from '#shared/cms/content'

const props = defineProps<{ block: CmsBlock, library: CmsLibrary, selectedId?: string | null, depth?: number }>()
const actions = inject<LayerActions>('cmsLayers')!
const depth = computed(() => props.depth ?? 0)

const fields = computed(() => childFields(props.block, props.library).map(key => ({
  key,
  field: props.library.get(props.block.component)!.fields.find(f => f.key === key)!,
  list: Array.isArray(props.block[key]) ? props.block[key] as CmsBlock[] : []
})))

const TITLE_KEYS = ['headline', 'title', 'name', 'label', 'question', 'value', 'brand', 'text', 'code']
function title(b: CmsBlock): string {
  const key = TITLE_KEYS.find(k => typeof b[k] === 'string' && (b[k] as string).trim())
  return key ? String(b[key]).replace(/[*_#`]/g, '').slice(0, 48) : ''
}

function addItems(allow: string[] | undefined, field: string) {
  const defs = [...props.library.values()].filter(d => d.nestable && (!allow?.length || allow.includes(d.key)))
  const item = (d: typeof defs[number]) => ({ label: d.name, description: d.description || undefined, icon: d.builtin ? 'i-lucide-box' : 'i-lucide-puzzle', onSelect: () => actions.add(props.block._uid, field, d.key) })
  const own = defs.filter(d => !d.builtin)
  return [defs.filter(d => d.builtin).map(item), ...(own.length ? [own.map(item)] : [])]
}

// Where a drop lands: before the row's middle goes before it, below goes after.
const dropAt = ref<{ field: string, index: number } | null>(null)

function onDragStart(e: DragEvent, id: string) {
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
      <p v-if="depth || fields.length > 1" class="px-2 pt-1 text-[11px] text-dimmed">{{ f.field.label }}</p>
      <div v-for="(child, i) in f.list" :key="child._uid" class="relative" @dragover="onDragOver($event, f.key, i)" @drop.prevent="onDrop">
        <span v-if="dropAt?.field === f.key && dropAt.index === i" class="pointer-events-none absolute inset-x-1 -top-px z-10 h-0.5 rounded-full bg-primary" />
        <UButton
          :icon="!library.get(child.component) ? 'i-lucide-circle-help' : library.get(child.component)!.builtin ? 'i-lucide-box' : 'i-lucide-puzzle'"
          :color="selectedId === child._uid ? 'primary' : 'neutral'"
          :variant="selectedId === child._uid ? 'soft' : 'ghost'"
          :size="depth ? 'xs' : 'sm'"
          block
          draggable="true"
          class="group cursor-grab justify-start rounded-md active:cursor-grabbing"
          :class="actions.dragging.value === child._uid && 'opacity-40'"
          @dragstart="onDragStart($event, child._uid)"
          @dragend="actions.dragging.value = null; dropAt = null"
          @click="actions.select(child._uid)"
        >
          <span class="truncate">{{ library.get(child.component)?.name || $t('projectTools.pages.missingComponent', { key: child.component }) }}</span>
          <span v-if="title(child)" class="truncate font-normal text-dimmed">{{ title(child) }}</span>
          <template #trailing>
            <UIcon v-if="child._anim" name="i-lucide-sparkles" class="ms-auto size-3 shrink-0 text-dimmed" />
            <UIcon name="i-lucide-grip-vertical" class="size-3.5 shrink-0 text-dimmed opacity-0 transition-opacity group-hover:opacity-100" :class="!child._anim && 'ms-auto'" />
          </template>
        </UButton>
        <CmsLayers :block="child" :library="library" :selected-id="selectedId" :depth="depth + 1" />
        <span v-if="i === f.list.length - 1 && dropAt?.field === f.key && dropAt.index === f.list.length" class="pointer-events-none absolute inset-x-1 -bottom-px z-10 h-0.5 rounded-full bg-primary" />
      </div>
      <div v-if="!f.list.length" class="rounded-md" @dragover="onDragOver($event, f.key, 0)" @drop.prevent="onDrop">
        <p class="px-2 py-1 text-[11px] text-dimmed" :class="dropAt?.field === f.key && 'text-primary'">{{ $t('projectTools.pages.emptyList') }}</p>
      </div>
      <UDropdownMenu :items="addItems(f.field.allow, f.key)" :content="{ align: 'start' }" :ui="{ content: 'max-h-80' }">
        <UButton icon="i-lucide-plus" :label="depth ? undefined : $t('projectTools.pages.addBlock')" size="xs" color="neutral" variant="ghost" class="text-dimmed" :aria-label="$t('projectTools.pages.addTo', { field: f.field.label })" />
      </UDropdownMenu>
    </div>
  </div>
</template>
