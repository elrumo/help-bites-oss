<template>
  <div class="space-y-2">
    <div class="flex flex-col gap-2 items-center">
      <h3 class="text-sm font-semibold">
        {{ $t('attachments.title') }}
      </h3>
      <UButton
        icon="i-lucide-paperclip"
        :label="addLabel || $t('attachments.add')"
        size="xs"
        color="neutral"
        variant="soft"
        :loading="uploading > 0"
        :disabled="model.length >= ITEM_ATTACHMENTS_MAX"
        @click="input?.click()"
      />
    </div>

    <div class="space-y-2 rounded-lg transition-shadow" :class="dragging ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-default' : ''" @dragenter="onDragEnter" @dragleave="onDragLeave" @dragover="onDragOver" @drop="onDrop">
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
      <input ref="input" type="file" multiple class="hidden" :accept="imagesOnly ? ITEM_IMAGE_ACCEPT : ITEM_ATTACHMENT_ACCEPT" @change="upload([...(($event.target as HTMLInputElement).files || [])])">
      <p v-if="!model.length" class="text-xs text-muted">{{ $t('attachments.dropHint') }}</p>
      <p v-if="error" class="text-xs text-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { isImageMime, ITEM_ATTACHMENT_ACCEPT, ITEM_ATTACHMENTS_MAX, ITEM_FILE_MAX_BYTES, ITEM_IMAGE_ACCEPT, type ItemAttachment } from '#shared/itemAttachments'

// Images and files on a post or board item, or only images on a changelog entry (`imagesOnly`). Uploads go to
// POST /v1/feedback/attachments; the page saves the list with the post or item, so this only edits it.

const props = defineProps<{ projectId: string, imagesOnly?: boolean, addLabel?: string }>()
const model = defineModel<ItemAttachment[]>({ default: () => [] })
const { api } = useAgent()
const { t } = useI18n()
const input = ref<HTMLInputElement | null>(null)
const uploading = ref(0)
// Files being dragged over the panel: the count of enter events less leave events, so moving over children does not flicker.
const dragging = ref(0)
const error = ref('')

const size = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

async function upload(files: File[]) {
  error.value = ''
  for (const file of files) {
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

// An image pasted anywhere while this panel is open (it is only mounted while its sidebar is) is uploaded and attached,
// the same as a picked file. Text pastes are left alone.
function onPaste(event: ClipboardEvent) {
  const images = [...(event.clipboardData?.items || [])]
    .filter(item => item.kind === 'file' && isImageMime(item.type))
    .map(item => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  if (!images.length) return
  event.preventDefault()
  void upload(images)
}

// Files dropped on the panel are uploaded the same way; a changelog entry takes images only, so other files are skipped there.
const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files')
function onDragEnter(event: DragEvent) {
  if (hasFiles(event)) dragging.value++
}
function onDragLeave() {
  dragging.value = Math.max(0, dragging.value - 1)
}
function onDragOver(event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}
function onDrop(event: DragEvent) {
  dragging.value = 0
  if (!hasFiles(event)) return
  event.preventDefault()
  const files = [...(event.dataTransfer?.files || [])].filter(file => !props.imagesOnly || isImageMime(file.type))
  void upload(files)
}

onMounted(() => document.addEventListener('paste', onPaste))
onBeforeUnmount(() => document.removeEventListener('paste', onPaste))
</script>
