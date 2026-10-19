<script setup lang="ts">
/**
 * The blocks inside a section or a columns block, indented under it in
 * Layers, to any depth. Click selects; these move from the inspector.
 */
import type { EmailBlock } from '#shared/email/blocks'
import { EMAIL_BLOCK_META, emailBlockLabel } from '~/utils/emailBlocks'

defineProps<{ block: EmailBlock, selectedId?: string | null }>()
const emit = defineEmits<{ (e: 'select', id: string): void }>()
</script>

<template>
  <div v-if="block.type === 'section' || block.type === 'columns'" class="ms-4 space-y-px border-s border-default ps-1.5">
    <template v-for="(list, c) in block.type === 'columns' ? block.columns : [block.blocks]" :key="c">
      <p v-if="block.type === 'columns'" class="px-2 pt-1 text-[11px] text-dimmed">{{ $t('emailEditor.columnN', { n: c + 1 }) }}</p>
      <p v-else-if="!list.length" class="px-2 py-1 text-[11px] text-dimmed">{{ $t('emailEditor.empty') }}</p>
      <template v-for="child in list" :key="child.id">
        <UButton
          :icon="EMAIL_BLOCK_META[child.type]?.icon"
          :label="emailBlockLabel(child)"
          :color="selectedId === child.id ? 'primary' : 'neutral'"
          :variant="selectedId === child.id ? 'soft' : 'ghost'"
          size="xs"
          block
          class="justify-start rounded-md"
          @click="emit('select', child.id)"
        />
        <EmailLayerChildren :block="child" :selected-id="selectedId" @select="emit('select', $event)" />
      </template>
    </template>
  </div>
</template>
