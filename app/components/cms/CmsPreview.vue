<script setup lang="ts">
/**
 * The Pages editor's canvas. In "HelpBites" mode it renders the page with the
 * same renderer hosted pages use, into a sandboxed srcdoc frame whose runtime
 * (shared/cms/previewRuntime.ts) outlines and selects blocks and drags
 * top-level ones; later edits are posted in, so the frame keeps its scroll.
 * "Play" rebuilds the frame with the page runtime, so animations run once; the
 * editor plays the page as it opens, and an edit while it plays goes back to
 * editing at once.
 *
 * In "site" mode it frames the developer's own site (the project's preview
 * URL) and talks to public/cms.mjs's bridge there: the draft goes in on every
 * edit, clicks on `data-hb-uid` elements come back as selections.
 */
import { CMS_PREVIEW_RUNTIME } from '#shared/cms/previewRuntime'
import { loadCmsData, type CmsData } from '#shared/cms/dynamic'
import { renderPage } from '#shared/cms/render'
import type { CmsBlock, CmsLibrary, CmsStyle } from '#shared/cms/content'

const props = defineProps<{
  name: string
  content: CmsBlock
  pageStyle: CmsStyle
  library: CmsLibrary
  projectAccent: string
  pk: string
  selectedId?: string | null
  width: number
  /** The developer's site to frame instead (site mode); its origin is the only one heard. */
  siteUrl?: string
  /** The entry as the bridge receives it. */
  entry?: Record<string, unknown>
  /** A block the layers are pointing at: lit and scrolled into view here. */
  hoverId?: string | null
}>()

const emit = defineEmits<{
  (e: 'select', id: string | null): void
  (e: 'hover', id: string | null): void
  (e: 'move', payload: { id: string, to: number }): void
}>()

const frame = ref<HTMLIFrameElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
const scale = ref(1)
const playing = ref(false)

const shellStyle = computed(() => ({ width: `${props.width * scale.value}px`, height: '100%' }))
const frameStyle = computed(() => ({ width: `${props.width}px`, height: `${100 / scale.value}%`, transform: `scale(${scale.value})`, transformOrigin: 'top left' }))

function updateScale() {
  const el = viewport.value
  if (!el) return
  scale.value = Math.max(0.3, Math.min(1, Number(((el.clientWidth - 32) / props.width).toFixed(3))))
}

const topIds = () => (Array.isArray(props.content.body) ? props.content.body as CmsBlock[] : []).map(b => b._uid)

// What the blog, changelog and pricing blocks show: the public API's answers, as a visitor would get them.
let data: CmsData = {}
async function refreshData() {
  if (props.siteUrl) return
  const next = await loadCmsData(props.content, props.library, props.pk, path => $fetch(path), data)
  if (Object.keys(next).length === Object.keys(data).length) return
  data = next
  if (ready && !playing.value) postContent()
  else build()
}

function render(runtime = false): Document {
  const html = renderPage({ name: props.name, content: props.content, style: props.pageStyle, projectAccent: props.projectAccent, runtime }, { library: props.library, pk: props.pk, host: window.location.origin, data, editor: !runtime })
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // A component being written may still hold a script or handler: it never runs next to the runtime.
  defangHtml(doc, { keep: runtime ? 'script[data-motion]' : undefined, frames: true })
  return doc
}

let nonce = ''
let ready = false
const srcDoc = ref('')

function build() {
  ready = false
  const doc = render(playing.value)
  nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
  const runtime = doc.createElement('script')
  runtime.dataset.ids = JSON.stringify(topIds())
  runtime.dataset.nonce = nonce
  runtime.textContent = CMS_PREVIEW_RUNTIME
  doc.body.append(runtime)
  srcDoc.value = `<!doctype html>\n${doc.documentElement.outerHTML}`
}

const siteOrigin = computed(() => {
  try {
    return props.siteUrl ? new URL(props.siteUrl).origin : ''
  } catch {
    return ''
  }
})

function post(msg: Record<string, unknown>) {
  const win = frame.value?.contentWindow
  if (!win) return
  if (props.siteUrl) win.postMessage({ source: 'help-bites-cms', ...msg }, siteOrigin.value)
  else win.postMessage({ __cms: true, ...msg }, '*')
}

function postContent() {
  if (props.siteUrl) post({ type: 'entry', entry: JSON.parse(JSON.stringify(props.entry || {})) })
  else post({ type: 'render', html: render().documentElement.outerHTML, ids: topIds() })
}

function onMessage(e: MessageEvent) {
  if (!frame.value?.contentWindow || e.source !== frame.value.contentWindow) return
  const d = e.data
  if (props.siteUrl) {
    if (e.origin !== siteOrigin.value || !d || d.source !== 'help-bites-cms') return
  } else if (!d || !d.__cms || d.nonce !== nonce) {
    return
  }
  if (d.type === 'hover') emit('hover', typeof d.id === 'string' ? d.id : null)
  if (d.type === 'select') emit('select', typeof d.id === 'string' ? d.id : null)
  if (d.type === 'move' && typeof d.id === 'string' && typeof d.to === 'number') emit('move', { id: d.id, to: d.to })
  if (d.type === 'key' && typeof d.key === 'string') {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: d.key, shiftKey: !!d.shiftKey, metaKey: !!d.metaKey, ctrlKey: !!d.ctrlKey, bubbles: true }))
  }
  if (d.type === 'ready') {
    ready = true
    postContent()
    post({ type: 'selected', id: props.selectedId ?? null })
    if (props.hoverId) post({ type: 'hover', id: props.hoverId })
  }
}

let playTimer: ReturnType<typeof setTimeout> | undefined
function play() {
  clearTimeout(playTimer)
  playing.value = true
  build()
  // Back to editing once they have had time to run.
  playTimer = setTimeout(() => {
    playing.value = false
  }, 6000)
}

let observer: ResizeObserver | null = null
onMounted(() => {
  window.addEventListener('message', onMessage)
  if (!props.siteUrl) play()
  refreshData()
  updateScale()
  if (viewport.value) {
    observer = new ResizeObserver(updateScale)
    observer.observe(viewport.value)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  clearTimeout(playTimer)
  observer?.disconnect()
})

watch(() => [props.content, props.pageStyle, props.library, props.name, props.entry], () => {
  if (playing.value) {
    // The frame is the playing page (no editing runtime to post into): stop and show the edit.
    clearTimeout(playTimer)
    playing.value = false
    if (!props.siteUrl) build()
  } else if (ready) postContent()
  else if (!props.siteUrl) build()
  refreshData()
}, { deep: true })
watch(() => props.selectedId, id => post({ type: 'selected', id: id ?? null }))
watch(() => props.hoverId, id => { if (!props.siteUrl) post({ type: 'hover', id: id ?? null }) })
watch(() => props.width, () => nextTick(updateScale))
watch(() => props.siteUrl, () => {
  ready = false
  if (!props.siteUrl) build()
})

defineExpose({ play })
</script>

<template>
  <div ref="viewport" class="pc-dots flex h-full w-full justify-center overflow-hidden p-4">
    <div class="relative h-full shrink-0" :style="shellStyle">
      <div class="absolute left-0 top-0 h-full overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-default" :style="{ width: `${width * scale}px` }">
        <iframe
          v-if="siteUrl"
          :key="siteUrl"
          ref="frame"
          :src="siteUrl"
          :title="$t('projectTools.pages.preview')"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          class="border-0 bg-white"
          :style="frameStyle"
        />
        <iframe
          v-else
          ref="frame"
          :srcdoc="srcDoc"
          :title="$t('projectTools.pages.preview')"
          sandbox="allow-scripts"
          class="border-0 bg-white"
          :style="frameStyle"
        />
      </div>
    </div>
  </div>
</template>
