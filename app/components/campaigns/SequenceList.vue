<script setup lang="ts">
/**
 * Automated sequences: emails that go out on their own — a welcome series
 * when someone subscribes, onboarding when your app reports `trial_started`.
 * Each step waits a while after the one before.
 */
import type { Sequence, SequenceStep, SequenceTrigger } from '#shared/marketing'
import type { AdminProject } from '~~/server/utils/projects'
import type { EmailTemplate } from '~~/server/utils/emails'
import EmailSetupStrip from '~/components/email/EmailSetupStrip.vue'
import EmailTabs from '~/components/email/EmailTabs.vue'

const props = defineProps<{ project: AdminProject }>()

const { api } = useAgent()
const toast = useToast()
const { t } = useI18n()

const sequences = ref<Sequence[]>([])
const templates = ref<EmailTemplate[]>([])
const loading = ref(true)

async function load() {
  try {
    sequences.value = (await api<{ sequences: Sequence[] }>('/sequences', { query: { project: props.project.id } })).sequences
  } catch (e: any) {
    toast.add({ title: e?.message || t('campaigns.sequences.loadError'), color: 'error' })
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  load()
  api<{ templates: EmailTemplate[] }>('/admin/emails', { query: { project: props.project.id } }).then(r => { templates.value = r.templates }).catch(() => {})
})

// Delays edited in the unit that reads best.
const units = computed(() => [{ label: t('campaigns.sequences.units.minutes'), value: 1 }, { label: t('campaigns.sequences.units.hours'), value: 60 }, { label: t('campaigns.sequences.units.days'), value: 1440 }])
type EditStep = SequenceStep & { amount: number, unit: number }
const toEdit = (s: SequenceStep): EditStep => {
  const unit = s.delayMinutes && s.delayMinutes % 1440 === 0 ? 1440 : s.delayMinutes && s.delayMinutes % 60 === 0 ? 60 : 1
  return { ...s, amount: s.delayMinutes / unit, unit }
}

type Recipe = { id: string, name: string, description: string, trigger: SequenceTrigger, steps: { delayMinutes: number, subject: string }[] }
const recipesOpen = ref(false)
const recipes = ref<Recipe[]>([])
const installing = ref('')

async function openRecipes() {
  recipesOpen.value = true
  if (recipes.value.length) return
  try {
    recipes.value = (await api<{ recipes: Recipe[] }>('/automations/recipes', { query: { project: props.project.id } })).recipes
  } catch (e: any) {
    toast.add({ title: e?.message || t('campaigns.sequences.recipes.loadError'), color: 'error' })
  }
}

// A recipe lands as a draft: nothing is sent until the operator activates it.
async function install(recipe: Recipe) {
  installing.value = recipe.id
  try {
    await api(`/automations/recipes/${recipe.id}/install`, { method: 'POST', body: { project: props.project.id } })
    recipesOpen.value = false
    toast.add({ title: t('campaigns.sequences.recipes.installed', { name: recipe.name }), color: 'success' })
    await load()
  } catch (e: any) {
    toast.add({ title: e?.message || t('campaigns.sequences.recipes.installError'), color: 'error' })
  } finally {
    installing.value = ''
  }
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
    toast.add({ title: e?.message || t('campaigns.sequences.saveError'), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function setStatus(s: Sequence, status: 'active' | 'paused') {
  try {
    const res = await api<{ sequence: Sequence }>(`/sequences/${s.id}`, { method: 'PATCH', body: { project: props.project.id, status } })
    Object.assign(s, res.sequence)
  } catch (e: any) {
    toast.add({ title: e?.message || t('campaigns.sequences.changeError'), color: 'error' })
  }
}

async function remove(s: Sequence) {
  if (!window.confirm(t('campaigns.sequences.deleteConfirm', { name: s.name }))) return
  try {
    await api(`/sequences/${s.id}`, { method: 'DELETE', query: { project: props.project.id } })
    sequences.value = sequences.value.filter(x => x.id !== s.id)
  } catch (e: any) {
    toast.add({ title: e?.message || t('campaigns.sequences.deleteError'), color: 'error' })
  }
}

const triggerItems = computed(() => [{ label: t('campaigns.sequences.trigger.subscribed'), value: 'subscribed' }, { label: t('campaigns.sequences.trigger.event'), value: 'event' }, { label: t('campaigns.sequences.trigger.manual'), value: 'manual' }])
const topicItems = computed(() => props.project.marketing.topics.map(t => ({ label: t.name, value: t.key })))
const templateItems = computed(() => templates.value.map(t => ({ label: t.master?.name || t.name, value: t.key || t.id })))
const describe = (trigger: SequenceTrigger) => (trigger.type === 'subscribed'
  ? (trigger.topic ? t('campaigns.sequences.onSignupTopic', { topic: trigger.topic }) : t('campaigns.sequences.onSignup'))
  : trigger.type === 'event' ? t('campaigns.sequences.onEvent', { event: trigger.event }) : t('campaigns.sequences.manual'))
const STATUS_COLOR = { draft: 'neutral', active: 'success', paused: 'warning' } as const
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project.id" :title="$t('nav.email')">
      <template #title><EmailTabs current="sequences" /></template>
      <template #actions>
        <UButton icon="i-lucide-wand-sparkles" :label="$t('campaigns.sequences.recipes.button')" size="sm" color="neutral" variant="outline" @click="openRecipes" />
        <UButton icon="i-lucide-plus" :label="$t('campaigns.sequences.new')" size="sm" @click="edit(null)" />
      </template>
    </PageHeader>
    <EmailSetupStrip :project-id="project.id" scope="bulk" />
    <PlanLock feature="sequences" />

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="space-y-1 p-4"><USkeleton v-for="i in 3" :key="i" class="h-14" /></div>
      <EmptyState v-else-if="!sequences.length" icon="i-lucide-workflow" :title="$t('campaigns.sequences.emptyTitle')" :description="$t('campaigns.sequences.emptyDescription')" />
      <ul v-else class="space-y-2 p-4" :aria-label="$t('campaigns.sequences.listLabel')">
        <li v-for="s in sequences" :key="s.id" class="flex items-center gap-3 rounded-lg border border-default p-3 text-[13px]">
          <button type="button" class="min-w-0 flex-1 text-left" @click="edit(s)">
            <p class="truncate font-medium text-highlighted">{{ s.name }}</p>
            <p class="truncate text-xs text-muted">{{ describe(s.trigger) }} · {{ $t('campaigns.sequences.emailCount', s.steps.length) }} · {{ $t('campaigns.sequences.stats', { active: s.stats.active, completed: s.stats.completed, exited: s.stats.exited }) }}</p>
          </button>
          <UBadge :label="$t(`campaigns.sequences.status.${s.status}`)" :color="STATUS_COLOR[s.status]" variant="subtle" size="sm" class="capitalize" />
          <UButton v-if="s.status !== 'active'" :label="$t('campaigns.sequences.activate')" size="xs" @click="setStatus(s, 'active')" />
          <UButton v-else :label="$t('campaigns.sequences.pause')" size="xs" color="neutral" variant="outline" @click="setStatus(s, 'paused')" />
          <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="$t('campaigns.sequences.deleteLabel')" @click="remove(s)" />
        </li>
      </ul>
    </div>

    <UModal v-model:open="recipesOpen" :title="$t('campaigns.sequences.recipes.title')" :description="$t('campaigns.sequences.recipes.description')" :ui="{ content: 'max-w-xl' }">
      <template #body>
        <ul class="space-y-2 text-[13px]">
          <li v-for="recipe in recipes" :key="recipe.id" class="flex items-start gap-3 rounded-lg border border-default p-3">
            <div class="min-w-0 flex-1">
              <p class="font-medium text-highlighted">{{ recipe.name }}</p>
              <p class="text-xs text-muted">{{ recipe.description }}</p>
              <p class="mt-1 text-xs text-dimmed">{{ describe(recipe.trigger) }} · {{ $t('campaigns.sequences.emailCount', recipe.steps.length) }}</p>
            </div>
            <UButton :label="$t('campaigns.sequences.recipes.use')" size="xs" :loading="installing === recipe.id" :disabled="!!installing" @click="install(recipe)" />
          </li>
        </ul>
      </template>
    </UModal>

    <UModal v-model:open="open" :title="editing ? $t('campaigns.sequences.edit') : $t('campaigns.sequences.new')" :description="$t('campaigns.sequences.formDescription')" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <form class="space-y-5 text-[13px]" @submit.prevent="save">
          <UFormField :label="$t('common.name')"><UInput v-model="form.name" :placeholder="$t('campaigns.sequences.namePlaceholder')" class="w-full" autofocus /></UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('campaigns.sequences.startsWhen')"><USelect v-model="form.trigger.type" :items="triggerItems" value-key="value" class="w-full" /></UFormField>
            <UFormField v-if="form.trigger.type === 'subscribed'" :label="$t('campaigns.sequences.topic')"><OptionalSelect v-model="form.trigger.topic" :items="topicItems" :none-label="$t('campaigns.sequences.anyTopic')" class="w-full" :disabled="!project.marketing.topics.length" /></UFormField>
            <UFormField v-else-if="form.trigger.type === 'event'" :label="$t('campaigns.sequences.event')" hint="POST /v1/track · onboarding.completed"><UInput v-model="form.trigger.event" placeholder="trial_started" class="w-full font-mono" /></UFormField>
          </div>

          <ol class="space-y-2">
            <li v-for="(step, i) in form.steps" :key="i" class="space-y-2 rounded-lg border border-default p-3">
              <div class="flex items-center gap-2">
                <span class="w-14 shrink-0 text-xs font-medium text-muted">{{ $t('campaigns.sequences.emailN', { n: i + 1 }) }}</span>
                <UInput v-model.number="step.amount" type="number" min="0" size="sm" class="w-20" :aria-label="$t('campaigns.sequences.aria.wait')" />
                <USelect v-model="step.unit" :items="units" value-key="value" size="sm" class="w-28" :aria-label="$t('campaigns.sequences.aria.unit')" />
                <span class="text-xs text-muted">{{ i === 0 ? $t('campaigns.sequences.afterStart') : $t('campaigns.sequences.afterPrevious') }}</span>
                <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="ml-auto" :aria-label="$t('campaigns.sequences.aria.removeStep')" @click="form.steps.splice(i, 1)" />
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <USelect v-model="step.template" :items="templateItems" value-key="value" :placeholder="$t('campaigns.sequences.template')" size="sm" :aria-label="$t('campaigns.sequences.template')" />
                <UInput v-model="step.subject" :placeholder="$t('campaigns.sequences.subjectPlaceholder')" size="sm" :aria-label="$t('campaigns.sequences.subject')" />
              </div>
            </li>
          </ol>
          <UButton icon="i-lucide-plus" :label="$t('campaigns.sequences.addEmail')" size="xs" color="neutral" variant="ghost" @click="form.steps.push({ id: '', delayMinutes: 1440, template: templates[0]?.key || '', amount: 1, unit: 1440 })" />

          <div class="flex justify-end gap-2 border-t border-default pt-4">
            <UButton color="neutral" variant="ghost" @click="open = false">{{ $t('common.cancel') }}</UButton>
            <UButton type="submit" :loading="saving" :disabled="!form.name.trim() || !form.steps.length">{{ $t('campaigns.save') }}</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
