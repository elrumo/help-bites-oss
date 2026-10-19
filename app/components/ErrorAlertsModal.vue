<template>
  <UModal v-model:open="open" :title="$t('errors.alerts.title')" :description="$t('errors.alerts.description')">
    <template #body>
      <div class="space-y-4">
        <USkeleton v-if="loading" class="h-24 w-full" />
        <template v-else>
          <UFormField :label="$t('errors.alerts.sendTo')" :help="notifyEmails.length ? $t('errors.alerts.sendToNotify', { emails: notifyEmails.join(', ') }) : $t('errors.alerts.sendToNone')">
            <UInput v-model="emails" placeholder="oncall@example.com, dev@example.com" class="w-full" />
          </UFormField>
          <p v-if="!rules.length" class="text-sm text-muted">{{ $t('errors.alerts.noRules') }}</p>
          <section v-for="(rule, index) in rules" :key="rule.id" class="space-y-3 rounded-lg border border-default p-3" :class="rule.enabled ? '' : 'opacity-60'">
            <div class="flex items-center gap-2">
              <UInput v-model="rule.name" :placeholder="describeRule(rule)" class="min-w-0 flex-1" :aria-label="$t('errors.alerts.ruleName', { number: index + 1 })" />
              <USwitch v-model="rule.enabled" :aria-label="$t('errors.alerts.ruleEnabled', { number: index + 1 })" />
              <UButton color="error" variant="ghost" size="xs" icon="i-lucide-trash-2" :aria-label="$t('errors.alerts.deleteRule', { number: index + 1 })" @click="rules.splice(index, 1)" />
            </div>
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class="text-muted">{{ $t('errors.alerts.when') }}</span>
              <USelect v-model="rule.kind" :items="kinds" class="w-48" />
              <template v-if="rule.kind !== 'new'">
                <UInput v-model.number="rule.threshold" type="number" :min="1" class="w-24" :aria-label="$t('errors.alerts.eventsAria')" />
                <span class="text-muted">{{ $t('errors.alerts.events', rule.threshold) }}</span>
              </template>
              <template v-if="rule.kind === 'rate'">
                <span class="text-muted">{{ $t('errors.alerts.within') }}</span>
                <UInput v-model.number="rule.windowMinutes" type="number" :min="1" class="w-24" :aria-label="$t('errors.alerts.windowAria')" />
                <span class="text-muted">{{ $t('errors.alerts.windowUnit') }}</span>
              </template>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class="text-muted">{{ $t('errors.alerts.thenWait') }}</span>
              <UInput v-model.number="rule.cooldownMinutes" type="number" :min="1" class="w-24" :aria-label="$t('errors.alerts.cooldownAria')" />
              <span class="text-muted">{{ $t('errors.alerts.cooldownHint') }}</span>
            </div>
            <div v-if="links.length > 1" class="flex items-center gap-2 text-sm">
              <span class="text-muted">{{ $t('errors.alerts.forLabel') }}</span>
              <USelect v-model="rule.link" :items="linkItems" class="w-56" />
            </div>
          </section>
          <UButton color="neutral" variant="soft" icon="i-lucide-plus" :label="$t('errors.alerts.addRule')" :disabled="rules.length >= 20" @click="add" />
          <section v-if="recent.length" class="space-y-1.5">
            <p class="text-sm font-medium text-highlighted">{{ $t('errors.alerts.recent') }}</p>
            <ul class="max-h-40 space-y-1 overflow-y-auto text-xs">
              <li v-for="(alert, index) in recent" :key="index" class="flex gap-2"><span class="w-32 shrink-0 text-muted">{{ new Date(alert.at).toLocaleString() }}</span><span class="min-w-0 truncate"><span class="text-highlighted">{{ alert.title }}</span> <span class="text-muted">· {{ alert.rule }} · {{ $t('errors.eventCount', alert.count) }}</span></span></li>
            </ul>
          </section>
        </template>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="open = false" />
          <UButton :label="$t('workspaceSettings.save')" :loading="saving" :disabled="loading" @click="save" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { describeRule, DEFAULT_COOLDOWN, type ErrorAlertRule } from '#shared/errorAlerts'
import type { FiredAlert } from '~~/server/utils/errorAlerts'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ projectId: string, links: Array<{ id: string, label: string }> }>()
const { api } = useAgent()
const { t } = useI18n()

const kinds = computed(() => [{ label: t('errors.alerts.kindNew'), value: 'new' }, { label: t('errors.alerts.kindTotal'), value: 'total' }, { label: t('errors.alerts.kindRate'), value: 'rate' }])
const linkItems = computed(() => [{ label: t('errors.alerts.allTrackerProjects'), value: '' }, ...props.links.map(link => ({ label: link.label, value: link.id }))])
const rules = ref<ErrorAlertRule[]>([])
const emails = ref('')
const notifyEmails = ref<string[]>([])
const recent = ref<FiredAlert[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')

watch(open, async (isOpen) => {
  if (!isOpen) return
  loading.value = true
  error.value = ''
  try {
    const result = await api<{ rules: ErrorAlertRule[], emails: string[], notifyEmails: string[], recent: FiredAlert[] }>('/admin/errors/alerts', { query: { project: props.projectId } })
    rules.value = result.rules
    emails.value = result.emails.join(', ')
    notifyEmails.value = result.notifyEmails
    recent.value = result.recent
  } catch (cause: any) { error.value = cause.message || t('errors.alerts.loadFailed') } finally { loading.value = false }
}, { immediate: true })

function add() {
  rules.value.push({ id: `r${Date.now().toString(36)}`, name: '', kind: 'rate', threshold: 10, windowMinutes: 60, cooldownMinutes: DEFAULT_COOLDOWN.rate, link: '', enabled: true })
}

// Switching kind keeps the cooldown people would expect for it unless they changed it.
watch(() => rules.value.map(rule => rule.kind), (now, before) => {
  now.forEach((kind, index) => { if (before?.[index] && before[index] !== kind && rules.value[index]!.cooldownMinutes === DEFAULT_COOLDOWN[before[index] as ErrorAlertRule['kind']]) rules.value[index]!.cooldownMinutes = DEFAULT_COOLDOWN[kind] })
})

async function save() {
  saving.value = true
  error.value = ''
  try {
    await api('/admin/errors/alerts', { method: 'PUT', body: { project: props.projectId, rules: rules.value, emails: emails.value.split(/[,\s]+/).filter(Boolean) } })
    open.value = false
  } catch (cause: any) { error.value = cause.message || t('errors.alerts.saveFailed') } finally { saving.value = false }
}
</script>
