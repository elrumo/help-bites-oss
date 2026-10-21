<script setup lang="ts">
/**
 * The AI page wizard: a few questions about the product (prefilled from its
 * GitHub repos on request), saved as the messaging brief; then a page is made,
 * from the chosen template or blank, and the editor opens with the assistant
 * already building it from the answers.
 */
import { CMS_WIZARD_QUESTIONS, wizardPrompt, type WizardAnswers } from '#shared/cms/library'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ (e: 'back'): void, (e: 'done'): void }>()

const { api, projects } = useAgent()
const { t } = useI18n()
const project = computed(() => projects.value.find(p => p.id === props.projectId))
const answers = reactive<WizardAnswers>({ product: project.value?.name || '', goal: 'signup', tone: 'plain', layout: 'saas', repos: [] })
const repos = ref<string[]>([])
const suggesting = ref(false)
const creating = ref(false)
const error = ref('')

const missing = computed(() => CMS_WIZARD_QUESTIONS.filter(q => q.required && !String(answers[q.id] ?? '').trim()).map(q => q.label))
const text = (id: string) => String(answers[id] ?? '')
const label = (id: string) => CMS_WIZARD_QUESTIONS.find(q => q.id === id)?.options?.find(o => o.value === text(id))?.label || text(id)

onMounted(async () => {
  try {
    repos.value = (await api<{ repos: string[] }>('/admin/cms/repos', { query: { project: props.projectId } })).repos
    answers.repos = [...repos.value]
  } catch {}
})

async function suggest() {
  suggesting.value = true
  error.value = ''
  try {
    const { answers: found } = await api<{ answers: WizardAnswers }>('/admin/cms/wizard/suggest', { method: 'POST', body: { project: props.projectId, repos: answers.repos } })
    // Only fill what is still empty: what the person typed wins.
    for (const [k, v] of Object.entries(found)) if (!text(k).trim()) answers[k] = v
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || t('projectTools.pages.wizard.suggestError')
  } finally {
    suggesting.value = false
  }
}

async function create() {
  if (missing.value.length) return
  creating.value = true
  error.value = ''
  try {
    await api('/admin/cms/settings', {
      method: 'PATCH',
      body: {
        project: props.projectId,
        brief: { audience: text('audience'), problem: text('problem'), valueProposition: text('oneLiner'), pillars: text('features').split('\n').map(s => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 5), proof: text('proof'), tone: label('tone'), callToAction: label('goal') }
      }
    })
    const layout = text('layout')
    const { entry } = await api<{ entry: { id: string } }>('/admin/cms/entries', { method: 'POST', body: { project: props.projectId, name: text('product') || undefined, ...(layout !== 'new' ? { template: layout } : {}) } })
    // The editor's assistant sends it once it opens.
    useState<string>('cmsFirstPrompt').value = wizardPrompt(answers)
    emit('done')
    await navigateTo(`/projects/${props.projectId}/pages/${entry.id}`)
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || t('projectTools.pages.createError')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="create">
    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-default bg-elevated/40 p-3">
      <UIcon name="i-lucide-github" class="size-4 text-muted" />
      <p class="min-w-0 flex-1 text-xs text-muted">{{ repos.length ? $t('projectTools.pages.wizard.reposHint') : $t('projectTools.pages.wizard.noRepos') }}</p>
      <UButton v-if="repos.length" icon="i-lucide-wand-sparkles" :label="$t('projectTools.pages.wizard.suggest')" size="xs" color="neutral" variant="soft" :loading="suggesting" @click="suggest" />
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField v-for="q in CMS_WIZARD_QUESTIONS" :key="q.id" :label="q.label" :help="q.help" :required="q.required" :class="q.kind === 'longtext' || q.kind === 'repos' ? 'sm:col-span-2' : ''">
        <UInput v-if="q.kind === 'text'" v-model="answers[q.id] as string" :placeholder="q.placeholder" class="w-full" />
        <UTextarea v-else-if="q.kind === 'longtext'" v-model="answers[q.id] as string" :placeholder="q.placeholder" autoresize :rows="2" :maxrows="6" class="w-full" />
        <USelect v-else-if="q.kind === 'select'" v-model="answers[q.id] as string" :items="q.options" class="w-full" />
        <USelectMenu v-else-if="q.kind === 'repos'" v-model="answers.repos as string[]" :items="repos" multiple :disabled="!repos.length" :placeholder="$t('projectTools.pages.wizard.noReposShort')" class="w-full" />
      </UFormField>
    </div>

    <p v-if="error" class="text-sm text-error">{{ error }}</p>
    <div class="flex items-center justify-end gap-2">
      <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" :label="$t('projectTools.pages.back')" class="mr-auto" @click="emit('back')" />
      <UButton type="submit" icon="i-lucide-sparkles" :label="$t('projectTools.pages.wizard.generate')" :loading="creating" :disabled="missing.length > 0" />
    </div>
  </form>
</template>
