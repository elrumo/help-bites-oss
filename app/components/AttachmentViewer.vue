<template>
  <!-- Opens an image or video attachment in place of a new tab. Other files are links, so they never reach this. -->
  <UModal v-model:open="open" :title="file?.name" :description="$t('attachments.viewerDescription')" :ui="{ content: 'sm:max-w-4xl bg-stone-950 dark:bg-stone-950 border-stone-800 dark:border-stone-800', title: 'sr-only', description: 'sr-only' }">
    <template #body>
      <div v-if="file" class="space-y-3">
        <video v-if="isVideoMime(file.mime)" :key="file.url" :src="file.url" controls autoplay playsinline class="mx-auto max-h-[75vh] w-auto max-w-full rounded" />
        <img v-else :src="file.url" :alt="file.name" class="mx-auto max-h-[75vh] w-auto max-w-full object-contain">
        <div class="flex items-center justify-between gap-3 text-xs text-stone-300">
          <span class="truncate">{{ file.name }}</span>
          <UButton :href="file.url" :download="file.name" target="_blank" rel="noopener" icon="i-lucide-download" size="xs" color="neutral" variant="soft" :label="$t('attachments.download')" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { isVideoMime, type ItemAttachment } from '#shared/itemAttachments'

// The attachment on show (null: closed). Set it from a click; closing clears it, which also stops a playing video.
const file = defineModel<ItemAttachment | null>({ default: null })
const open = computed({
  get: () => Boolean(file.value),
  set: (value: boolean) => { if (!value) file.value = null }
})
</script>
