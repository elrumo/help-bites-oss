<script setup lang="ts">
/**
 * Create or edit a library component: email HTML with a `{{@key}}` wherever
 * an email gets its own value, and a row per field (label, type, content or
 * style, default). The fields follow the HTML as you type it; the preview
 * shows the component with its defaults. "Let the AI do it" hands the job to
 * the designer, which writes the fields itself.
 */
import { COMPONENT_FIELD_TYPES, DEFAULT_SETTINGS, type EmailComponentField, type EmailDocument } from '#shared/email/blocks'
import { componentInstance, fieldLabel, normalizeComponentFields, normalizeComponentInput, slotKeys, type EmailComponentDef } from '#shared/email/components'
import EmailCardPreview from '~/components/email/EmailCardPreview.vue'
import EmailColorField from '~/components/email/EmailColorField.vue'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  /** The library component being edited; none to create one. */
  component?: EmailComponentDef | null
  /** A new component's starting point (Save as component). */
  prefill?: { name?: string, description?: string, html?: string } | null
  /** The project a new component belongs to unless shared; null for masters (always shared). */
  projectId?: string | null
  /** Offers "Let the AI do it". */
  canAskAi?: boolean
}>()

const emit = defineEmits<{
  (e: 'saved', component: EmailComponentDef): void
  (e: 'ask-ai'): void
}>()

const { api } = useAgent()

const name = ref('')
const description = ref('')
const html = ref('')
const shared = ref(false)
/** Every field ever described in this session, by key, so deleting and retyping a slot keeps its settings. */
const known = ref<Record<string, EmailComponentField>>({})
const saving = ref(false)
const error = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  const c = props.component
  name.value = c?.name ?? props.prefill?.name ?? ''
  description.value = c?.description ?? props.prefill?.description ?? ''
  html.value = c?.html ?? props.prefill?.html ?? ''
  shared.value = c ? !c.projectId : !props.projectId
  known.value = Object.fromEntries((c?.fields ?? []).map(f => [f.key, { ...f }]))
  error.value = ''
}, { immediate: true })

const fields = computed(() => normalizeComponentFields(html.value, slotKeys(html.value).map(key => known.value[key] ?? { key })))

function setField(key: string, patch: Partial<EmailComponentField>) {
  const current = fields.value.find(f => f.key === key) ?? { key, label: fieldLabel(key), type: 'text', group: 'content', default: '' }
  const next = { ...current, ...patch }
  // A colour or a number is style unless told otherwise.
  if (patch.type && !('group' in patch)) next.group = patch.type === 'color' || patch.type === 'number' ? 'style' : 'content'
  known.value = { ...known.value, [key]: next }
}

const typeItems = COMPONENT_FIELD_TYPES.map(t => ({ label: { text: 'Text', richtext: 'Rich text', url: 'Link', image: 'Image', color: 'Colour', number: 'Number' }[t], value: t }))
const groupItems = [{ label: 'Content', value: 'content' }, { label: 'Style', value: 'style' }]

const preview = computed<EmailDocument>(() => ({
  settings: { ...DEFAULT_SETTINGS, title: name.value || 'Component' },
  blocks: html.value.trim() ? [{ id: 'preview', ...componentInstance({ id: 'preview', name: name.value, html: html.value, fields: fields.value }) }] : []
}))

async function save() {
  const input = { name: name.value, description: description.value, html: html.value, fields: fields.value }
  const checked = normalizeComponentInput(input)
  if (!checked.ok) {
    error.value = checked.error
    return
  }
  saving.value = true
  error.value = ''
  try {
    // A master's components are always shared; a project's are its own unless shared.
    const project = props.projectId && !shared.value ? props.projectId : null
    const res = props.component
      ? await api<{ component: EmailComponentDef }>(`/admin/email-components/${props.component.id}`, { method: 'PATCH', body: { ...checked.value, project } })
      : await api<{ component: EmailComponentDef }>('/admin/email-components', { method: 'POST', body: { ...checked.value, project } })
    emit('saved', res.component)
    open.value = false
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'Could not save the component'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="component ? 'Edit component' : 'New component'"
    description="Email HTML you can reuse. Mark the parts each email changes with {{@name}}."
    :ui="{ content: 'sm:max-w-4xl' }"
  >
    <template #body>
      <form class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" @submit.prevent="save">
        <div class="min-w-0 space-y-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Name" required>
              <UInput v-model="name" placeholder="Brand header" class="w-full" />
            </UFormField>
            <UFormField v-if="projectId" label="Projects">
              <USwitch v-model="shared" label="Use in every project" class="pt-1.5" />
            </UFormField>
          </div>
          <UFormField label="When to use it" help="The AI designer reads this to pick the component.">
            <UInput v-model="description" placeholder="The logo row at the top of every email" class="w-full" />
          </UFormField>
          <UFormField label="HTML" help="One element (a <table>), inline styles. A field is {{@key}}: href=&quot;{{@link}}&quot;, color:{{@tint}}, {{@title}}.">
            <UTextarea v-model="html" :rows="10" autoresize :maxrows="22" class="w-full" :ui="{ base: 'font-mono text-xs' }" placeholder="<table role=&quot;presentation&quot; width=&quot;100%&quot;>…</table>" />
          </UFormField>

          <div v-if="fields.length" class="space-y-2">
            <p class="text-xs font-medium text-highlighted">Fields</p>
            <div v-for="f in fields" :key="f.key" class="grid grid-cols-[6rem_minmax(0,1fr)_6.5rem_6rem] items-center gap-2">
              <code class="truncate text-xs text-muted" :title="f.key">{{ f.key }}</code>
              <UInput :model-value="f.label" size="sm" placeholder="Label" @update:model-value="setField(f.key, { label: String($event) })" />
              <USelect :model-value="f.type" :items="typeItems" value-key="value" size="sm" @update:model-value="setField(f.key, { type: $event as EmailComponentField['type'] })" />
              <USelect :model-value="f.group" :items="groupItems" value-key="value" size="sm" @update:model-value="setField(f.key, { group: $event as EmailComponentField['group'] })" />
              <div class="col-span-4 ps-[6.5rem]">
                <EmailColorField v-if="f.type === 'color'" :model-value="f.default || undefined" clearable placeholder="Default" @update:model-value="setField(f.key, { default: $event ?? '' })" />
                <UInput v-else :model-value="f.default" size="sm" placeholder="Default value" class="w-full" @update:model-value="setField(f.key, { default: String($event) })" />
              </div>
            </div>
          </div>
          <p v-else-if="html.trim()" class="text-xs text-muted">
            No fields yet: every email shows this HTML as it is. Add <code v-pre>{{@name}}</code> where an email should get its own value.
          </p>
        </div>

        <div class="min-w-0 space-y-2">
          <p class="text-xs font-medium text-highlighted">Preview, with the defaults</p>
          <div class="max-h-[28rem] overflow-auto rounded-lg border border-default bg-elevated/40">
            <EmailCardPreview v-if="preview.blocks.length" :document="preview" />
            <p v-else class="px-4 py-10 text-center text-xs text-muted">Paste some HTML to see it here.</p>
          </div>
        </div>

        <p v-if="error" class="text-sm text-error lg:col-span-2">{{ error }}</p>
        <div class="flex flex-wrap items-center justify-end gap-2 lg:col-span-2">
          <UButton v-if="canAskAi" icon="i-lucide-sparkles" label="Let the AI do it" color="neutral" variant="ghost" class="me-auto" @click="emit('ask-ai'); open = false" />
          <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
          <UButton type="submit" :loading="saving">{{ component ? 'Save' : 'Save to library' }}</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
