<template>
  <!-- Linear's comment box: a bordered card, not a bar. -->
  <div ref="rootRef" class="shrink-0 px-4 pb-4 pt-1">
    <p v-if="error" class="text-sm text-error mb-2">{{ error }}</p>

    <slot name="above" />

    <div v-if="replyingTo" class="flex items-center gap-1.5 px-1 mb-1.5 text-xs text-stone-500 dark:text-stone-400">
      <UIcon name="i-lucide-reply" class="size-3.5 shrink-0" />
      <span class="min-w-0 truncate">
        Replying to <span class="font-semibold text-stone-900 dark:text-stone-100">{{ replyingTo.name }}</span><span v-if="replyingTo.preview">, “{{ replyingTo.preview }}”</span>
      </span>
      <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" square class="rounded-full shrink-0 ml-auto" aria-label="Stop replying" @click="cancelReply" />
    </div>

    <div v-if="pending.length" class="flex flex-wrap gap-2 px-1 mb-2">
      <div v-for="(file, i) in pending" :key="file.url || i" class="relative animate-bubble-in">
        <img :src="file.previewUrl" :alt="file.name" class="size-14 rounded-lg object-cover border border-stone-200 dark:border-stone-700" :class="file.uploading ? 'opacity-50' : ''">
        <button type="button" class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-stone-800 text-white text-[10px] flex items-center justify-center" aria-label="Remove attachment" @click="removePending(i)">✕</button>
      </div>
    </div>

    <div class="composer-card flex items-end gap-1 rounded-xl border border-default bg-white p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors focus-within:border-accented dark:bg-white/[0.02]">
      <UButton
        v-if="allowAttachments"
        icon="i-lucide-image"
        color="neutral"
        variant="ghost"
        square
        class="rounded-full shrink-0"
        aria-label="Attach an image"
        :disabled="disabled"
        @click="fileInput?.click()"
      />
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple class="hidden" @change="onFiles">

      <UTextarea
        v-model="draft"
        :rows="1"
        :maxrows="6"
        autoresize
        :maxlength="MESSAGE_BODY_MAX_LENGTH"
        :placeholder="replyingTo ? 'Reply…' : placeholder"
        :disabled="disabled"
        class="flex-1"
        :ui="{ base: 'resize-none bg-transparent px-1.5 py-1.5 text-sm/5 ring-0 focus-visible:ring-0 focus-visible:outline-0 dark:bg-transparent' }"
        @keydown.enter.exact.prevent="submit"
        @paste="onPaste"
      />

      <!-- Wrapped so the grow-in is ours: the button's own disabled styles
           would otherwise win the cascade. -->
      <span class="shrink-0 transition-[transform,opacity] duration-200 ease-out" :class="canSend ? 'scale-100 opacity-100' : 'scale-75 opacity-45'">
        <UButton
          icon="i-lucide-arrow-up"
          color="primary"
          variant="solid"
          square
          class="rounded-full transition-transform active:scale-90"
          aria-label="Send"
          :disabled="!canSend"
          @click="submit"
        />
      </span>
    </div>

    <slot name="below" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { MESSAGE_BODY_MAX_LENGTH, type Attachment } from '#shared/support'

// No `sending` state: a message shows in the transcript the moment it is
// composed and its delivery is settled there, so the composer never locks.
const props = withDefaults(defineProps<{
  placeholder?: string
  disabled?: boolean
  error?: string
  replyingTo?: { id: string, name: string, preview: string } | null
  allowAttachments?: boolean
  /** Uploads one file and resolves to the stored attachment. */
  upload?: (file: File) => Promise<Attachment>
}>(), { placeholder: 'Message', disabled: false, error: '', replyingTo: null, allowAttachments: false })

const draft = defineModel<string>({ default: '' })

const emit = defineEmits<{
  (event: 'send', body: string, attachments: Attachment[]): void
  (event: 'cancel-reply'): void
  (event: 'upload-error', message: string): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

type PendingFile = { name: string, previewUrl: string, uploading: boolean, url?: string, mime?: string, size?: number }
const pending = ref<PendingFile[]>([])
const readyAttachments = computed<Attachment[]>(() => pending.value.filter(p => p.url).map(p => ({ url: p.url!, mime: p.mime!, size: p.size! })))
const canSend = computed(() => !props.disabled && Boolean(draft.value.trim() || readyAttachments.value.length) && !pending.value.some(p => p.uploading))

async function addFiles(files: File[]) {
  if (!props.upload) return
  for (const file of files.slice(0, 4 - pending.value.length)) {
    const entry: PendingFile = { name: file.name, previewUrl: URL.createObjectURL(file), uploading: true }
    pending.value = [...pending.value, entry]
    try {
      const stored = await props.upload(file)
      Object.assign(entry, stored, { uploading: false })
      pending.value = [...pending.value]
    } catch (error) {
      pending.value = pending.value.filter(p => p !== entry)
      emit('upload-error', (error as Error).message || 'Could not upload the image')
    }
  }
}

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  void addFiles(Array.from(input.files || []))
  input.value = ''
}

function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files || []).filter(f => f.type.startsWith('image/'))
  if (files.length && props.allowAttachments) {
    event.preventDefault()
    void addFiles(files)
  }
}

function removePending(index: number) {
  pending.value = pending.value.filter((_, i) => i !== index)
}

async function focusTextarea() {
  await nextTick()
  rootRef.value?.querySelector('textarea')?.focus()
}

watch(() => props.replyingTo?.id, (id) => {
  if (id) void focusTextarea()
})

function cancelReply() {
  emit('cancel-reply')
  void focusTextarea()
}

function submit() {
  const body = draft.value.trim()
  const attachments = readyAttachments.value
  if (!body && !attachments.length) return
  emit('send', body, attachments)
  draft.value = ''
  pending.value = []
}

defineExpose({ focus: focusTextarea })
</script>
