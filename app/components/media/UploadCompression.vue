<script setup lang="ts">
/** The image-upload choice (useUploadCompression): original, smaller, or, with `sets`, modern formats with a fallback. */
const props = defineProps<{ sets?: boolean }>()
const { t } = useI18n()
const { mode } = useUploadCompression()

const items = computed(() => [
  { value: 'off', label: t('common.uploadCompression.off') },
  { value: 'webp', label: t('common.uploadCompression.webp') },
  ...(props.sets ? [{ value: 'modern', label: t('common.uploadCompression.modern') }] : [])
])
// Where only one file can be kept, "modern" was chosen elsewhere: it reads as "smaller" here.
const shown = computed({
  get: () => !props.sets && mode.value === 'modern' ? 'webp' : mode.value,
  set: (value) => { mode.value = value as UploadCompression }
})
const hint = computed(() => shown.value === 'modern' ? t('common.uploadCompression.hintModern') : shown.value === 'webp' ? t('common.uploadCompression.hint') : '')
</script>

<template>
  <UFormField :label="$t('common.uploadCompression.label')" :description="hint">
    <USelect v-model="shown" :items="items" size="sm" class="w-full" />
  </UFormField>
</template>
