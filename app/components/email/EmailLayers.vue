<script setup lang="ts">
/**
 * Layers: every block in order, the contents of sections and columns indented
 * beneath them. Click selects; drag a top-level row to reorder it (a line
 * marks where it lands, and rows glide to their new places). Nested blocks
 * move from the inspector.
 */
import type { EmailBlock } from '#shared/email/blocks'
import { EMAIL_BLOCK_META, emailBlockLabel } from '~/utils/emailBlocks'
import EmailLayerChildren from '~/components/email/EmailLayerChildren.vue'

const props = defineProps<{
  blocks: EmailBlock[]
  selectedId?: string | null
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'move', payload: { id: string, to: number }): void
}>()

const dragFrom = ref<number | null>(null)
// Insertion point (0…blocks.length) under the cursor; null hides the line.
const dropAt = ref<number | null>(null)

function onDragStart(e: DragEvent, i: number) {
  dragFrom.value = i
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', props.blocks[i]!.id)
}

function onDragOver(e: DragEvent, i: number) {
  if (dragFrom.value == null) return
  e.preventDefault()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const at = e.clientY > rect.top + rect.height / 2 ? i + 1 : i
  // Right above or below itself changes nothing: no line.
  dropAt.value = at === dragFrom.value || at === dragFrom.value + 1 ? null : at
}

function onDrop() {
  const from = dragFrom.value
  const at = dropAt.value
  if (from != null && at != null) emit('move', { id: props.blocks[from]!.id, to: at > from ? at - 1 : at })
  onDragEnd()
}

function onDragEnd() {
  dragFrom.value = null
  dropAt.value = null
}
</script>

<template>
  <div data-email-layers class="min-h-0 flex-1 overflow-y-auto p-2">
    <p v-if="!blocks.length" class="px-2 py-6 text-center text-xs text-muted">
      {{ $t('emailEditor.noBlocks') }}
    </p>
    <TransitionGroup v-else tag="ul" move-class="transition-transform duration-200 ease-out motion-reduce:transition-none" class="space-y-px">
      <li
        v-for="(b, i) in blocks"
        :key="b.id"
        class="relative"
        @dragover="onDragOver($event, i)"
        @drop.prevent="onDrop"
      >
        <span v-if="dropAt === i" class="pointer-events-none absolute inset-x-1 -top-px z-10 h-0.5 rounded-full bg-primary" />
        <UButton
          :icon="EMAIL_BLOCK_META[b.type]?.icon"
          :label="emailBlockLabel(b)"
          :color="selectedId === b.id ? 'primary' : 'neutral'"
          :variant="selectedId === b.id ? 'soft' : 'ghost'"
          size="sm"
          block
          draggable="true"
          class="group cursor-grab justify-start rounded-md active:cursor-grabbing"
          :class="dragFrom === i && 'opacity-40'"
          @dragstart="onDragStart($event, i)"
          @dragend="onDragEnd"
          @click="emit('select', b.id)"
        >
          <template #trailing>
            <UIcon name="i-lucide-grip-vertical" class="ms-auto size-3.5 shrink-0 text-dimmed opacity-0 transition-opacity group-hover:opacity-100" />
          </template>
        </UButton>

        <EmailLayerChildren :block="b" :selected-id="selectedId" @select="emit('select', $event)" />

        <span v-if="i === blocks.length - 1 && dropAt === blocks.length" class="pointer-events-none absolute inset-x-1 -bottom-px z-10 h-0.5 rounded-full bg-primary" />
      </li>
    </TransitionGroup>
  </div>
</template>
