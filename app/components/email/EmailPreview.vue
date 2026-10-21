<script setup lang="ts">
/**
 * Live, email-accurate preview of an EmailDocument.
 *
 * We render the canonical email-safe HTML (the SAME renderer used for export)
 * into a sandboxed <iframe> so the email's own resets/inline styles apply
 * exactly as a mail client would show them — no leakage from the app's
 * Tailwind. The preview render tags every block's cell with `data-block-id`
 * (nested ones too, so a block inside a card selects on its own); a small
 * runtime inside the iframe outlines hover/selection, and relays clicks,
 * drags and editor shortcuts back out via postMessage. Later edits are posted in and
 * swapped into the body, so the preview keeps its scroll position instead of
 * reloading on every keystroke.
 */
import { renderEmailHtml } from '#shared/email/render'
import { EMAIL_PREVIEW_RUNTIME } from '#shared/email/previewRuntime'
import type { EmailDocument } from '#shared/email/blocks'

interface PreviewDevice {
  id: string
  label: string
  icon?: string
  width: number
  height: number
}

const props = defineProps<{
  document: EmailDocument
  selectedId?: string | null
  device: PreviewDevice
}>()

const emit = defineEmits<{
  (e: 'select', id: string | null): void
  (e: 'move', payload: { id: string, to: number }): void
}>()

const frame = ref<HTMLIFrameElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
const scale = ref(1)
const chromeHeight = 34

const frameWidth = computed(() => props.device.width)
const frameHeight = computed(() => props.device.height + chromeHeight)
const shellStyle = computed(() => ({
  width: `${frameWidth.value * scale.value}px`,
  height: `${frameHeight.value * scale.value}px`
}))
const deviceStyle = computed(() => ({
  width: `${frameWidth.value}px`,
  height: `${frameHeight.value}px`,
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left'
}))
const iframeStyle = computed(() => ({
  width: `${props.device.width}px`,
  height: `${props.device.height}px`
}))

function updateScale() {
  const el = viewport.value
  if (!el) return

  const availableWidth = Math.max(280, el.clientWidth - 32)
  const availableHeight = Math.max(360, el.clientHeight - 32)
  const nextScale = Math.min(1, availableWidth / frameWidth.value, availableHeight / frameHeight.value)
  scale.value = Math.max(0.3, Number(nextScale.toFixed(3)))
}

const blockIds = () => props.document.blocks.map(b => b.id)

/**
 * The render with the authored HTML (HTML and component blocks) defanged: it
 * runs in the frame next to the editor's runtime, so a script there could
 * drive the editor. Preview only; sent emails go out as written.
 */
function previewRender(): Document {
  return defangHtml(new DOMParser().parseFromString(renderEmailHtml(props.document, { ids: true }), 'text/html'))
}

// Only the runtime in the current srcdoc knows its nonce, so a message without
// it comes from something else, such as a page the frame was navigated to.
let nonce = ''

function buildSrcDoc(): string {
  const doc = previewRender()
  nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
  const runtime = doc.createElement('script')
  runtime.dataset.ids = JSON.stringify(blockIds())
  runtime.dataset.nonce = nonce
  runtime.textContent = EMAIL_PREVIEW_RUNTIME
  doc.body.append(runtime)
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

// The iframe takes posted renders once its runtime says it is ready; until
// then (first load) the srcdoc itself carries the latest render.
let ready = false
let built = props.document
const srcDoc = ref(buildSrcDoc())

function postRender() {
  post({ type: 'render', html: previewRender().documentElement.outerHTML, ids: blockIds() })
}

function post(msg: Record<string, unknown>) {
  frame.value?.contentWindow?.postMessage({ __email: true, ...msg }, '*')
}

function postSelected() {
  post({ type: 'selected', id: props.selectedId ?? null })
}

function onMessage(e: MessageEvent) {
  // only accept messages from our own preview iframe (its sandboxed origin is
  // opaque, so identify it by source window rather than origin)
  if (!frame.value?.contentWindow || e.source !== frame.value.contentWindow) return
  const d = e.data
  if (!d || !d.__email || d.nonce !== nonce) return
  if (d.type === 'select') emit('select', d.id ?? null)
  if (d.type === 'move' && typeof d.id === 'string' && typeof d.to === 'number') {
    emit('move', { id: d.id, to: d.to })
  }
  if (d.type === 'key' && typeof d.key === 'string') {
    // Replay on the parent page, where the editor's shortcuts listen.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: d.key, shiftKey: !!d.shiftKey, metaKey: !!d.metaKey, ctrlKey: !!d.ctrlKey, bubbles: true }))
  }
  if (d.type === 'ready') {
    ready = true
    if (built !== props.document) postRender()
    postSelected()
  }
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  window.addEventListener('message', onMessage)
  updateScale()
  if (viewport.value) {
    resizeObserver = new ResizeObserver(updateScale)
    resizeObserver.observe(viewport.value)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  resizeObserver?.disconnect()
})

watch(() => props.document, () => {
  if (ready) return postRender()
  built = props.document
  srcDoc.value = buildSrcDoc()
})
watch(() => props.selectedId, () => postSelected())
watch(() => props.device, () => nextTick(updateScale), { deep: true })
</script>

<template>
  <div
    ref="viewport"
    class="pc-dots flex h-full w-full justify-center overflow-auto p-6"
  >
    <div
      class="relative shrink-0 transition-[height,width]"
      :style="shellStyle"
    >
      <div
        class="absolute left-0 top-0 overflow-hidden rounded-lg bg-default shadow-sm ring-1 ring-default"
        :style="deviceStyle"
      >
        <div class="flex h-[34px] items-center justify-between border-b border-default bg-elevated/80 px-3">
          <div class="flex min-w-0 items-center gap-2">
            <UIcon
              :name="device.icon || 'i-lucide-monitor'"
              class="size-3.5 shrink-0 text-dimmed"
            />
            <span class="truncate text-xs font-medium text-highlighted">{{ device.label }}</span>
          </div>
          <span class="font-mono text-[11px] text-dimmed">{{ device.width }} × {{ device.height }}</span>
        </div>
        <iframe
          ref="frame"
          :srcdoc="srcDoc"
          :title="$t('emailLibrary.preview.frameTitle')"
          sandbox="allow-scripts"
          class="border-0 bg-white"
          :style="iframeStyle"
        />
      </div>
    </div>
  </div>
</template>
