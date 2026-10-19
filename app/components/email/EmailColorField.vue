<script setup lang="ts">
/**
 * Hex input with a swatch that opens Nuxt UI's color picker. Typed values
 * apply once they are a full hex color (#rgb, #rrggbb, or with alpha) or
 * `transparent`; `clearable` adds a reset back to the theme default (emits
 * undefined).
 */
const props = defineProps<{
  modelValue?: string
  clearable?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | undefined): void
}>()

const COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent)$/i

function onType(value: unknown) {
  const v = String(value ?? '').trim()
  if (!v && props.clearable) emit('update:modelValue', undefined)
  else if (COLOR.test(v)) emit('update:modelValue', v)
}
</script>

<template>
  <UInput
    :model-value="modelValue ?? ''"
    :placeholder="placeholder ?? 'Default'"
    class="w-full"
    :ui="{ base: 'ps-9 font-mono', trailing: 'pe-1' }"
    @update:model-value="onType"
  >
    <template #leading>
      <UPopover>
        <button
          type="button"
          class="size-5 rounded-md ring-1 ring-black/15 ring-inset dark:ring-white/20"
          :class="(!modelValue || modelValue === 'transparent') && 'bg-[repeating-conic-gradient(var(--ui-border)_0_25%,transparent_0_50%)] bg-[length:8px_8px]'"
          :style="modelValue && modelValue !== 'transparent' ? { backgroundColor: modelValue } : undefined"
          aria-label="Pick a color"
        />
        <template #content>
          <UColorPicker
            :model-value="modelValue === 'transparent' ? undefined : modelValue"
            class="p-2"
            @update:model-value="emit('update:modelValue', $event)"
          />
        </template>
      </UPopover>
    </template>
    <template v-if="clearable && modelValue" #trailing>
      <UButton
        icon="i-lucide-x"
        size="xs"
        color="neutral"
        variant="link"
        aria-label="Reset color"
        @click="emit('update:modelValue', undefined)"
      />
    </template>
  </UInput>
</template>
