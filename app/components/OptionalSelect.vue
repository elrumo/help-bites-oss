<script setup lang="ts">
/**
 * A select where one choice means "none" ('' in the model). reka-ui refuses
 * '' as an item value, so that choice rides as a sentinel and maps back.
 */
const NONE = '__none'
const props = defineProps<{ items: { label: string, value: string }[], noneLabel?: string }>()
const model = defineModel<string | undefined>({ default: '' })
const all = computed(() => [{ label: props.noneLabel || '—', value: NONE }, ...props.items])
const value = computed({ get: () => model.value || NONE, set: (v: string) => { model.value = v === NONE ? '' : v } })
</script>

<template>
  <USelect v-model="value" :items="all" value-key="value" />
</template>
