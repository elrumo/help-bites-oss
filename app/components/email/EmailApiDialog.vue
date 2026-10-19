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
    toast.add({ title: error?.message || 'Could not save the key', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function copy(text: string, what: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: `${what} copied`, icon: 'i-lucide-clipboard-check', color: 'success' })
}
</script>

<template>
  <UModal v-model:open="open" title="Use via API" :description="isProject ? 'From your server, with this project\'s secret (Project → Dev). Never from a browser.' : 'Masters are read by id with an admin API key. Projects that link this master fetch and send it by their own key.'" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <div v-if="template" class="space-y-6">
        <UFormField v-if="isProject" label="Send key" description="How your code names this email. Unique in the project.">
          <div class="flex gap-2">
            <UInput v-model="key" class="flex-1 font-mono" aria-label="Send key" @keydown.enter="saveKey" />
            <UButton label="Save" color="neutral" variant="soft" :disabled="key === savedKey || !key.trim()" :loading="saving" @click="saveKey" />
          </div>
        </UFormField>

        <section class="space-y-2">
          <div class="flex items-center gap-2">
            <h3 class="flex-1 text-sm font-semibold">Fetch it rendered</h3>
            <UButton icon="i-lucide-link" label="Copy URL" size="xs" color="neutral" variant="ghost" @click="copy(fetchUrl, 'URL')" />
            <UButton icon="i-lucide-copy" label="Copy" size="xs" color="neutral" variant="soft" @click="copy(fetchSnippet, 'Request')" />
          </div>
          <CodeBlock :code="fetchSnippet" lang="bash" />
          <p class="text-xs text-muted">Variables are query parameters. Without <code class="font-mono">format=html</code> you get JSON: <code class="font-mono">{ subject, html, text, variables }</code>, ready for any mail provider.</p>
        </section>

        <section v-if="isProject" class="space-y-2">
          <div class="flex items-center gap-2">
            <h3 class="flex-1 text-sm font-semibold">Or send it</h3>
            <UButton icon="i-lucide-copy" label="Copy" size="xs" color="neutral" variant="soft" @click="copy(sendSnippet, 'Request')" />
          </div>
          <CodeBlock :code="sendSnippet" lang="bash" />
          <p class="text-xs text-muted">Up to 50 recipients, one message each, from the project's sender. A recipient can be <code class="font-mono">{ email, name, variables }</code> for values of their own. In custom HTML, <code class="font-mono">{{ escapedExample }}</code> fills in as text and <code class="font-mono">{{ rawExample }}</code> as HTML.</p>
        </section>

        <section v-if="isProject" class="space-y-2">
          <div class="flex items-center gap-2">
            <h3 class="flex-1 text-sm font-semibold">See what was sent</h3>
            <UButton icon="i-lucide-copy" label="Copy" size="xs" color="neutral" variant="soft" @click="copy(logSnippet, 'Request')" />
          </div>
          <CodeBlock :code="logSnippet" lang="bash" />
          <p class="text-xs text-muted">Every recipient's status, kept current by Mailgun's delivery webhook. Also under Email → Log.</p>
        </section>

        <section v-if="variables.length" class="space-y-2">
          <h3 class="text-sm font-semibold">Variables</h3>
          <ul class="divide-y divide-default rounded-lg border border-default text-sm">
            <li v-for="v in variables" :key="v.key" class="flex items-baseline gap-3 px-3 py-2">
              <code class="font-mono text-xs">{{ v.key }}</code>
              <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ v.label }}</span>
              <span class="truncate text-xs text-dimmed">{{ v.defaultValue ? `defaults to “${v.defaultValue}”` : 'no default' }}</span>
            </li>
          </ul>
        </section>

        <p class="text-xs text-muted">Full reference: <a href="/_docs/scalar" target="_blank" rel="noopener" class="underline">API docs</a>.</p>
      </div>
    </template>
  </UModal>
</template>
