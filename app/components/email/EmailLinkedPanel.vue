<script setup lang="ts">
/**
 * A project's link to a master: the master's design rendered with this
 * project's brand, the project's own values for the master's variables, and
 * the key the send API knows it by. Saves to the master (made in another tab)
 * show up here live.
 */
import { BRAND_VARIABLE_PREFIX, resolveTemplate } from '#shared/email/resolve'
import type { EmailTemplate } from '~~/server/utils/emails'
import type { EmailEvent } from '~~/server/utils/events'
import type { AdminProject } from '~~/server/utils/projects'
import EmailCardPreview from '~/components/email/EmailCardPreview.vue'

const props = defineProps<{ template: EmailTemplate, project: AdminProject }>()
const emit = defineEmits<{ (e: 'change', template: EmailTemplate | null, removedId?: string): void }>()

const { api, token } = useAgent()
const toast = useToast()
const appUrl = useAppUrl()

const master = ref(props.template.master)
const values = ref<Record<string, string>>({ ...props.template.variableValues })
const key = ref(props.template.key)
const saving = ref(false)

watch(() => props.template.id, () => {
  master.value = props.template.master
  values.value = { ...props.template.variableValues }
  key.value = props.template.key
})

useEventStream<EmailEvent>(computed(() => master.value ? `/v1/admin/emails/${master.value.id}/events` : null), token, (event) => {
  const t = event.template
  if (t?.document) master.value = { id: t.id, name: t.name, document: t.document, variables: t.variables, updatedAt: t.updatedAt }
})

const fields = computed(() => (master.value?.variables || []).filter(v => !v.key.startsWith(BRAND_VARIABLE_PREFIX)))
const usesBrand = computed(() => (master.value?.variables || []).some(v => v.key.startsWith(BRAND_VARIABLE_PREFIX)))
const preview = computed(() => master.value ? resolveTemplate({ ...props.template, variableValues: values.value }, { master: master.value, brand: props.project }).document : null)
const dirty = computed(() => key.value !== props.template.key || JSON.stringify(values.value) !== JSON.stringify(props.template.variableValues))

const snippet = computed(() => `curl -X POST ${appUrl.value || ''}/v1/emails/send \\
  -H "Authorization: Bearer $HELPBITES_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ template: props.template.key, to: 'user@example.com', variables: Object.fromEntries(fields.value.slice(0, 3).map(v => [v.key, v.defaultValue || '…'])) })}'`)

async function save() {
  saving.value = true
  try {
    // Blank inputs fall back to the master's default.
    const clean = Object.fromEntries(Object.entries(values.value).filter(([, v]) => v !== ''))
    const { template } = await api<{ template: EmailTemplate }>(`/admin/emails/${props.template.id}`, { method: 'PATCH', body: { key: key.value, variableValues: clean } })
    emit('change', { ...template, master: master.value })
    toast.add({ title: 'Saved', color: 'success' })
  } catch (error: any) {
    toast.add({ title: error?.message || 'Could not save', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function detach() {
  if (!window.confirm('Detach from the master? This project gets its own editable copy, and later edits to the master no longer reach it.')) return
  const res = await api<{ template: EmailTemplate }>(`/admin/emails/${props.template.id}/detach`, { method: 'POST' }).catch((e) => { toast.add({ title: e.message, color: 'error' }) })
  if (res) emit('change', res.template)
}

async function remove() {
  if (!window.confirm('Remove this master from the project? The master itself stays.')) return
  const res = await api(`/admin/emails/${props.template.id}`, { method: 'DELETE' }).catch((e) => { toast.add({ title: e.message, color: 'error' }) })
  if (res) emit('change', null, props.template.id)
}
</script>

<template>
  <div class="space-y-6">
    <div class="overflow-hidden rounded-xl border border-default bg-muted">
      <div class="h-80 overflow-y-auto overflow-x-hidden">
        <div class="origin-top-left scale-[0.82] w-[122%]">
          <EmailCardPreview v-if="preview" :document="preview" />
        </div>
      </div>
    </div>

    <section class="space-y-2">
      <h3 class="text-sm font-semibold">Brand</h3>
      <p class="text-xs text-muted">
        {{ usesBrand ? 'Filled in from this project: ' : 'This master does not use the project brand placeholders yet. Available: ' }}
        <code class="font-mono">{{ '{' + '{project.name}' + '}' }}</code>, <code class="font-mono">{{ '{' + '{project.logoUrl}' + '}' }}</code>, <code class="font-mono">{{ '{' + '{project.url}' + '}' }}</code>.
        Buttons in the master's brand colour take the project accent.
      </p>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="inline-flex items-center gap-1.5 rounded-full border border-default px-2 py-1">{{ project.name }}</span>
        <span v-if="project.brandLogoUrl" class="inline-flex items-center gap-1.5 rounded-full border border-default px-2 py-1"><img :src="project.brandLogoUrl" alt="" class="size-4 rounded object-contain">Logo</span>
        <span v-if="project.theme?.accent" class="inline-flex items-center gap-1.5 rounded-full border border-default px-2 py-1"><span class="size-3 rounded-full" :style="{ background: project.theme.accent }" />{{ project.theme.accent }}</span>
      </div>
    </section>

    <section class="space-y-3">
      <h3 class="text-sm font-semibold">Values for this project</h3>
      <p v-if="!fields.length" class="text-xs text-muted">The master has no variables of its own.</p>
      <UFormField v-for="v in fields" :key="v.key" :label="v.label || v.key" :hint="v.label ? v.key : undefined">
        <UInput v-model="values[v.key]" :placeholder="v.defaultValue || 'Empty'" class="w-full" />
      </UFormField>
      <UFormField label="Send key" hint="Unique in this project" description="What your server passes as template to POST /v1/emails/send.">
        <UInput v-model="key" class="w-full font-mono" />
      </UFormField>
      <div class="flex justify-end">
        <UButton label="Save" color="primary" :disabled="!dirty" :loading="saving" @click="save" />
      </div>
    </section>

    <section class="space-y-2">
      <h3 class="text-sm font-semibold">Send it</h3>
      <p class="text-xs text-muted">From your server, with the project secret. Your variables override the values above.</p>
      <CodeBlock :code="snippet" lang="bash" />
    </section>

    <div class="flex flex-wrap gap-2 border-t border-default pt-4">
      <UButton v-if="master" :to="`/emails/${master.id}`" icon="i-lucide-pencil" label="Edit master" size="sm" color="neutral" variant="soft" />
      <UButton icon="i-lucide-unlink" label="Detach" size="sm" color="neutral" variant="ghost" @click="detach" />
      <UButton icon="i-lucide-trash-2" label="Remove" size="sm" color="error" variant="ghost" class="ml-auto" @click="remove" />
    </div>
  </div>
</template>
