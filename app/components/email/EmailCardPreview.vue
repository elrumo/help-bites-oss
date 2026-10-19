<script setup lang="ts">
/**
 * Lightweight email preview card — renders an EmailDocument into a
 * sandboxed iframe for use in template grids and picker UIs.
 */
import { renderEmailHtml } from '#shared/email/render'
import type { EmailDocument } from '#shared/email/blocks'

const props = defineProps<{ document: EmailDocument }>()

const frame = ref<HTMLIFrameElement | null>(null)
const frameHeight = ref(400)

const html = computed(() => renderEmailHtml(props.document))

function onFrameLoad() {
  try {
    const body = frame.value?.contentDocument?.body
    if (body) frameHeight.value = body.scrollHeight + 16
  } catch {}
}

onMounted(() => {
  if (frame.value) {
    frame.value.srcdoc = html.value
  }
})

watch(html, (val) => {
  if (frame.value) {
    frame.value.srcdoc = val
  }
})
</script>

<template>
  <div class="email-card-preview">
    <iframe
      ref="frame"
      sandbox="allow-same-origin"
      class="email-card-frame"
      :style="{ height: `${frameHeight}px` }"
      @load="onFrameLoad"
    />
  </div>
</template>

<style scoped>
.email-card-preview {
  width: 100%;
  overflow: hidden;
  border-radius: 8px 8px 0 0;
  background: var(--pc-window-solid);
  border-bottom: 1px solid var(--pc-border);
}

.email-card-frame {
  width: 100%;
  border: none;
  display: block;
  pointer-events: none;
  transform-origin: top left;
}
</style>
