<script setup lang="ts">
/**
 * How to reach one template from code: fetch it rendered (with the project's
 * brand and your variables) or send it. A project template is addressed by
 * its send key with the project secret; a master by id with an admin key.
 */
import { senderVariables } from '#shared/email/resolve'
import type { EmailTemplate } from '~~/server/utils/emails'

const props = defineProps<{ template: EmailTemplate | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ (e: 'key', key: string): void }>()

const { api } = useAgent()
const toast = useToast()
const appUrl = useAppUrl()
const { t } = useI18n()

const key = ref('')
const savedKey = ref('')
const saving = ref(false)
watch(() => props.template?.key, (k) => { key.value = savedKey.value = k || '' }, { immediate: true })

const isProject = computed(() => !!props.template?.projectId)
const variables = computed(() => props.template ? senderVariables(props.template, props.template.master) : [])
const example = computed(() => Object.fromEntries(variables.value.slice(0, 3).map(v => [v.key, v.defaultValue || '…'])))
const auth = computed(() => isProject.value ? '$HELPBITES_SECRET' : '$HELPBITES_ADMIN_KEY')
const handle = computed(() => isProject.value ? savedKey.value : props.template?.id || '')
// Literal braces can't sit inside the template's own interpolation.
const escapedExample = '{{ name }}'
const rawExample = '{{{ list }}}'

const fetchUrl = computed(() => {
  const query = new URLSearchParams({ format: 'html', ...example.value })
  return `${appUrl.value}/v1/emails/${encodeURIComponent(handle.value)}?${query}`
})
const fetchSnippet = computed(() => `curl "${fetchUrl.value}" \\\n  -H "Authorization: Bearer ${auth.value}"`)
const sendSnippet = computed(() => `curl -X POST ${appUrl.value}/v1/emails/send \\
  -H "Authorization: Bearer ${auth.value}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: <a unique id for this email>" \\
  -d '${JSON.stringify({ template: handle.value, to: 'user@example.com', variables: example.value })}'`)
const logSnippet = computed(() => `curl "${appUrl.value}/v1/email-logs?template=${encodeURIComponent(handle.value)}" \\
  -H "Authorization: Bearer ${auth.value}"`)

async function saveKey() {
  if (!props.template) return
  saving.value = true
  try {
    const { template } = await api<{ template: EmailTemplate }>(`/admin/emails/${props.template.id}`, { method: 'PATCH', body: { key: key.value } })
    key.value = savedKey.value = template.key
    emit('key', template.key)
  } catch (error: any) {
    toast.add({ title: error?.message || t('emailLibrary.api.saveKeyError'), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function copy(text: string, what: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: t('emailLibrary.common.copied', { what }), icon: 'i-lucide-clipboard-check', color: 'success' })
}
</script>

<template>
  <UModal v-model:open="open" :title="$t('emailLibrary.api.title')" :description="isProject ? $t('emailLibrary.api.descriptionProject') : $t('emailLibrary.api.descriptionMaster')" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <div v-if="template" class="space-y-6">
        <UFormField v-if="isProject" :label="$t('emailLibrary.api.sendKey')" :description="$t('emailLibrary.api.sendKeyDescription')">
          <div class="flex gap-2">
            <UInput v-model="key" class="flex-1 font-mono" :aria-label="$t('emailLibrary.api.sendKey')" @keydown.enter="saveKey" />
            <UButton :label="$t('emailLibrary.common.save')" color="neutral" variant="soft" :disabled="key === savedKey || !key.trim()" :loading="saving" @click="saveKey" />
          </div>
        </UFormField>

        <section class="space-y-2">
          <div class="flex items-center gap-2">
            <h3 class="flex-1 text-sm font-semibold">{{ $t('emailLibrary.api.fetchTitle') }}</h3>
            <UButton icon="i-lucide-link" :label="$t('emailLibrary.api.copyUrl')" size="xs" color="neutral" variant="ghost" @click="copy(fetchUrl, $t('emailLibrary.api.urlWhat'))" />
            <UButton icon="i-lucide-copy" :label="$t('emailLibrary.common.copy')" size="xs" color="neutral" variant="soft" @click="copy(fetchSnippet, $t('emailLibrary.api.requestWhat'))" />
          </div>
          <CodeBlock :code="fetchSnippet" lang="bash" />
          <i18n-t keypath="emailLibrary.api.fetchNote" tag="p" class="text-xs text-muted">
            <template #format><code class="font-mono">format=html</code></template>
            <template #json><code class="font-mono">{ subject, html, text, variables }</code></template>
          </i18n-t>
        </section>

        <section v-if="isProject" class="space-y-2">
          <div class="flex items-center gap-2">
            <h3 class="flex-1 text-sm font-semibold">{{ $t('emailLibrary.api.sendTitle') }}</h3>
            <UButton icon="i-lucide-copy" :label="$t('emailLibrary.common.copy')" size="xs" color="neutral" variant="soft" @click="copy(sendSnippet, $t('emailLibrary.api.requestWhat'))" />
          </div>
          <CodeBlock :code="sendSnippet" lang="bash" />
          <i18n-t keypath="emailLibrary.api.sendNote" tag="p" class="text-xs text-muted">
            <template #shape><code class="font-mono">{ email, name, variables }</code></template>
            <template #escaped><code class="font-mono">{{ escapedExample }}</code></template>
            <template #raw><code class="font-mono">{{ rawExample }}</code></template>
          </i18n-t>
        </section>

        <section v-if="isProject" class="space-y-2">
          <div class="flex items-center gap-2">
            <h3 class="flex-1 text-sm font-semibold">{{ $t('emailLibrary.api.logTitle') }}</h3>
            <UButton icon="i-lucide-copy" :label="$t('emailLibrary.common.copy')" size="xs" color="neutral" variant="soft" @click="copy(logSnippet, $t('emailLibrary.api.requestWhat'))" />
          </div>
          <CodeBlock :code="logSnippet" lang="bash" />
          <p class="text-xs text-muted">{{ $t('emailLibrary.api.logNote') }}</p>
        </section>

        <section v-if="variables.length" class="space-y-2">
          <h3 class="text-sm font-semibold">{{ $t('emailLibrary.api.variables') }}</h3>
          <ul class="divide-y divide-default rounded-lg border border-default text-sm">
            <li v-for="v in variables" :key="v.key" class="flex items-baseline gap-3 px-3 py-2">
              <code class="font-mono text-xs">{{ v.key }}</code>
              <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ v.label }}</span>
              <span class="truncate text-xs text-dimmed">{{ v.defaultValue ? $t('emailLibrary.api.defaultsTo', { value: v.defaultValue }) : $t('emailLibrary.api.noDefault') }}</span>
            </li>
          </ul>
        </section>

        <i18n-t keypath="emailLibrary.api.fullReference" tag="p" class="text-xs text-muted">
          <template #link><a href="/_docs/scalar" target="_blank" rel="noopener" class="underline">{{ $t('emailLibrary.api.apiDocs') }}</a></template>
        </i18n-t>
      </div>
    </template>
  </UModal>
</template>
