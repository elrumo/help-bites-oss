<template>
  <!-- Opens an image or video attachment in place of a new tab. Other files are links, so they never reach this. -->
  <UModal v-model:open="open" :title="file?.name" :description="$t('attachments.viewerDescription')" :ui="{ content: 'sm:max-w-4xl bg-stone-950 dark:bg-stone-950 border-stone-800 dark:border-stone-800', title: 'sr-only', description: 'sr-only' }">
    <template #body>
      <div v-if="file" class="space-y-3">
        <video v-if="isVideoMime(file.mime)" :key="file.url" :src="file.url" controls autoplay playsinline class="mx-auto max-h-[75vh] w-auto max-w-full rounded" />
        <ImageMarkup v-else-if="marking" :src="file.url" @cancel="marking = false" @save="saveMarkup" />
        <img v-else :src="file.url" :alt="file.name" class="mx-auto max-h-[75vh] w-auto max-w-full object-contain">
        <p v-if="error" class="text-xs text-error">{{ error }}</p>
        <div v-if="!marking" class="flex items-center justify-between gap-3 text-xs text-stone-300">
          <span class="truncate">{{ file.name }}</span>
          <span class="flex gap-2">
            <UButton v-if="canMark" icon="i-lucide-pencil-line" size="xs" color="neutral" variant="soft" :loading="saving" :label="$t('attachments.markup.open')" @click="marking = true" />
            <UButton :href="file.url" :download="file.name" target="_blank" rel="noopener" icon="i-lucide-download" size="xs" color="neutral" variant="soft" :label="$t('attachments.download')" />
          </span>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { isVideoMime, type ItemAttachment } from '#shared/itemAttachments'

// The attachment on show (null: closed). Set it from a click; closing clears it, which also stops a playing video.
const file = defineModel<ItemAttachment | null>({ default: null })
// With a `projectId` (an item or post being edited) a PNG, JPEG or WebP can be drawn on; the marked-up copy is uploaded
// and handed to `replace`, which swaps it for the original in the page's list.
const props = defineProps<{ projectId?: string }>()
const emit = defineEmits<{ replace: [original: ItemAttachment, edited: ItemAttachment] }>()
const { api } = useAgent()
const { t } = useI18n()
const marking = ref(false)
const saving = ref(false)
const error = ref('')
const canMark = computed(() => Boolean(props.projectId && file.value && ['image/png', 'image/jpeg', 'image/webp'].includes(file.value.mime)))
const open = computed({
  get: () => Boolean(file.value),
  set: (value: boolean) => { if (!value) file.value = null }
})
watch(file, () => { marking.value = false; error.value = '' })

async function saveMarkup(blob: Blob) {
  const original = file.value
  if (!original) return
  saving.value = true
  error.value = ''
  try {
    const body = new FormData()
    body.append('file', blob, `${original.name.replace(/\.[^.]+$/, '')}.png`)
    const edited = await api<ItemAttachment>('/feedback/attachments', { method: 'POST', query: { project: props.projectId }, body })
    emit('replace', original, edited)
    file.value = edited
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || t('attachments.uploadError')
  } finally {
    saving.value = false
  }
}
</script>
