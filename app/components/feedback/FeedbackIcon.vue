<template>
  <UIcon v-if="icon && iconify" :name="icon" :class="$attrs.class" aria-hidden="true" />
  <span v-else-if="icon" class="inline-flex items-center justify-center leading-none" :class="$attrs.class" aria-hidden="true">{{ icon }}</span>
  <UIcon v-else-if="fallback" :name="fallback" :class="$attrs.class" aria-hidden="true" />
</template>

<script setup lang="ts">
import { isIconifyName } from '#shared/feedback'

// A board icon is either an Iconify name (`lucide:bug`) or literal text (an emoji).
defineOptions({ inheritAttrs: false })
const props = defineProps<{ icon?: string, fallback?: string }>()
const iconify = computed(() => isIconifyName(props.icon || ''))
</script>
