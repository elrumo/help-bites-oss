<script setup lang="ts">
/**
 * Send a template to yourself before your code does: its sample values
 * prefilled, editable, "[Test]" in front of the subject. A master can borrow
 * a project's brand and sender for the test. The send is logged as a test.
 */
import { senderVariables } from '#shared/email/resolve'
import type { DeliverySummary } from '~~/server/utils/emailDelivery'
import type { EmailTemplate } from '~~/server/utils/emails'

const props = defineProps<{ template: EmailTemplate | null }>()
const open = defineModel<boolean>('open', { default: false })

const { api, agent, projects } = useAgent()
const toast = useToast()

const to = ref('')
const projectId = ref('')
const values = ref<Record<string, string>>({})
const sending = ref(false)

const variables = computed(() => (props.template ? senderVariables(props.template, props.template.master) : []))
const isMaster = computed(() => !!props.template && !props.template.projectId)
const projectItems = computed(() => projects.value.map(p => ({ label: p.name, value: p.id })))

watch(open, (isOpen) => {
  if (!isOpen || !props.template) return
  to.value = agent.value?.email || ''
  projectId.value = ''
  values.value = Object.fromEntries(variables.value.map(v => [v.key, v.defaultValue || '']))
})

async function send() {
  if (!props.template) return
  sending.value = true
  try {
    const res = await api<DeliverySummary>(`/admin/emails/${props.template.id}/test`, {
      method: 'POST',
      body: { to: to.value.split(/[\s,;]+/).filter(Boolean), variables: values.value, ...(isMaster.value && projectId.value ? { project: projectId.value } : {}) }
    })
    if (res.sent) {
      toast.add({ title: `Test sent to ${res.results.filter(r => r.status === 'sent').map(r => r.to).join(', ')}`, icon: 'i-lucide-send', color: 'success' })
      open.value = false
    } else {
      toast.add({ title: 'The test was not sent', description: res.results[0]?.error, color: 'error' })
    }
  } catch (error: any) {
    toast.add({ title: error?.message || 'Could not send the test', color: 'error' })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Send a test" :description="`${template?.master?.name || template?.name || 'This template'}, with “[Test]” in the subject. It shows up in the email log.`">
    <template #body>
      <form class="space-y-4" @submit.prevent="send">
        <UFormField label="To" hint="Up to five addresses">
          <UInput v-model="to" type="text" placeholder="you@example.com" class="w-full" required autofocus />
        </UFormField>
        <UFormField v-if="isMaster && projects.length" label="Brand and sender" help="A master has no project of its own; borrow one's logo, colours and from-address.">
          <OptionalSelect v-model="projectId" :items="projectItems" none-label="None: sample values only" value-key="value" class="w-full" />
        </UFormField>
        <div v-if="variables.length" class="space-y-2">
          <p class="text-xs font-medium text-muted">Values</p>
          <UFormField v-for="v in variables" :key="v.key" :label="v.label || v.key" :hint="v.label ? v.key : undefined" size="sm">
            <UInput v-model="values[v.key]" class="w-full" size="sm" />
          </UFormField>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
          <UButton type="submit" icon="i-lucide-send" :loading="sending" :disabled="!to.trim()">Send test</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
