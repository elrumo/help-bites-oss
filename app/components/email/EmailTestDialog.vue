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
const { t } = useI18n()

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
      toast.add({ title: t('emailLibrary.test.sentTo', { to: res.results.filter(r => r.status === 'sent').map(r => r.to).join(', ') }), icon: 'i-lucide-send', color: 'success' })
      open.value = false
    } else {
      toast.add({ title: t('emailLibrary.test.notSent'), description: res.results[0]?.error, color: 'error' })
    }
  } catch (error: any) {
    toast.add({ title: error?.message || t('emailLibrary.test.error'), color: 'error' })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="$t('emailLibrary.test.title')" :description="$t('emailLibrary.test.description', { name: template?.master?.name || template?.name || $t('emailLibrary.test.thisTemplate') })">
    <template #body>
      <form class="space-y-4" @submit.prevent="send">
        <UFormField :label="$t('emailLibrary.test.to')" :hint="$t('emailLibrary.test.toHint')">
          <UInput v-model="to" type="text" placeholder="you@example.com" class="w-full" required autofocus />
        </UFormField>
        <UFormField v-if="isMaster && projects.length" :label="$t('emailLibrary.test.brandSender')" :help="$t('emailLibrary.test.brandSenderHelp')">
          <OptionalSelect v-model="projectId" :items="projectItems" :none-label="$t('emailLibrary.test.noneLabel')" value-key="value" class="w-full" />
        </UFormField>
        <div v-if="variables.length" class="space-y-2">
          <p class="text-xs font-medium text-muted">{{ $t('emailLibrary.test.values') }}</p>
          <UFormField v-for="v in variables" :key="v.key" :label="v.label || v.key" :hint="v.label ? v.key : undefined" size="sm">
            <UInput v-model="values[v.key]" class="w-full" size="sm" />
          </UFormField>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" @click="open = false">{{ $t('common.cancel') }}</UButton>
          <UButton type="submit" icon="i-lucide-send" :loading="sending" :disabled="!to.trim()">{{ $t('emailLibrary.test.send') }}</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
