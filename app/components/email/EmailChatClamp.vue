<script setup lang="ts">
/**
 * Holds a chat message to `max` px under a fade, with Show more to open it,
 * so one long prompt or reply doesn't take over the panel.
 */
import { useElementSize } from '@vueuse/core'

const props = withDefaults(defineProps<{ max?: number, disabled?: boolean }>(), { max: 200 })

const content = ref<HTMLElement | null>(null)
const { height } = useElementSize(content)
const open = ref(false)
// Folding away a line or two would hide more than it saves.
const tall = computed(() => !props.disabled && height.value > props.max + 32)
</script>

<template>
  <div>
    <div
      class="transition-[max-height] duration-300 ease-out"
      :class="tall && 'overflow-hidden'"
      :style="tall ? { maxHeight: `${open ? height : max}px`, maskImage: open ? undefined : 'linear-gradient(to bottom, #000 calc(100% - 3.5rem), transparent)' } : undefined"
    >
      <div ref="content">
        <slot />
      </div>
    </div>
    <button
      v-if="tall"
      type="button"
      class="mt-1 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted transition-colors hover:text-highlighted"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ open ? $t('emailEditor.showLess') : $t('emailEditor.showMore') }}
      <UIcon name="i-lucide-chevron-down" class="size-3.5 transition-transform duration-300" :class="open && 'rotate-180'" />
    </button>
  </div>
</template>
