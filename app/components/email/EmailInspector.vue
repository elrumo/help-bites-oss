<script setup lang="ts">
/**
 * Right-pane inspector. Shows either the document settings (when nothing is
 * selected) or a form for the selected block's fields. Edits are applied
 * immutably via the doc-ops helpers and bubbled up through the `update:*`
 * events; the parent owns the document state and autosave. Sections and
 * columns list their blocks with an Add menu; a library component shows its
 * fields, content and style apart.
 */
import type { Align, ComponentBlock, EmailBlock, EmailBlockType, EmailComponentField, EmailDocument, EmailTheme, PaddingSide } from '#shared/email/blocks'
import {
  coerceNumberLike,
  findBlock,
  getPaddingSides,
  getUniformPaddingValue,
  isPaddingSides,
  locateBlock
} from '#shared/email/blocks'
import { addBlock, moveBlock, removeBlock, replaceBlockWith, updateBlock, updateSettings } from '#shared/email/ops'
import { applyThemeToDocument, currentTheme, FONT_STACKS, THEME_PRESETS } from '#shared/email/theme'
import { componentValue } from '#shared/email/render'
import { componentOutdated, detachComponent, refreshComponent, type EmailComponentDef } from '#shared/email/components'
import { EMAIL_BLOCK_META, EMAIL_BLOCK_START, EMAIL_SHADOWS, emailBlockLabel } from '~/utils/emailBlocks'
import EmailColorField from '~/components/email/EmailColorField.vue'

const props = defineProps<{
  document: EmailDocument
  selectedId?: string | null
  /** Stores a picked image and returns its URL; turns on the Upload button. */
  upload?: (file: File) => Promise<string>
  /** The component library, to tell when a component has a newer version. */
  library?: EmailComponentDef[]
  /** Offers "Save as component" (operators only). */
  canSaveComponents?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:document', doc: EmailDocument): void
  (e: 'select', id: string | null): void
  (e: 'save-component', block: EmailBlock): void
  (e: 'edit-component', block: ComponentBlock): void
}>()

const selected = computed<EmailBlock | null>(() =>
  props.selectedId ? findBlock(props.document.blocks, props.selectedId) : null
)

/** Where the selection sits: its list (the email's, a section's or a column's) and parent. */
const location = computed(() => (props.selectedId ? locateBlock(props.document.blocks, props.selectedId) : null))

const alignItems = [
  { label: 'Left', value: 'left', icon: 'i-lucide-align-left' },
  { label: 'Center', value: 'center', icon: 'i-lucide-align-center' },
  { label: 'Right', value: 'right', icon: 'i-lucide-align-right' }
] satisfies Array<{ label: string, value: Align, icon: string }>

const paddingItems = [
  { side: 'top', label: 'Top' },
  { side: 'right', label: 'Right' },
  { side: 'bottom', label: 'Bottom' },
  { side: 'left', label: 'Left' }
] satisfies Array<{ side: PaddingSide, label: string }>

function patch(field: string, value: unknown) {
  if (!props.selectedId) return
  emit('update:document', updateBlock(props.document, props.selectedId, { [field]: value }).doc)
}

function patchSettings(field: string, value: unknown) {
  emit('update:document', updateSettings(props.document, { [field]: value }).doc)
}

function patchNumber(field: string, value: unknown, fallback = 0) {
  patch(field, coerceNumberLike(value, fallback))
}

function patchSettingNumber(field: string, value: unknown, fallback = 0) {
  patchSettings(field, coerceNumberLike(value, fallback))
}

function patchPadding(value: unknown) {
  const fallback = getUniformPaddingValue(selected.value?.padding) ?? 0
  patch('padding', coerceNumberLike(value, fallback))
}

function patchPaddingSide(side: PaddingSide, value: unknown) {
  if (!props.selectedId || !selected.value || selected.value.type === 'spacer') return

  const current = getPaddingSides(selected.value.padding)
  emit('update:document', updateBlock(props.document, props.selectedId, {
    padding: {
      ...current,
      [side]: coerceNumberLike(value, current[side])
    }
  }).doc)
}

// ---- image upload --------------------------------------------------------------
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref('')
// A component's image field being uploaded to, else the image block's src.
const uploadField = ref<string | null>(null)

function pickImage(field: string | null = null) {
  uploadField.value = field
  fileInput.value?.click()
}

async function onImageFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // The block selected at pick time gets the image, even if the selection moves on.
  const id = props.selectedId
  const field = uploadField.value
  if (!file || !id || !props.upload) return
  uploading.value = true
  uploadError.value = ''
  try {
    const url = await props.upload(file)
    emit('update:document', updateBlock(props.document, id, field ? { values: { [field]: url } } : { src: url }).doc)
  } catch (e: any) {
    uploadError.value = e?.data?.statusMessage || e?.message || 'Could not upload the image'
  } finally {
    uploading.value = false
    input.value = ''
  }
}

// ---- block actions ------------------------------------------------------------
function removeSelected() {
  if (!props.selectedId) return
  emit('update:document', removeBlock(props.document, props.selectedId).doc)
  emit('select', null)
}

/** Up or down within its own list (the email's, a section's or a column's). */
function moveSelected(delta: number) {
  const at = location.value
  if (!at) return
  emit('update:document', moveBlock(props.document, at.block.id, at.index + delta).doc)
}

function duplicateSelected() {
  const at = location.value
  if (!at) return
  // addBlock gives the copy (and any children) fresh ids.
  const res = addBlock(props.document, at.block.type, JSON.parse(JSON.stringify(at.block)), at.index + 1, at.parent ? { id: at.parent.id, column: at.column } : undefined)
  emit('update:document', res.doc)
  emit('select', res.id)
}

const actions = computed(() => {
  const at = location.value
  if (!at) return []
  return [
    { label: 'Move up', icon: 'i-lucide-arrow-up', disabled: at.index === 0, onClick: () => moveSelected(-1) },
    { label: 'Move down', icon: 'i-lucide-arrow-down', disabled: at.index === at.list.length - 1, onClick: () => moveSelected(1) },
    { label: 'Duplicate', icon: 'i-lucide-copy', disabled: false, onClick: duplicateSelected },
    ...(props.canSaveComponents && (at.block.type === 'html' || at.block.type === 'section')
      ? [{ label: 'Save as component', icon: 'i-lucide-puzzle', disabled: false, onClick: () => emit('save-component', at.block) }]
      : []),
    { label: 'Delete', icon: 'i-lucide-trash-2', disabled: false, onClick: removeSelected }
  ]
})

// ---- sections and columns -------------------------------------------------------
/** Built-in blocks to add inside the selection; columns hold plain blocks only. */
function childItems(column: number) {
  const inColumns = selected.value?.type === 'columns'
  return [(Object.keys(EMAIL_BLOCK_META) as EmailBlockType[])
    .filter(type => type !== 'component' && !(inColumns && (type === 'section' || type === 'columns')))
    .map(type => ({ ...EMAIL_BLOCK_META[type], onSelect: () => addChild(type, column) }))]
}

function addChild(type: EmailBlockType, column: number) {
  if (!props.selectedId) return
  const res = addBlock(props.document, type, EMAIL_BLOCK_START[type] ?? {}, undefined, { id: props.selectedId, column })
  if (!res.ok) return
  emit('update:document', res.doc)
  emit('select', res.id)
}

const shadowItems = (field: string) => [[
  { label: 'None', onSelect: () => patch(field, undefined) },
  ...EMAIL_SHADOWS.map(s => ({ label: s.label, description: s.value, onSelect: () => patch(field, s.value) }))
]]

// ---- components --------------------------------------------------------------------
const component = computed(() => (selected.value?.type === 'component' ? selected.value : null))
const libraryVersion = computed(() => props.library?.find(c => c.id === component.value?.componentId))
const outdated = computed(() => !!component.value && componentOutdated(component.value, libraryVersion.value))
const fieldGroups = computed(() => (['content', 'style'] as const)
  .map(group => ({ group, label: group === 'content' ? 'Content' : 'Style', fields: (component.value?.fields || []).filter(f => f.group === group) }))
  .filter(g => g.fields.length))

/** One field's value; the rest of this instance's values stay. */
function patchValue(field: EmailComponentField, value: unknown) {
  patch('values', { [field.key]: value == null ? null : String(value) })
}

function resetValues() {
  if (component.value) patch('values', Object.fromEntries(component.value.fields.map(f => [f.key, null])))
}

function updateFromLibrary() {
  const block = component.value
  const def = libraryVersion.value
  if (block && def) emit('update:document', replaceBlockWith(props.document, block.id, [{ ...block, ...refreshComponent(block, def) }]).doc)
}

function detach() {
  const block = component.value
  if (block) emit('update:document', replaceBlockWith(props.document, block.id, [detachComponent(block)]).doc)
}

// ---- theme designer ---------------------------------------------------------
const theme = computed<EmailTheme>(() => currentTheme(props.document))

const themeTokens = [
  { key: 'brand', label: 'Brand' },
  { key: 'onBrand', label: 'On brand' },
  { key: 'background', label: 'Page' },
  { key: 'surface', label: 'Card' },
  { key: 'heading', label: 'Headings' },
  { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Muted' }
] satisfies Array<{ key: keyof EmailTheme, label: string }>

function patchTheme(patch: Partial<EmailTheme>) {
  emit('update:document', applyThemeToDocument(props.document, patch))
}

function applyPreset(presetId: string) {
  const preset = THEME_PRESETS.find(p => p.id === presetId)
  if (preset) patchTheme({ ...preset.theme })
}

const fontItems = FONT_STACKS.map(f => ({ label: f.label, value: f.value }))

const paddingPopoverOpen = ref(false)

const hasIndividualPadding = computed(() => (
  !!selected.value
  && isPaddingSides(selected.value.padding)
  && getUniformPaddingValue(selected.value.padding) == null
))

const paddingSummary = computed(() => {
  if (!selected.value) return ''
  const { top, right, bottom, left } = getPaddingSides(selected.value.padding)
  return `Top ${top}px, right ${right}px, bottom ${bottom}px, left ${left}px`
})

// Reka's select refuses an empty value; "inherit" stands for the email's own font.
// A converted email's own stack (say, SF Pro Display) stays on the list.
const headingFontItems = computed(() => {
  const items = [{ label: 'Email font', value: 'inherit' }, ...FONT_STACKS.map(f => ({ label: f.label, value: f.value }))]
  const own = selected.value?.type === 'heading' ? selected.value.fontFamily : undefined
  return own && !items.some(i => i.value === own) ? [...items, { label: own.split(',')[0]!.replace(/['"]/g, '').trim(), value: own }] : items
})

watch(() => props.selectedId, () => {
  paddingPopoverOpen.value = false
  uploadError.value = ''
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <input v-if="upload" ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="onImageFile">
    <!-- Block inspector -->
    <template v-if="selected">
      <div class="flex h-11 shrink-0 items-center gap-1 border-b border-default px-2">
        <UTooltip text="Email settings">
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Back to email settings"
            @click="emit('select', null)"
          />
        </UTooltip>
        <UIcon :name="EMAIL_BLOCK_META[selected.type]?.icon" class="size-4 shrink-0 text-primary" />
        <span class="truncate text-sm font-semibold text-highlighted">{{ selected.type === 'component' ? selected.name : EMAIL_BLOCK_META[selected.type]?.label }}</span>
        <div class="flex-1" />
        <UTooltip v-for="a in actions" :key="a.label" :text="a.label">
          <UButton
            :icon="a.icon"
            :color="a.label === 'Delete' ? 'error' : 'neutral'"
            variant="ghost"
            size="xs"
            :aria-label="a.label"
            :disabled="a.disabled"
            @click="a.onClick"
          />
        </UTooltip>
      </div>

      <div class="flex-1 space-y-4 overflow-y-auto p-4">
        <button
          v-if="location?.parent"
          type="button"
          class="-mt-1 flex items-center gap-1 text-xs text-muted hover:text-default"
          @click="emit('select', location.parent.id)"
        >
          <UIcon name="i-lucide-corner-left-up" class="size-3.5" />
          In {{ location.parent.type === 'columns' ? `column ${location.column + 1}` : emailBlockLabel(location.parent).toLowerCase() }}: select it
        </button>

        <!-- Heading -->
        <template v-if="selected.type === 'heading'">
          <UFormField label="Text">
            <UTextarea
              :model-value="selected.text"
              :rows="2"
              autoresize
              class="w-full"
              @update:model-value="patch('text', $event)"
            />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Level">
              <USelect
                :model-value="selected.level"
                :items="[{ label: 'H1', value: 1 }, { label: 'H2', value: 2 }, { label: 'H3', value: 3 }]"
                class="w-full"
                @update:model-value="patch('level', Number($event))"
              />
            </UFormField>
            <UFormField label="Color">
              <EmailColorField
                :model-value="selected.color"
                clearable
                @update:model-value="patch('color', $event)"
              />
            </UFormField>
            <UFormField label="Font size (px)">
              <UInputNumber
                :model-value="selected.fontSize ?? [28, 22, 18][selected.level - 1]"
                :min="8"
                class="w-full"
                @update:model-value="patchNumber('fontSize', $event, selected.fontSize ?? 22)"
              />
            </UFormField>
            <UFormField label="Letter spacing (px)">
              <UInputNumber
                :model-value="selected.letterSpacing ?? 0"
                :step="0.1"
                class="w-full"
                @update:model-value="patch('letterSpacing', coerceNumberLike($event, 0) || undefined)"
              />
            </UFormField>
          </div>
          <UFormField label="Font">
            <USelect
              :model-value="selected.fontFamily || 'inherit'"
              :items="headingFontItems"
              class="w-full"
              @update:model-value="patch('fontFamily', $event === 'inherit' ? undefined : String($event))"
            />
          </UFormField>
        </template>

        <!-- Text -->
        <template v-else-if="selected.type === 'text'">
          <UFormField
            label="Content"
            help="Inline HTML: b, i, u, br, a and span; links and spans keep a color, weight and decoration in style=&quot;&quot;."
          >
            <UTextarea
              :model-value="selected.html"
              :rows="5"
              autoresize
              :maxrows="16"
              class="w-full"
              @update:model-value="patch('html', $event)"
            />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Font size (px)">
              <UInputNumber
                :model-value="selected.fontSize ?? 15"
                :min="8"
                class="w-full"
                @update:model-value="patchNumber('fontSize', $event, selected.fontSize ?? 15)"
              />
            </UFormField>
            <UFormField label="Color">
              <EmailColorField
                :model-value="selected.color"
                clearable
                @update:model-value="patch('color', $event)"
              />
            </UFormField>
          </div>
        </template>

        <!-- Button -->
        <template v-else-if="selected.type === 'button'">
          <UFormField label="Label">
            <UInput
              :model-value="selected.label"
              class="w-full"
              @update:model-value="patch('label', $event)"
            />
          </UFormField>
          <UFormField label="Link">
            <UInput
              :model-value="selected.href"
              type="url"
              placeholder="https://"
              icon="i-lucide-link"
              class="w-full"
              @update:model-value="patch('href', $event)"
            />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Fill">
              <EmailColorField
                :model-value="selected.backgroundColor"
                @update:model-value="patch('backgroundColor', $event)"
              />
            </UFormField>
            <UFormField label="Label color">
              <EmailColorField
                :model-value="selected.color"
                @update:model-value="patch('color', $event)"
              />
            </UFormField>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Corner radius (px)">
              <UInputNumber
                :model-value="selected.radius ?? 6"
                :min="0"
                class="w-full"
                @update:model-value="patchNumber('radius', $event, selected.radius ?? 6)"
              />
            </UFormField>
            <UFormField label="Font size (px)">
              <UInputNumber
                :model-value="selected.fontSize ?? 15"
                :min="8"
                class="w-full"
                @update:model-value="patchNumber('fontSize', $event, selected.fontSize ?? 15)"
              />
            </UFormField>
          </div>
          <UFormField label="Shadow" help="CSS box-shadow; Outlook leaves it out.">
            <UFieldGroup class="w-full">
              <UInput :model-value="selected.shadow ?? ''" placeholder="None" class="min-w-0 flex-1 font-mono text-xs" @update:model-value="patch('shadow', String($event).trim() || undefined)" />
              <UDropdownMenu :items="shadowItems('shadow')">
                <UButton icon="i-lucide-chevron-down" color="neutral" variant="outline" aria-label="Shadow presets" />
              </UDropdownMenu>
            </UFieldGroup>
          </UFormField>
        </template>

        <!-- Image -->
        <template v-else-if="selected.type === 'image'">
          <UFormField label="Image URL" :help="upload ? 'Paste a hosted image URL, or upload one.' : 'Paste a hosted image URL.'">
            <div class="flex gap-2">
              <UInput
                :model-value="selected.src"
                type="url"
                placeholder="https://"
                icon="i-lucide-image"
                class="min-w-0 flex-1"
                @update:model-value="patch('src', $event)"
              />
              <UButton
                v-if="upload"
                icon="i-lucide-upload"
                label="Upload"
                color="neutral"
                variant="soft"
                :loading="uploading"
                @click="pickImage()"
              />
            </div>
            <p v-if="uploadError" class="mt-1 text-xs text-error">
              {{ uploadError }}
            </p>
          </UFormField>
          <UFormField label="Alt text" help="Read aloud by screen readers and shown when images are off.">
            <UInput
              :model-value="selected.alt"
              class="w-full"
              @update:model-value="patch('alt', $event)"
            />
          </UFormField>
          <UFormField label="Link (optional)">
            <UInput
              :model-value="selected.href ?? ''"
              type="url"
              placeholder="https://"
              icon="i-lucide-link"
              class="w-full"
              @update:model-value="patch('href', $event)"
            />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Width (px)" help="0 fills the width.">
              <UInputNumber
                :model-value="selected.width ?? 0"
                :min="0"
                class="w-full"
                @update:model-value="patchNumber('width', $event, selected.width ?? 0)"
              />
            </UFormField>
            <UFormField label="Height (px)" help="With no width: a badge.">
              <UInputNumber
                :model-value="selected.height ?? 0"
                :min="0"
                class="w-full"
                @update:model-value="patch('height', coerceNumberLike($event, 0) || undefined)"
              />
            </UFormField>
          </div>
        </template>

        <!-- Divider -->
        <template v-else-if="selected.type === 'divider'">
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Color">
              <EmailColorField
                :model-value="selected.color ?? '#e4e4e7'"
                @update:model-value="patch('color', $event)"
              />
            </UFormField>
            <UFormField label="Thickness (px)">
              <UInputNumber
                :model-value="selected.thickness ?? 1"
                :min="1"
                class="w-full"
                @update:model-value="patchNumber('thickness', $event, selected.thickness ?? 1)"
              />
            </UFormField>
          </div>
        </template>

        <!-- Spacer -->
        <template v-else-if="selected.type === 'spacer'">
          <UFormField label="Height (px)">
            <UInputNumber
              :model-value="selected.height"
              :min="0"
              class="w-full"
              @update:model-value="patchNumber('height', $event, selected.height)"
            />
          </UFormField>
        </template>

        <!-- Section -->
        <template v-else-if="selected.type === 'section'">
          <p class="text-xs text-muted">
            Blocks on one surface: a card, a coloured band, a callout. Its background is set below; padding sits inside it.
          </p>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Gradient to">
              <EmailColorField
                :model-value="selected.gradientTo"
                clearable
                placeholder="None"
                @update:model-value="patch('gradientTo', $event)"
              />
            </UFormField>
            <UFormField label="Angle (°)">
              <UInputNumber
                :model-value="selected.gradientAngle ?? 180"
                :disabled="!selected.gradientTo"
                class="w-full"
                @update:model-value="patchNumber('gradientAngle', $event, selected.gradientAngle ?? 180)"
              />
            </UFormField>
            <UFormField label="Corner radius (px)">
              <UInputNumber
                :model-value="selected.radius ?? 0"
                :min="0"
                class="w-full"
                @update:model-value="patch('radius', coerceNumberLike($event, 0) || undefined)"
              />
            </UFormField>
          </div>
          <UFormField label="Shadow" help="CSS box-shadow; Outlook leaves it out.">
            <UFieldGroup class="w-full">
              <UInput :model-value="selected.shadow ?? ''" placeholder="None" class="min-w-0 flex-1 font-mono text-xs" @update:model-value="patch('shadow', String($event).trim() || undefined)" />
              <UDropdownMenu :items="shadowItems('shadow')">
                <UButton icon="i-lucide-chevron-down" color="neutral" variant="outline" aria-label="Shadow presets" />
              </UDropdownMenu>
            </UFieldGroup>
          </UFormField>
        </template>

        <!-- Columns -->
        <template v-else-if="selected.type === 'columns'">
          <UFormField label="Gap (px)">
            <UInputNumber
              :model-value="selected.gap ?? 16"
              :min="0"
              class="w-full"
              @update:model-value="patchNumber('gap', $event, selected.gap ?? 16)"
            />
          </UFormField>
        </template>

        <!-- Component -->
        <template v-else-if="component">
          <p class="text-xs text-muted">
            A copy of “{{ component.name }}” from the component library. What you change here stays in this email.
          </p>
          <UAlert
            v-if="outdated"
            icon="i-lucide-refresh-cw"
            color="primary"
            variant="soft"
            title="The library has a newer version"
            :actions="[{ label: 'Update', color: 'primary', variant: 'solid', size: 'xs', onClick: updateFromLibrary }]"
          />
          <p v-if="!component.fields.length" class="text-xs text-muted">
            It has no fields. Edit the component to add some, or detach it to edit its HTML here.
          </p>
          <div v-for="g in fieldGroups" :key="g.group" class="space-y-3">
            <p class="text-xs font-medium text-highlighted">{{ g.label }}</p>
            <UFormField v-for="f in g.fields" :key="f.key" :label="f.label">
              <EmailColorField
                v-if="f.type === 'color'"
                :model-value="componentValue(f, component.values) || undefined"
                clearable
                :placeholder="f.default || 'None'"
                @update:model-value="patchValue(f, $event)"
              />
              <UInputNumber
                v-else-if="f.type === 'number'"
                :model-value="Number(componentValue(f, component.values)) || 0"
                class="w-full"
                @update:model-value="patchValue(f, $event)"
              />
              <UTextarea
                v-else-if="f.type === 'richtext'"
                :model-value="componentValue(f, component.values)"
                :rows="3"
                autoresize
                class="w-full"
                @update:model-value="patchValue(f, $event)"
              />
              <div v-else class="flex gap-2">
                <UInput
                  :model-value="componentValue(f, component.values)"
                  :type="f.type === 'url' || f.type === 'image' ? 'url' : 'text'"
                  :icon="f.type === 'url' ? 'i-lucide-link' : f.type === 'image' ? 'i-lucide-image' : undefined"
                  class="min-w-0 flex-1"
                  @update:model-value="patchValue(f, $event)"
                />
                <UButton v-if="f.type === 'image' && upload" icon="i-lucide-upload" color="neutral" variant="soft" :loading="uploading && uploadField === f.key" aria-label="Upload an image" @click="pickImage(f.key)" />
              </div>
            </UFormField>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton v-if="canSaveComponents" icon="i-lucide-pencil" label="Edit component" size="xs" color="neutral" variant="outline" @click="emit('edit-component', component)" />
            <UButton icon="i-lucide-rotate-ccw" label="Reset" size="xs" color="neutral" variant="ghost" @click="resetValues" />
            <UButton icon="i-lucide-unlink" label="Detach to HTML" size="xs" color="neutral" variant="ghost" @click="detach" />
          </div>
        </template>

        <!-- HTML -->
        <template v-else-if="selected.type === 'html'">
          <UFormField
            label="Raw HTML"
            help="Keep it email-safe (tables + inline styles)."
          >
            <UTextarea
              :model-value="selected.html"
              :rows="8"
              autoresize
              :maxrows="24"
              class="w-full"
              :ui="{ base: 'font-mono text-xs' }"
              @update:model-value="patch('html', $event)"
            />
          </UFormField>
        </template>

        <!-- A section's or a columns block's own blocks -->
        <template v-if="selected.type === 'section' || selected.type === 'columns'">
          <div v-for="(list, c) in selected.type === 'columns' ? selected.columns : [selected.blocks]" :key="c" class="space-y-1">
            <div class="flex items-center justify-between">
              <p class="text-xs font-medium text-highlighted">{{ selected.type === 'columns' ? `Column ${c + 1}` : 'Blocks' }}</p>
              <UDropdownMenu :items="childItems(c)">
                <UButton icon="i-lucide-plus" label="Add" size="xs" color="neutral" variant="ghost" />
              </UDropdownMenu>
            </div>
            <p v-if="!list.length" class="rounded-md border border-dashed border-default px-3 py-2 text-xs text-muted">Empty</p>
            <UButton
              v-for="child in list"
              :key="child.id"
              :icon="EMAIL_BLOCK_META[child.type]?.icon"
              :label="emailBlockLabel(child)"
              color="neutral"
              variant="ghost"
              size="xs"
              block
              class="justify-start"
              @click="emit('select', child.id)"
            />
          </div>
        </template>

        <USeparator v-if="selected.type !== 'spacer'" />

        <!-- Shared: alignment + padding + background (where applicable) -->
        <UFormField v-if="'align' in selected" label="Alignment">
          <UFieldGroup class="w-full">
            <UButton
              v-for="a in alignItems"
              :key="a.value"
              :icon="a.icon"
              :aria-label="`Align ${a.label.toLowerCase()}`"
              :color="(selected as { align: Align }).align === a.value ? 'primary' : 'neutral'"
              :variant="(selected as { align: Align }).align === a.value ? 'soft' : 'outline'"
              class="flex-1 justify-center"
              @click="patch('align', a.value)"
            />
          </UFieldGroup>
        </UFormField>

        <template v-if="selected.type !== 'spacer'">
          <UFormField label="Padding (px)">
            <div class="space-y-2">
              <UFieldGroup class="w-full">
                <UInputNumber
                  :model-value="getUniformPaddingValue(selected.padding) ?? undefined"
                  :min="0"
                  :placeholder="hasIndividualPadding ? 'Mixed' : undefined"
                  class="min-w-0 flex-1"
                  @update:model-value="patchPadding($event)"
                />

                <UPopover v-model:open="paddingPopoverOpen">
                  <UButton
                    icon="i-lucide-sliders-horizontal"
                    color="neutral"
                    variant="outline"
                    aria-label="Edit individual padding"
                  />

                  <template #content>
                    <div class="grid w-72 grid-cols-2 gap-3 p-4">
                      <UFormField
                        v-for="item in paddingItems"
                        :key="item.side"
                        :label="item.label"
                      >
                        <UInputNumber
                          :model-value="getPaddingSides(selected.padding)[item.side]"
                          :min="0"
                          class="w-full"
                          @update:model-value="patchPaddingSide(item.side, $event)"
                        />
                      </UFormField>
                    </div>
                  </template>
                </UPopover>
              </UFieldGroup>

              <p
                v-if="hasIndividualPadding"
                class="text-xs text-muted"
              >
                {{ paddingSummary }}
              </p>
            </div>
          </UFormField>

          <UFormField label="Background">
            <EmailColorField
              :model-value="selected.background"
              clearable
              placeholder="None"
              @update:model-value="patch('background', $event)"
            />
          </UFormField>
        </template>
      </div>
    </template>

    <!-- Document settings (nothing selected) -->
    <template v-else>
      <div class="flex h-11 shrink-0 items-center gap-2 border-b border-default px-4">
        <UIcon
          name="i-lucide-settings-2"
          class="size-4 text-primary"
        />
        <span class="text-sm font-semibold text-highlighted">Email settings</span>
      </div>
      <div class="flex-1 space-y-4 overflow-y-auto p-4">
        <UFormField label="Subject / title">
          <UInput
            :model-value="document.settings.title"
            class="w-full"
            @update:model-value="patchSettings('title', $event)"
          />
        </UFormField>
        <UFormField
          label="Preheader"
          help="Hidden inbox preview text."
        >
          <UInput
            :model-value="document.settings.preheader"
            class="w-full"
            @update:model-value="patchSettings('preheader', $event)"
          />
        </UFormField>
        <UFormField
          label="Plain-text version"
          help="Sent alongside the HTML for clients that show text. Leave blank to generate it from the design."
        >
          <UTextarea
            :model-value="document.settings.text || ''"
            :rows="3"
            autoresize
            :maxrows="12"
            placeholder="Generated from the design"
            class="w-full font-mono text-xs"
            @update:model-value="patchSettings('text', $event)"
          />
        </UFormField>
        <UFormField label="Content width (px)">
          <UInputNumber
            :model-value="document.settings.contentWidth"
            :min="320"
            :max="900"
            class="w-full"
            @update:model-value="patchSettingNumber('contentWidth', $event, document.settings.contentWidth)"
          />
        </UFormField>

        <USeparator />

        <!-- Theme designer -->
        <div class="space-y-3">
          <div>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-palette" class="size-4 text-primary" />
              <span class="text-sm font-semibold text-highlighted">Theme</span>
            </div>
            <p class="mt-1 text-xs text-muted">
              Restyles colors, font and corners across the whole email — the layout stays put. You can also just ask the AI ("make it feel like autumn").
            </p>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <UButton
              v-for="p in THEME_PRESETS"
              :key="p.id"
              color="neutral"
              variant="outline"
              class="flex-col items-start gap-1.5 rounded-lg p-2"
              @click="applyPreset(p.id)"
            >
              <span class="flex gap-1">
                <span
                  v-for="c in [p.theme.brand, p.theme.background, p.theme.heading]"
                  :key="c"
                  class="size-4 rounded-full ring-1 ring-black/10 ring-inset"
                  :style="{ backgroundColor: c }"
                />
              </span>
              <span class="text-xs font-medium">{{ p.name }}</span>
            </UButton>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UFormField v-for="t in themeTokens" :key="t.key" :label="t.label">
              <EmailColorField
                :model-value="String(theme[t.key])"
                @update:model-value="$event && patchTheme({ [t.key]: $event })"
              />
            </UFormField>
          </div>
          <UFormField label="Font">
            <USelect
              :model-value="theme.fontFamily"
              :items="fontItems"
              class="w-full"
              @update:model-value="patchTheme({ fontFamily: String($event) })"
            />
          </UFormField>
          <UFormField label="Button corner radius (px)">
            <UInputNumber
              :model-value="theme.radius"
              :min="0"
              class="w-full"
              @update:model-value="patchTheme({ radius: coerceNumberLike($event, theme.radius) })"
            />
          </UFormField>
        </div>

        <UAlert
          icon="i-lucide-mouse-pointer-click"
          color="neutral"
          variant="soft"
          title="Tip"
          description="Click any block in the preview or under Layers to edit it here. Drag the handle to reorder."
        />
      </div>
    </template>
  </div>
</template>
