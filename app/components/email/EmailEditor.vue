<script setup lang="ts">
/**
 * The 3-pane email studio (ported from email-hub):
 *
 *   ┌──────────┬────────────────────┬────────────┐
 *   │    AI    │   live preview     │  Design /  │
 *   │ designer │ (click to select,  │  Variables │
 *   ├──────────┤  drag to reorder)  │            │
 *   │  Layers  │                    │            │
 *   └──────────┴────────────────────┴────────────┘
 *
 * Both sides resize by dragging their inner edge, and so does the line between
 * AI and Layers (all remembered on this device); the two sections collapse
 * independently.
 *
 * One `document` is the source of truth; the preview and inspector edit it,
 * autosave sends it through `save`, and saves from other tabs (or a share-link
 * editor) arrive over the template's event stream. Variable defaults fill the
 * preview and exports only — the saved document keeps its {{ placeholders }}.
 * The AI pane, the API panel, image uploads and the component library need
 * `agentToken` (operators); share-link editors get the rest.
 */
import { locateBlock, type ComponentBlock, type EmailBlock, type EmailBlockType, type EmailDocument } from '#shared/email/blocks'
import { addBlock, moveBlock, removeBlock, replaceBlockWith } from '#shared/email/ops'
import { renderBlockTable } from '#shared/email/render'
import { resolveTemplate, type EmailBrand, type TemplateVariable } from '#shared/email/resolve'
import { componentInstance, refreshComponent, type EmailComponentDef } from '#shared/email/components'

import type { EmailTemplateDefinition } from '#shared/email/templates'
import { lintEmail } from '#shared/email/lint'
import type { EmailTemplate } from '~~/server/utils/emails'
import type { EmailEvent } from '~~/server/utils/events'
import { useDebounceFn, useLocalStorage } from '@vueuse/core'
import { useUndoRedo, type EditorSnapshot } from '~/composables/useUndoRedo'
import EmailPreview from '~/components/email/EmailPreview.vue'
import EmailInspector from '~/components/email/EmailInspector.vue'
import EmailVariables from '~/components/email/EmailVariables.vue'
import EmailTemplatePicker from '~/components/email/EmailTemplatePicker.vue'
import EmailChat from '~/components/email/EmailChat.vue'
import EmailLayers from '~/components/email/EmailLayers.vue'
import EmailApiDialog from '~/components/email/EmailApiDialog.vue'
import EmailComponentDialog from '~/components/email/EmailComponentDialog.vue'
import { EMAIL_BLOCK_META, EMAIL_BLOCK_START } from '~/utils/emailBlocks'


const props = defineProps<{
  template: EmailTemplate
  save: (patch: Record<string, unknown>) => Promise<EmailTemplate>
  streamUrl: string
  streamToken?: string | null
  backTo?: string
  canRename?: boolean
  /** A master (no project of its own): turns on the master-only checks. */
  master?: boolean
  /** The operator's session token; turns on the AI designer, the API panel and image uploads. */
  agentToken?: string | null
  /** The project's brand, for previews and exports of a project template. */
  brand?: EmailBrand | null
  /** Adds "Send test email" to the Export menu. */
  onSendTest?: () => void
}>()

const toast = useToast()
const { t } = useI18n()

const document = ref<EmailDocument>(props.template.document!)
const variables = ref<TemplateVariable[]>(props.template.variables)
const name = ref(props.template.name)
const selectedId = ref<string | null>(null)
const templateOpen = ref(false)
const rightTab = ref<string | number>('design')
const rightTabs = computed(() => [
  { label: t('emailEditor.design'), icon: 'i-lucide-sliders-horizontal', value: 'design' },
  { label: t('emailEditor.variables'), icon: 'i-lucide-braces', value: 'variables' }
])
const aiOpen = ref(true)
const layersOpen = ref(true)

// ---- undo / redo -----------------------------------------------------------
const { push: pushHistory, undo: undoPop, redo: redoPop, clear: clearHistory, canUndo, canRedo } = useUndoRedo()
let skipHistory = false
let skipNextSave = false
let lastEditAt = 0

const snapshot = (): EditorSnapshot => ({ document: document.value, name: name.value, variables: variables.value })

function applySnapshot(snap: EditorSnapshot) {
  // An unchanged document fires no watcher, which would leave the flag set
  // and silently drop the next edit from history.
  skipHistory = snap.document !== document.value
  lastEditAt = 0
  document.value = snap.document
  name.value = snap.name
  variables.value = snap.variables
}

function undo() {
  const prev = undoPop(snapshot())
  if (prev) applySnapshot(prev)
}

function redo() {
  const next = redoPop(snapshot())
  if (next) applySnapshot(next)
}

watch(document, (_next, prev) => {
  if (skipHistory) {
    skipHistory = false
    return
  }
  // A burst of edits (typing, dragging a color) is one undo step.
  const now = Date.now()
  if (now - lastEditAt > 600) pushHistory({ document: prev, name: name.value, variables: variables.value })
  lastEditAt = now
})

function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  if (target?.closest?.('input, textarea, select, [contenteditable]')) return
  // Shift turns the key uppercase on some platforms.
  const key = e.key.toLowerCase()
  if (e.metaKey || e.ctrlKey) {
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
    else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo() }
  } else if ((key === 'delete' || key === 'backspace') && selectedId.value
    && (target === window.document.body || target?.closest?.('[data-email-layers]'))) {
    // Only from the canvas or the layers list, never a focused toolbar control.
    e.preventDefault()
    document.value = removeBlock(document.value, selectedId.value).doc
    selectedId.value = null
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/** Replace the document from outside the inspector (AI turns, live sync) as one undo step. */
function replaceDocument(next: EmailDocument, options: { history?: boolean } = {}) {
  if (options.history === false) skipHistory = true
  document.value = next
}

// ---- checks --------------------------------------------------------------------
const issues = computed(() => lintEmail(document.value, { master: props.master }))
const chatRef = ref<InstanceType<typeof EmailChat> | null>(null)

function fixWithAi() {
  aiOpen.value = true
  chatRef.value?.send(t('emailEditor.quick.fixPrompt', { issues: issues.value.map(i => `- ${i.fix}`).join('\n') }))
}

// ---- preview ---------------------------------------------------------------
// While the designer writes a big edit, its draft shows here and fills in as
// it streams; the draft is never saved, and the real edit replaces it.
const draft = shallowRef<EmailDocument | null>(null)
const previewDocument = computed(() => resolveTemplate({ name: name.value, document: draft.value ?? document.value, variables: variables.value }, { brand: props.brand }).document)

const previewDevices = [
  { id: 'desktop', label: 'Desktop', icon: 'i-lucide-monitor', width: 720, height: 720 },
  { id: 'phone', label: 'Phone', icon: 'i-lucide-smartphone', width: 390, height: 760 }
] as const
const previewDeviceId = ref<(typeof previewDevices)[number]['id']>('desktop')
const previewDevice = computed(() => previewDevices.find(d => d.id === previewDeviceId.value) ?? previewDevices[0])

// ---- autosave --------------------------------------------------------------
const saving = ref(false)
const saveError = ref(false)
// Per-tab identity: the live stream echoes our own saves back; skip those.
const actorId = import.meta.client ? crypto.randomUUID() : ''

const saveNow = useDebounceFn(async () => {
  saving.value = true
  try {
    const saved = await props.save({ document: document.value, name: name.value, variables: variables.value, actorId })
    saveError.value = false
    // Keep variables reconciled with what the server stored — only on a real
    // change, or the watcher below would autosave forever.
    if (JSON.stringify(saved.variables) !== JSON.stringify(variables.value)) {
      skipNextSave = true
      variables.value = saved.variables
    }
  } catch (error: any) {
    saveError.value = true
    toast.add({ title: t('emailEditor.autosaveFailed'), description: error?.message, color: 'error' })
  } finally {
    saving.value = false
  }
}, 800)

watch([document, name, variables], () => {
  if (skipNextSave) {
    skipNextSave = false
    return
  }
  saveNow()
}, { deep: true })

// ---- live sync ---------------------------------------------------------------
useEventStream<EmailEvent>(computed(() => props.streamUrl), computed(() => props.streamToken ?? null), (event) => {
  const t = event.template
  if (event.type !== 'email.updated' || !t?.document || t.lastActorId === actorId) return
  skipNextSave = true
  skipHistory = true
  document.value = t.document
  variables.value = t.variables
  if (t.name) name.value = t.name
}, undefined, { anonymous: !props.streamToken })

// ---- component library -----------------------------------------------------------
// The shared components plus this project's own (a master sees the shared ones).
const { api, workspaceId } = useAgent()
const library = ref<EmailComponentDef[]>([])

async function loadLibrary() {
  if (!props.agentToken) return
  try {
    const res = await api<{ components: EmailComponentDef[] }>('/admin/email-components', { query: { project: props.template.projectId || undefined } })
    library.value = res.components
  } catch {} // the editor works without it
}
onMounted(loadLibrary)

function keepInLibrary(def: EmailComponentDef) {
  library.value = [...library.value.filter(c => c.id !== def.id), def].sort((a, b) => a.name.localeCompare(b.name))
}

// ---- manual editing --------------------------------------------------------
const addItems = computed(() => [
  (Object.keys(EMAIL_BLOCK_META) as EmailBlockType[]).filter(type => type !== 'component').map(type => ({
    ...EMAIL_BLOCK_META[type],
    onSelect: () => insert(type)
  })),
  ...(props.agentToken
    ? [[
        { type: 'label' as const, label: t('emailEditor.components') },
        ...library.value.map(c => ({ label: c.name, description: c.description || undefined, icon: 'i-lucide-puzzle', onSelect: () => insert('component', componentInstance(c)) })),
        { label: t('emailEditor.newComponentMore'), icon: 'i-lucide-plus', onSelect: () => openComponentDialog({}) }
      ]]
    : [])
])

/**
 * Insert after the selected block, in the same section or column; inside a
 * selected section, at its end; with nothing selected, at the end. Sections
 * and columns don't go inside columns: those land after the columns block.
 */
function insert(type: EmailBlockType, fields: Record<string, unknown> = {}) {
  const at = selectedId.value ? locateBlock(document.value.blocks, selectedId.value) : null
  const intoSection = at?.block.type === 'section'
  const container = type === 'section' || type === 'columns'
  let res = intoSection
    ? addBlock(document.value, type, { ...EMAIL_BLOCK_START[type], ...fields }, undefined, { id: at!.block.id })
    : addBlock(document.value, type, { ...EMAIL_BLOCK_START[type], ...fields }, at ? at.index + 1 : undefined, at?.parent ? { id: at.parent.id, column: at.column } : undefined)
  if (container && at?.parent?.type === 'columns') {
    const columns = locateBlock(document.value.blocks, at.parent.id)!
    res = addBlock(document.value, type, { ...EMAIL_BLOCK_START[type], ...fields }, columns.index + 1, columns.parent ? { id: columns.parent.id, column: columns.column } : undefined)
  }
  if (!res.ok) return
  document.value = res.doc
  selectedId.value = res.id
  rightTab.value = 'design'
}

// "Save as component" turns the block into the component it saved; "Edit
// component" updates the library and brings this email's copy along.
const componentDialog = reactive<{ open: boolean, component: EmailComponentDef | null, prefill: { name?: string, html?: string } | null, replaceId: string | null }>({ open: false, component: null, prefill: null, replaceId: null })

function openComponentDialog(options: { component?: EmailComponentDef | null, prefill?: { name?: string, html?: string } | null, replaceId?: string | null }) {
  Object.assign(componentDialog, { component: null, prefill: null, replaceId: null, ...options, open: true })
}

function saveBlockAsComponent(block: EmailBlock) {
  const html = block.type === 'html' ? block.html : renderBlockTable(block, document.value.settings.contentWidth)
  openComponentDialog({ prefill: { html }, replaceId: block.id })
}

function editComponent(block: ComponentBlock) {
  const def = library.value.find(c => c.id === block.componentId)
  // Gone from the library (or another project's): save this copy as a new one.
  if (def) openComponentDialog({ component: def, replaceId: block.id })
  else openComponentDialog({ prefill: { name: block.name, html: block.html }, replaceId: block.id })
}

function onComponentSaved(def: EmailComponentDef) {
  keepInLibrary(def)
  const old = componentDialog.replaceId ? locateBlock(document.value.blocks, componentDialog.replaceId)?.block : null
  if (!old) return
  // Only custom HTML keeps its padding and background outside its markup; a
  // section's rendered HTML already holds them, so they would double up.
  const keepFrame = old.type === 'html' || old.type === 'component'
  const next = old.type === 'component' && old.componentId === def.id
    ? { ...old, ...refreshComponent(old, def) }
    : { ...componentInstance(def), ...(keepFrame && old.padding !== undefined ? { padding: old.padding } : {}), ...(keepFrame && old.background ? { background: old.background } : {}) }
  const res = replaceBlockWith(document.value, old.id, [next])
  if (!res.ok) return
  document.value = res.doc
  selectedId.value = res.ids[0] ?? null
  toast.add({ title: t('emailEditor.savedComponent', { name: def.name }), color: 'success' })
}

function askAiForComponent() {
  aiOpen.value = true
  chatRef.value?.send(t('emailEditor.quick.reusablePrompt'))
}

function applyTemplate(payload: { template: EmailTemplateDefinition, document: EmailDocument }) {
  document.value = payload.document
  if (props.canRename) name.value = payload.template.name
  selectedId.value = null
  templateOpen.value = false
  toast.add({ title: t('emailEditor.appliedTemplate', { name: payload.template.name }), color: 'success' })
}

function applyBlank(next: EmailDocument) {
  document.value = next
  selectedId.value = null
  templateOpen.value = false
}

/** Stores a picked image for an image block; the inspector sets it as `src`. */
async function uploadImage(file: File): Promise<string> {
  const body = new FormData()
  body.append('file', file)
  const res = await $fetch<{ url: string }>(`/v1/admin/emails/${props.template.id}/image`, { method: 'POST', body, headers: { Authorization: `Bearer ${props.agentToken}`, ...(workspaceId.value ? { 'X-Workspace': workspaceId.value } : {}) } })
  return res.url
}

function onMove({ id, to }: { id: string, to: number }) {
  selectedId.value = id
  // A drop back where it started is not an edit (no undo step, no save).
  if (document.value.blocks[to]?.id === id) return
  const res = moveBlock(document.value, id, to)
  if (res.ok) document.value = res.doc
}

// ---- export ----------------------------------------------------------------
const exportItemsFor = useEmailExport()
const apiOpen = ref(false)
const sendKey = ref(props.template.key)
const exportItems = computed(() => [exportItemsFor(
  () => ({ name: name.value, rendered: previewDocument.value, design: document.value, variables: variables.value }),
  props.agentToken ? () => { apiOpen.value = true } : undefined
), ...(props.onSendTest ? [[{ label: t('emailEditor.sendTest'), icon: 'i-lucide-send', onSelect: props.onSendTest }]] : [])])
const apiTemplate = computed<EmailTemplate>(() => ({ ...props.template, name: name.value, key: sendKey.value, document: document.value, variables: variables.value }))

// ---- layout ------------------------------------------------------------------
// The sidebars' resize edge: a hairline that lights up while hovered.
const handleUi = 'after:absolute after:inset-y-0 after:-left-px after:w-0.5 after:transition-colors hover:after:bg-primary/60'
// AI and Layers share the left side (the split below); a collapsed one shrinks
// to its header. Folding glides: the split's flex-grow transitions while
// UCollapsible fades the content out (hiding it once the fade ends) or in.
// The usual height animation would fight the flex sizing.
const sectionUi = {
  root: 'flex min-h-0 flex-col border-b border-default last:border-b-0',
  content: 'flex min-h-0 flex-1 flex-col data-[state=open]:animate-[fade-in_300ms_var(--ease-out)] data-[state=closed]:animate-[fade-out_300ms_var(--ease-out)] [&[hidden]]:hidden'
}
const sectionTrigger = {
  color: 'neutral',
  variant: 'ghost',
  block: true,
  class: 'group h-10 shrink-0 justify-start rounded-none px-3 text-xs text-muted',
  ui: { leadingIcon: 'size-4 transition-transform group-data-[state=open]:rotate-90' }
} as const

// The AI / Layers split: the AI section's share of the column while both are open.
const leftColumn = ref<HTMLElement | null>(null)
const aiHeader = ref<HTMLElement | null>(null)
const aiShare = useLocalStorage('sb:emailEditorAiShare', 55)
const resizing = ref(false)
// Shares of the column (flex-basis 0); a folded section's min-height keeps its header.
const aiGrow = computed(() => !aiOpen.value ? 0 : layersOpen.value ? aiShare.value : 100)
const layersGrow = computed(() => !layersOpen.value ? 0 : aiOpen.value && props.agentToken ? 100 - aiShare.value : 100)
// Glides on fold and keyboard nudges; follows the pointer exactly while dragging.
const sectionMotion = computed(() => resizing.value ? '' : 'transition-[flex-grow] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]')

/** Leaves both sections at least 140px, or 40% each on a short screen. */
function clampShare(share: number): number {
  const min = Math.min(40, (140 / (leftColumn.value?.clientHeight || 1)) * 100)
  return Math.min(Math.max(share, min), 100 - min)
}

function startSplitDrag(e: PointerEvent) {
  // Captured, so the drag keeps going over the preview's iframe.
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  resizing.value = true
}

function onSplitDrag(e: PointerEvent) {
  if (!resizing.value || !leftColumn.value) return
  const box = leftColumn.value.getBoundingClientRect()
  aiShare.value = clampShare(((e.clientY - box.top) / box.height) * 100)
}

useHead({ title: () => name.value || t('sections.email') })
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-(--pc-bg)">
    <header class="flex h-12 shrink-0 items-center gap-1 border-b border-default bg-default px-2.5">
      <UButton v-if="backTo" :to="backTo" color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-left" :aria-label="$t('emailEditor.back')" />
      <slot name="badge" />
      <UInput
        v-model="name"
        variant="none"
        :placeholder="$t('emailEditor.untitledEmail')"
        :disabled="!canRename"
        :ui="{ base: 'text-sm font-medium px-1' }"
        class="min-w-0 max-w-[16rem] flex-1"
        :aria-label="$t('emailEditor.templateName')"
      />
      <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-default bg-elevated px-2 py-0.5 text-[11px] font-medium text-muted">
        <UIcon v-if="saving" name="i-lucide-loader-circle" class="size-3 animate-spin" />
        <span v-else class="size-1.5 rounded-full" :class="saveError ? 'bg-error' : 'bg-success'" />
        <span class="hidden sm:inline">{{ saving ? $t('emailEditor.saving') : saveError ? $t('emailEditor.notSaved') : $t('common.saved') }}</span>
      </span>
      <div class="flex-1" />
      <UButton icon="i-lucide-undo-2" color="neutral" variant="ghost" size="xs" :aria-label="$t('emailEditor.undo')" :disabled="!canUndo" @click="undo" />
      <UButton icon="i-lucide-redo-2" color="neutral" variant="ghost" size="xs" :aria-label="$t('emailEditor.redo')" :disabled="!canRedo" @click="redo" />
      <div class="mx-1 h-4 w-px bg-(--ui-border)" />
      <UDropdownMenu :items="addItems">
        <UButton icon="i-lucide-plus" :label="$t('emailEditor.add')" color="neutral" variant="ghost" size="xs" :ui="{ label: 'hidden sm:inline' }" />
      </UDropdownMenu>
      <UButton icon="i-lucide-layout-template" color="neutral" variant="ghost" size="xs" :aria-label="$t('emailEditor.startFromTemplate')" @click="templateOpen = true" />
      <div class="hidden sm:flex items-center rounded-md border border-default p-0.5">
        <UButton
          v-for="d in previewDevices"
          :key="d.id"
          :icon="d.icon"
          size="xs"
          :color="previewDeviceId === d.id ? 'primary' : 'neutral'"
          :variant="previewDeviceId === d.id ? 'soft' : 'ghost'"
          :aria-label="$t(`emailEditor.devices.${d.id}`)"
          @click="previewDeviceId = d.id"
        />
      </div>
      <UPopover>
        <UButton
          :icon="issues.some(i => i.level === 'error') ? 'i-lucide-circle-alert' : issues.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
          :label="issues.length ? String(issues.length) : undefined"
          :color="issues.some(i => i.level === 'error') ? 'error' : issues.length ? 'warning' : 'neutral'"
          variant="ghost"
          size="xs"
          :aria-label="issues.length ? $t('emailEditor.checksFailing', issues.length) : $t('emailEditor.allChecksPass')"
        />
        <template #content>
          <div class="w-80 p-2">
            <p class="px-1.5 pb-1.5 text-xs font-medium text-muted">{{ issues.length ? $t('emailEditor.checks') : $t('emailEditor.allChecksPass') }}</p>
            <button
              v-for="(issue, i) in issues"
              :key="i"
              type="button"
              class="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-elevated"
              @click="issue.blockId && (selectedId = issue.blockId)"
            >
              <UIcon :name="issue.level === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-triangle-alert'" class="mt-0.5 size-4 shrink-0" :class="issue.level === 'error' ? 'text-error' : 'text-warning'" />
              <span class="min-w-0 flex-1">{{ issue.message }}</span>
            </button>
            <UButton v-if="issues.length && agentToken" icon="i-lucide-sparkles" :label="$t('emailEditor.fixWithAi')" size="xs" color="primary" variant="soft" block class="mt-1.5" @click="fixWithAi" />
          </div>
        </template>
      </UPopover>
      <slot name="actions" />
      <UColorModeButton color="neutral" variant="ghost" size="xs" />
      <UDropdownMenu :items="exportItems">
        <UButton icon="i-lucide-code-xml" :label="$t('emailEditor.export')" color="neutral" variant="solid" size="xs" :ui="{ label: 'hidden sm:inline' }" />
      </UDropdownMenu>
    </header>

    <UDashboardGroup storage="local" storage-key="email-editor" unit="px" class="relative inset-auto min-h-0 flex-1">
      <UDashboardSidebar
        id="left"
        resizable
        :toggle="false"
        :default-size="340"
        :min-size="260"
        :max-size="600"
        :ui="{ root: 'min-h-0 bg-default', body: 'gap-0 overflow-hidden p-0', handle: handleUi }"
      >
        <div ref="leftColumn" class="flex min-h-0 flex-1 flex-col">
          <div
            v-if="agentToken"
            class="relative flex min-h-[calc(2.5rem+1px)] flex-col overflow-hidden"
            :class="sectionMotion"
            :style="{ flex: `${aiGrow} 1 0px` }"
          >
            <UCollapsible
              v-model:open="aiOpen"
              :unmount-on-hide="false"
              class="flex-1"
              :ui="sectionUi"
            >
              <UButton :label="$t('emailEditor.aiDesigner')" icon="i-lucide-chevron-right" v-bind="sectionTrigger" />
              <template #content>
                <EmailChat
                  ref="chatRef"
                  :template-id="template.id"
                  :token="agentToken"
                  :master="master"
                  :document="document"
                  :variables="variables"
                  :selected-id="selectedId"
                  :actor-id="actorId"
                  :issues="issues"
                  :header="aiHeader"
                  @document="draft = null; replaceDocument($event, { history: false })"
                  @draft="draft = $event"
                  @variables="variables = $event"
                  @select="selectedId = $event"
                  @checkpoint="pushHistory(snapshot())"
                  @restore="document = $event"
                  @open="aiOpen = true"
                  @component="keepInLibrary"
                />
              </template>
            </UCollapsible>
            <!-- EmailChat puts History and New chat here, over the header's right end. -->
            <div ref="aiHeader" class="absolute end-2 top-0 flex h-10 items-center gap-0.5" />
          </div>

          <!-- Drag (or focus and use the arrow keys) to share the height; double-click resets. -->
          <div
            v-if="agentToken && aiOpen && layersOpen"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="$t('emailEditor.resizeSplit')"
            :aria-valuenow="Math.round(aiShare)"
            aria-valuemin="0"
            aria-valuemax="100"
            tabindex="0"
            class="relative z-10 -my-1 h-2 shrink-0 cursor-row-resize touch-none outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-0.5 after:-translate-y-1/2 after:transition-colors hover:after:bg-primary/60 focus-visible:after:bg-primary"
            :class="resizing && 'after:bg-primary/60'"
            @pointerdown.prevent="startSplitDrag"
            @pointermove="onSplitDrag"
            @pointerup="resizing = false"
            @pointercancel="resizing = false"
            @keydown.up.prevent="aiShare = clampShare(aiShare - 5)"
            @keydown.down.prevent="aiShare = clampShare(aiShare + 5)"
            @dblclick="aiShare = 55"
          />

          <UCollapsible
            v-model:open="layersOpen"
            class="min-h-10 overflow-hidden"
            :class="sectionMotion"
            :style="{ flex: `${layersGrow} 1 0px` }"
            :ui="sectionUi"
          >
            <UButton :label="$t('emailEditor.layersCount', { n: document.blocks.length })" icon="i-lucide-chevron-right" v-bind="sectionTrigger" />
            <template #content>
              <EmailLayers
                :blocks="document.blocks"
                :selected-id="selectedId"
                @select="selectedId = $event"
                @move="onMove"
              />
            </template>
          </UCollapsible>
        </div>
      </UDashboardSidebar>

      <main class="min-w-0 flex-1">
        <EmailPreview
          :document="previewDocument"
          :selected-id="selectedId"
          :device="previewDevice"
          @select="selectedId = $event"
          @move="onMove"
        />
      </main>

      <UDashboardSidebar
        id="right"
        side="right"
        resizable
        :toggle="false"
        :default-size="320"
        :min-size="280"
        :max-size="520"
        class="border-s border-default"
        :ui="{ root: 'min-h-0 bg-default', body: 'gap-0 overflow-hidden p-0', handle: handleUi }"
      >
        <div class="shrink-0 border-b border-default p-2">
          <UTabs v-model="rightTab" :items="rightTabs" :content="false" color="neutral" size="xs" class="w-full" />
        </div>
        <EmailInspector
          v-if="rightTab === 'design'"
          :document="document"
          :selected-id="selectedId"
          :upload="agentToken ? uploadImage : undefined"
          :library="library"
          :can-save-components="!!agentToken"
          @update:document="document = $event"
          @select="selectedId = $event"
          @save-component="saveBlockAsComponent"
          @edit-component="editComponent"
        />
        <EmailVariables
          v-else
          :document="document"
          :variables="variables"
          class="min-h-0 flex-1"
          @update:variables="variables = $event"
        />
      </UDashboardSidebar>
    </UDashboardGroup>

    <EmailApiDialog v-if="agentToken" v-model:open="apiOpen" :template="apiTemplate" @key="sendKey = $event" />

    <EmailComponentDialog
      v-if="agentToken"
      v-model:open="componentDialog.open"
      :component="componentDialog.component"
      :prefill="componentDialog.prefill"
      :project-id="template.projectId"
      :can-ask-ai="!!componentDialog.replaceId"
      @saved="onComponentSaved"
      @ask-ai="askAiForComponent"
    />

    <EmailTemplatePicker
      v-model:open="templateOpen"
      :title="$t('emailEditor.startFromTemplate')"
      :description="$t('emailEditor.replacesDesign')"
      @select="applyTemplate"
      @blank="applyBlank"
    />
  </div>
</template>
