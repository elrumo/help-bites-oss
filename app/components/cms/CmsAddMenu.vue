<script setup lang="ts">
/**
 * The add-block menu: the components a blocks field takes, in a narrow list, and
 * beside it what the hovered (or focused) one looks like, rendered with the page's
 * own style, accent and example content. Wrap the button that opens it.
 */
import { newBlock, type CmsLibrary, type CmsStyle } from '#shared/cms/content'
import { renderPage } from '#shared/cms/render'

const props = defineProps<{ library: CmsLibrary, allow?: string[], pageStyle: CmsStyle, projectAccent: string, pk: string }>()
const emit = defineEmits<{ (e: 'add', key: string): void }>()

const open = ref(false)
const active = ref('')

const groups = computed(() => {
  const defs = [...props.library.values()].filter(d => d.nestable && (!props.allow?.length || props.allow.includes(d.key)))
  return [defs.filter(d => d.builtin), defs.filter(d => !d.builtin)].filter(g => g.length)
})
const shown = computed(() => active.value || groups.value[0]?.[0]?.key || '')

// One frame, rebuilt per component the first time it is hovered. Nothing in it can run: scripts are stripped and the sandbox has no allow-scripts (allow-same-origin alone is harmless, and an opaque-origin frame paints blank in some webviews).
const docs = new Map<string, string>()
const srcDoc = computed(() => {
  const def = props.library.get(shown.value)
  if (!open.value || !def) return ''
  const cached = docs.get(def.key)
  if (cached) return cached
  const html = renderPage({ name: def.name, content: newBlock(def), style: props.pageStyle, projectAccent: props.projectAccent }, { library: props.library, pk: props.pk, host: window.location.origin })
  const doc = new DOMParser().parseFromString(html, 'text/html')
  defangHtml(doc, { frames: true })
  const out = `<!doctype html>\n${doc.documentElement.outerHTML}`
  docs.set(def.key, out)
  return out
})
watch(() => [props.library, props.pageStyle, props.projectAccent], () => docs.clear())
watch(open, o => { if (o) active.value = '' })

function pick(key: string) {
  open.value = false
  emit('add', key)
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
  const at = items.indexOf(window.document.activeElement as HTMLButtonElement)
  e.preventDefault()
  ;(e.key === 'ArrowDown' ? items[at + 1] ?? items[0] : items[at - 1] ?? items.at(-1))?.focus()
}

const FRAME = 640
const VIEW = 272
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'start', collisionPadding: 8 }" :ui="{ content: 'w-auto max-w-[calc(100vw-1rem)]' }">
    <slot />
    <template #content>
      <div class="flex">
        <div role="menu" class="max-h-80 w-60 shrink-0 overflow-y-auto p-1" @keydown="onKey">
          <template v-for="(group, i) in groups" :key="i">
            <p v-if="i" class="px-2 pb-1 pt-2 text-[11px] text-dimmed">{{ $t('projectTools.pages.yourComponents') }}</p>
            <button
              v-for="d in group"
              :key="d.key"
              type="button"
              role="menuitem"
              class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-start outline-none hover:bg-elevated focus-visible:bg-elevated"
              :class="shown === d.key && 'bg-elevated'"
              @mouseenter="active = d.key"
              @focus="active = d.key"
              @click="pick(d.key)"
            >
              <UIcon :name="d.builtin ? 'i-lucide-box' : 'i-lucide-puzzle'" class="mt-0.5 size-4 shrink-0 text-muted" />
              <span class="min-w-0">
                <span class="block truncate text-sm text-highlighted">{{ d.name }}</span>
                <span v-if="d.description" class="line-clamp-2 text-xs text-muted">{{ d.description }}</span>
              </span>
            </button>
          </template>
        </div>
        <div v-if="srcDoc" class="hidden shrink-0 border-s border-default bg-muted p-2 sm:block" :style="{ width: `${VIEW + 16}px` }" aria-hidden="true">
          <div class="relative h-64 overflow-hidden rounded-md bg-white ring-1 ring-default">
            <iframe :key="shown" :srcdoc="srcDoc" sandbox="allow-same-origin" tabindex="-1" class="pointer-events-none absolute left-0 top-0 border-0 bg-white" :style="{ width: `${FRAME}px`, height: `${256 / (VIEW / FRAME)}px`, transform: `scale(${VIEW / FRAME})`, transformOrigin: 'top left' }" />
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
