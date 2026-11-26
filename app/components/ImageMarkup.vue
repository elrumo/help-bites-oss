<template>
  <!-- Draws on an image with the pointer or a finger (a canvas: no library needed) and hands back a PNG. -->
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <button v-for="c in COLORS" :key="c" type="button" class="size-6 rounded-full border-2" :class="color === c ? 'border-white' : 'border-transparent'" :style="{ background: c }" :aria-label="c" @click="color = c" />
      <input v-model.number="width" type="range" min="2" max="24" class="w-24" :aria-label="$t('attachments.markup.size')">
      <UButton icon="i-lucide-undo-2" size="xs" color="neutral" variant="soft" :disabled="!strokes.length" :label="$t('attachments.markup.undo')" @click="undo" />
      <span class="flex-1" />
      <UButton size="xs" color="neutral" variant="ghost" :label="$t('attachments.markup.cancel')" @click="emit('cancel')" />
      <UButton size="xs" icon="i-lucide-save" :loading="saving" :disabled="!strokes.length" :label="$t('attachments.markup.save')" @click="save" />
    </div>
    <p v-if="error" class="text-xs text-error">{{ error }}</p>
    <canvas v-show="ready" ref="canvas" class="mx-auto block max-h-[70vh] w-auto max-w-full touch-none cursor-crosshair rounded" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" />
    <p v-if="!ready && !error" class="text-center text-xs text-stone-300">{{ $t('attachments.markup.loading') }}</p>
  </div>
</template>

<script setup lang="ts">
// The picture is fetched as bytes (the storage allows any origin to read) so the canvas can be exported; the strokes
// are kept as points, so Undo redraws without them. Saving gives the page a PNG to upload.
const props = defineProps<{ src: string }>()
const emit = defineEmits<{ cancel: [], save: [blob: Blob] }>()
const { t } = useI18n()

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#000000']
type Stroke = { color: string, width: number, points: [number, number][] }

const canvas = ref<HTMLCanvasElement | null>(null)
const color = ref(COLORS[0]!)
const width = ref(6)
const strokes = ref<Stroke[]>([])
const ready = ref(false)
const saving = ref(false)
const error = ref('')
let picture: ImageBitmap | null = null
let drawing: Stroke | null = null

onMounted(async () => {
  try {
    const response = await fetch(props.src, { mode: 'cors' })
    if (!response.ok) throw new Error(String(response.status))
    picture = await createImageBitmap(await response.blob())
    const el = canvas.value!
    el.width = picture.width
    el.height = picture.height
    ready.value = true
    draw()
  } catch {
    error.value = t('attachments.markup.unreadable')
  }
})

// A stroke's width is in screen pixels, so it is scaled to the picture's own size.
const scale = () => (canvas.value ? canvas.value.width / canvas.value.getBoundingClientRect().width : 1)

function draw() {
  const el = canvas.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx || !picture) return
  ctx.drawImage(picture, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of [...strokes.value, ...(drawing ? [drawing] : [])]) {
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
    ctx.lineWidth = stroke.width
    const [first, ...rest] = stroke.points
    if (!first) continue
    if (!rest.length) { ctx.beginPath(); ctx.arc(first[0], first[1], stroke.width / 2, 0, Math.PI * 2); ctx.fill(); continue }
    ctx.beginPath()
    ctx.moveTo(first[0], first[1])
    for (const [x, y] of rest) ctx.lineTo(x, y)
    ctx.stroke()
  }
}

function point(event: PointerEvent): [number, number] {
  const box = canvas.value!.getBoundingClientRect()
  return [(event.clientX - box.left) * scale(), (event.clientY - box.top) * scale()]
}
function down(event: PointerEvent) {
  canvas.value?.setPointerCapture(event.pointerId)
  drawing = { color: color.value, width: width.value * scale(), points: [point(event)] }
  draw()
}
function move(event: PointerEvent) {
  if (!drawing) return
  drawing.points.push(point(event))
  draw()
}
function up() {
  if (!drawing) return
  strokes.value = [...strokes.value, drawing]
  drawing = null
  draw()
}
function undo() {
  strokes.value = strokes.value.slice(0, -1)
  draw()
}
function save() {
  saving.value = true
  canvas.value?.toBlob((blob) => {
    saving.value = false
    if (blob) emit('save', blob)
    else error.value = t('attachments.markup.unreadable')
  }, 'image/png')
}
</script>
