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
const { t } = useI18n()

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
    toast.add({ title: t('common.saved'), color: 'success' })
  } catch (error: any) {
    toast.add({ title: error?.message || t('emailLibrary.linked.saveError'), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function detach() {
  if (!window.confirm(t('emailLibrary.linked.detachConfirm'))) return
  const res = await api<{ template: EmailTemplate }>(`/admin/emails/${props.template.id}/detach`, { method: 'POST' }).catch((e) => { toast.add({ title: e.message, color: 'error' }) })
  if (res) emit('change', res.template)
}

async function remove() {
  if (!window.confirm(t('emailLibrary.linked.removeConfirm'))) return
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
      <h3 class="text-sm font-semibold">{{ $t('emailLibrary.linked.brand') }}</h3>
      <p class="text-xs text-muted">
        <i18n-t :keypath="usesBrand ? 'emailLibrary.linked.brandUsed' : 'emailLibrary.linked.brandAvailable'" tag="span">
          <template #tokens><code class="font-mono">{{ '{' + '{project.name}' + '}' }}</code>, <code class="font-mono">{{ '{' + '{project.logoUrl}' + '}' }}</code>, <code class="font-mono">{{ '{' + '{project.url}' + '}' }}</code>, <code class="font-mono">{{ '{' + '{project.company}' + '}' }}</code>, <code class="font-mono">{{ '{' + '{project.address}' + '}' }}</code>, <code class="font-mono">{{ '{' + '{project.email}' + '}' }}</code>, <code class="font-mono">{{ '{' + '{project.privacyUrl}' + '}' }}</code>, <code class="font-mono">{{ '{' + '{project.termsUrl}' + '}' }}</code></template>
        </i18n-t>
        {{ $t('emailLibrary.linked.brandAccent') }}
      </p>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="inline-flex items-center gap-1.5 rounded-full border border-default px-2 py-1">{{ project.name }}</span>
        <span v-if="project.brandLogoUrl" class="inline-flex items-center gap-1.5 rounded-full border border-default px-2 py-1"><img :src="project.brandLogoUrl" alt="" class="size-4 rounded object-contain">{{ $t('emailLibrary.linked.logo') }}</span>
        <span v-if="project.theme?.accent" class="inline-flex items-center gap-1.5 rounded-full border border-default px-2 py-1"><span class="size-3 rounded-full" :style="{ background: project.theme.accent }" />{{ project.theme.accent }}</span>
      </div>
    </section>

    <section class="space-y-3">
      <h3 class="text-sm font-semibold">{{ $t('emailLibrary.linked.values') }}</h3>
      <p v-if="!fields.length" class="text-xs text-muted">{{ $t('emailLibrary.linked.noVariables') }}</p>
      <UFormField v-for="v in fields" :key="v.key" :label="v.label || v.key" :hint="v.label ? v.key : undefined">
        <UInput v-model="values[v.key]" :placeholder="v.defaultValue || $t('emailLibrary.linked.empty')" class="w-full" />
      </UFormField>
      <UFormField :label="$t('emailLibrary.api.sendKey')" :hint="$t('emailLibrary.linked.sendKeyHint')" :description="$t('emailLibrary.linked.sendKeyDescription')">
        <UInput v-model="key" class="w-full font-mono" />
      </UFormField>
      <div class="flex justify-end">
        <UButton :label="$t('emailLibrary.common.save')" color="primary" :disabled="!dirty" :loading="saving" @click="save" />
      </div>
    </section>

    <section class="space-y-2">
      <h3 class="text-sm font-semibold">{{ $t('emailLibrary.linked.sendIt') }}</h3>
      <p class="text-xs text-muted">{{ $t('emailLibrary.linked.sendNote') }}</p>
      <CodeBlock :code="snippet" lang="bash" />
    </section>

    <div class="flex flex-wrap gap-2 border-t border-default pt-4">
      <UButton v-if="master" :to="`/emails/${master.id}`" icon="i-lucide-pencil" :label="$t('emailLibrary.linked.editMaster')" size="sm" color="neutral" variant="soft" />
      <UButton icon="i-lucide-unlink" :label="$t('emailLibrary.linked.detach')" size="sm" color="neutral" variant="ghost" @click="detach" />
      <UButton icon="i-lucide-trash-2" :label="$t('emailLibrary.common.remove')" size="sm" color="error" variant="ghost" class="ml-auto" @click="remove" />
    </div>
  </div>
</template>
