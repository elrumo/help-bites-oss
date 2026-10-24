<template>
  <div class="space-y-2">
    <ul v-if="model.length" class="grid gap-2 sm:grid-cols-2">
      <li v-for="(file, i) in model" :key="file.url" class="group flex items-center gap-2 rounded-lg border border-default p-1.5 text-[13px]">
        <a :href="file.url" target="_blank" rel="noopener" class="flex min-w-0 flex-1 items-center gap-2">
          <img v-if="isImageMime(file.mime)" :src="file.url" :alt="file.name" class="size-10 shrink-0 rounded object-cover" loading="lazy">
          <span v-else class="grid size-10 shrink-0 place-items-center rounded bg-elevated text-muted"><UIcon name="i-lucide-file" class="size-4" /></span>
          <span class="min-w-0"><span class="block truncate">{{ file.name }}</span><span class="block text-[11px] text-muted">{{ size(file.size) }}</span></span>
        </a>
        <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('attachments.remove', { name: file.name })" @click="model = model.filter((_, n) => n !== i)" />
      </li>
    </ul>
    <input ref="input" type="file" multiple class="hidden" :accept="ITEM_ATTACHMENT_ACCEPT" @change="upload(($event.target as HTMLInputElement).files)">
    <UButton icon="i-lucide-paperclip" :label="$t('attachments.add')" size="xs" color="neutral" variant="soft" :loading="uploading > 0" :disabled="model.length >= ITEM_ATTACHMENTS_MAX" @click="input?.click()" />
    <p v-if="error" class="text-xs text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { isImageMime, ITEM_ATTACHMENT_ACCEPT, ITEM_ATTACHMENTS_MAX, ITEM_FILE_MAX_BYTES, type ItemAttachment } from '#shared/itemAttachments'

// Images and files on a post or board item. Uploads go to POST /v1/feedback/attachments; the page saves the
// list with the post or item, so this only edits it.

const props = defineProps<{ projectId: string }>()
const model = defineModel<ItemAttachment[]>({ default: () => [] })
const { api } = useAgent()
const { t } = useI18n()
const input = ref<HTMLInputElement | null>(null)
const uploading = ref(0)
const error = ref('')

const size = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

async function upload(files: FileList | null) {
  error.value = ''
  for (const file of [...(files || [])]) {
    if (model.value.length >= ITEM_ATTACHMENTS_MAX) break
    if (file.size > ITEM_FILE_MAX_BYTES) { error.value = t('attachments.tooLarge', { name: file.name }); continue }
    uploading.value++
    try {
      const body = new FormData()
      body.append('file', file)
      model.value = [...model.value, await api<ItemAttachment>('/feedback/attachments', { method: 'POST', query: { project: props.projectId }, body })]
    } catch (e: any) {
      error.value = e?.data?.statusMessage || e?.message || t('attachments.uploadError')
    } finally {
      uploading.value--
    }
  }
  if (input.value) input.value.value = ''
}
</script>
