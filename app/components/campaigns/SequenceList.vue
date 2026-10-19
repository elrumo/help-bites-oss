<script setup lang="ts">
/**
 * Automated sequences: emails that go out on their own — a welcome series
 * when someone subscribes, onboarding when your app reports `trial_started`.
 * Each step waits a while after the one before.
 */
import type { Sequence, SequenceStep, SequenceTrigger } from '#shared/marketing'
import type { AdminProject } from '~~/server/utils/projects'
import type { EmailTemplate } from '~~/server/utils/emails'
import CampaignsTabs from '~/components/campaigns/CampaignsTabs.vue'

const props = defineProps<{ project: AdminProject }>()

const { api } = useAgent()
const toast = useToast()

const sequences = ref<Sequence[]>([])
const templates = ref<EmailTemplate[]>([])
const loading = ref(true)

async function load() {
  try {
    sequences.value = (await api<{ sequences: Sequence[] }>('/sequences', { query: { project: props.project.id } })).sequences
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not load sequences', color: 'error' })
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  load()
  api<{ templates: EmailTemplate[] }>('/admin/emails', { query: { project: props.project.id } }).then(r => { templates.value = r.templates }).catch(() => {})
})

// Delays edited in the unit that reads best.
const UNITS = [{ label: 'minutes', value: 1 }, { label: 'hours', value: 60 }, { label: 'days', value: 1440 }]
type EditStep = SequenceStep & { amount: number, unit: number }
const toEdit = (s: SequenceStep): EditStep => {
  const unit = s.delayMinutes && s.delayMinutes % 1440 === 0 ? 1440 : s.delayMinutes && s.delayMinutes % 60 === 0 ? 60 : 1
  return { ...s, amount: s.delayMinutes / unit, unit }
}

const open = ref(false)
const editing = ref<Sequence | null>(null)
const form = reactive<{ name: string, trigger: SequenceTrigger, steps: EditStep[] }>({ name: '', trigger: { type: 'subscribed' }, steps: [] })
const saving = ref(false)

function edit(s: Sequence | null) {
  editing.value = s
  form.name = s?.name || ''
  form.trigger = s ? { ...s.trigger } : { type: 'subscribed' }
  form.steps = s ? s.steps.map(toEdit) : [{ id: '', delayMinutes: 0, template: templates.value[0]?.key || '', amount: 0, unit: 1 }]
  open.value = true
}

function body() {
  return {
    project: props.project.id,
    name: form.name,
    trigger: form.trigger,
    steps: form.steps.map(s => ({ id: s.id || undefined, template: s.template, subject: s.subject || undefined, delayMinutes: Math.round(Number(s.amount || 0) * s.unit) }))
  }
}

async function save() {
  saving.value = true
  try {
    if (editing.value) await api(`/sequences/${editing.value.id}`, { method: 'PATCH', body: body() })
    else await api('/sequences', { method: 'POST', body: body() })
    open.value = false
    await load()
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not save', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function setStatus(s: Sequence, status: 'active' | 'paused') {
  try {
    const res = await api<{ sequence: Sequence }>(`/sequences/${s.id}`, { method: 'PATCH', body: { project: props.project.id, status } })
    Object.assign(s, res.sequence)
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not change it', color: 'error' })
  }
}

async function remove(s: Sequence) {
  if (!window.confirm(`Delete "${s.name}"? Everyone on it stops getting its emails.`)) return
  try {
    await api(`/sequences/${s.id}`, { method: 'DELETE', query: { project: props.project.id } })
    sequences.value = sequences.value.filter(x => x.id !== s.id)
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not delete it', color: 'error' })
  }
}

const triggerItems = [{ label: 'Someone subscribes', value: 'subscribed' }, { label: 'Your app reports an event', value: 'event' }, { label: 'I add people by hand', value: 'manual' }]
const topicItems = computed(() => props.project.marketing.topics.map(t => ({ label: t.name, value: t.key })))
const templateItems = computed(() => templates.value.map(t => ({ label: t.master?.name || t.name, value: t.key || t.id })))
const describe = (t: SequenceTrigger) => (t.type === 'subscribed' ? `On sign-up${t.topic ? ` to ${t.topic}` : ''}` : t.type === 'event' ? `On ${t.event}` : 'Manual')
const STATUS_COLOR = { draft: 'neutral', active: 'success', paused: 'warning' } as const
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project.id" title="Campaigns">
      <template #title><CampaignsTabs current="sequences" /></template>
      <template #actions><UButton icon="i-lucide-plus" label="New sequence" size="sm" @click="edit(null)" /></template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="space-y-1 p-4"><USkeleton v-for="i in 3" :key="i" class="h-14" /></div>
      <EmptyState v-else-if="!sequences.length" icon="i-lucide-workflow" title="No sequences yet" description="A welcome series for new subscribers, onboarding when a trial starts: emails that go out on their own, each a while after the last." />
      <ul v-else class="space-y-2 p-4" aria-label="Sequences">
        <li v-for="s in sequences" :key="s.id" class="flex items-center gap-3 rounded-lg border border-default p-3 text-[13px]">
          <button type="button" class="min-w-0 flex-1 text-left" @click="edit(s)">
            <p class="truncate font-medium text-highlighted">{{ s.name }}</p>
            <p class="truncate text-xs text-muted">{{ describe(s.trigger) }} · {{ s.steps.length }} email{{ s.steps.length === 1 ? '' : 's' }} · {{ s.stats.active }} on it, {{ s.stats.completed }} finished, {{ s.stats.exited }} left</p>
          </button>
          <UBadge :label="s.status" :color="STATUS_COLOR[s.status]" variant="subtle" size="sm" class="capitalize" />
          <UButton v-if="s.status !== 'active'" label="Activate" size="xs" @click="setStatus(s, 'active')" />
          <UButton v-else label="Pause" size="xs" color="neutral" variant="outline" @click="setStatus(s, 'paused')" />
          <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square aria-label="Delete sequence" @click="remove(s)" />
        </li>
      </ul>
    </div>

    <UModal v-model:open="open" :title="editing ? 'Edit sequence' : 'New sequence'" description="Every email needs an unsubscribe link and your postal address, as campaigns do." :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <form class="space-y-5 text-[13px]" @submit.prevent="save">
          <UFormField label="Name"><UInput v-model="form.name" placeholder="Welcome series" class="w-full" autofocus /></UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Starts when"><USelect v-model="form.trigger.type" :items="triggerItems" value-key="value" class="w-full" /></UFormField>
            <UFormField v-if="form.trigger.type === 'subscribed'" label="Topic"><OptionalSelect v-model="form.trigger.topic" :items="topicItems" none-label="Any topic" class="w-full" :disabled="!project.marketing.topics.length" /></UFormField>
            <UFormField v-else-if="form.trigger.type === 'event'" label="Event" hint="POST /v1/track"><UInput v-model="form.trigger.event" placeholder="trial_started" class="w-full font-mono" /></UFormField>
          </div>

          <ol class="space-y-2">
            <li v-for="(step, i) in form.steps" :key="i" class="space-y-2 rounded-lg border border-default p-3">
              <div class="flex items-center gap-2">
                <span class="w-14 shrink-0 text-xs font-medium text-muted">Email {{ i + 1 }}</span>
                <UInput v-model.number="step.amount" type="number" min="0" size="sm" class="w-20" aria-label="Wait" />
                <USelect v-model="step.unit" :items="UNITS" value-key="value" size="sm" class="w-28" aria-label="Unit" />
                <span class="text-xs text-muted">{{ i === 0 ? 'after they start' : 'after the one before' }}</span>
                <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="ml-auto" aria-label="Remove step" @click="form.steps.splice(i, 1)" />
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <USelect v-model="step.template" :items="templateItems" value-key="value" placeholder="Template" size="sm" aria-label="Template" />
                <UInput v-model="step.subject" placeholder="Subject (optional)" size="sm" aria-label="Subject" />
              </div>
            </li>
          </ol>
          <UButton icon="i-lucide-plus" label="Email" size="xs" color="neutral" variant="ghost" @click="form.steps.push({ id: '', delayMinutes: 1440, template: templates[0]?.key || '', amount: 1, unit: 1440 })" />

          <div class="flex justify-end gap-2 border-t border-default pt-4">
            <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
            <UButton type="submit" :loading="saving" :disabled="!form.name.trim() || !form.steps.length">Save</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
