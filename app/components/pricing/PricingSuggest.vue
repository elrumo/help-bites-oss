<template>
  <UModal v-model:open="open" :title="$t('projectTools.pricing.suggestTitle')" :description="$t('projectTools.pricing.suggestIntro')" :ui="{ content: 'sm:max-w-3xl' }">
    <template #body>
      <div class="space-y-4">
        <UFormField :label="$t('projectTools.pricing.suggestFocus')">
          <div class="flex flex-wrap gap-4">
            <UCheckbox v-for="item in PRICING_AI_FOCUS" :key="item" :model-value="focus.includes(item)" :label="$t(`projectTools.pricing.focus.${item}`)" @update:model-value="toggle(item, !!$event)" />
          </div>
        </UFormField>
        <UFormField :label="$t('projectTools.pricing.suggestRepos')" :help="repos.length ? undefined : $t('projectTools.pricing.suggestNoRepos')">
          <USelectMenu v-model="chosen" :items="repos" multiple :disabled="!repos.length" :placeholder="$t('projectTools.pricing.suggestAllRepos')" class="w-full" />
        </UFormField>
        <UFormField :label="$t('projectTools.pricing.suggestNotes')" :hint="`${notes.length} / 1000`">
          <UTextarea v-model="notes" :maxlength="1000" :placeholder="$t('projectTools.pricing.suggestNotesPlaceholder')" autoresize :rows="2" :maxrows="6" class="w-full" />
        </UFormField>
        <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

        <div v-if="suggestion" class="space-y-3 border-t border-default pt-4">
          <p class="text-[13px] text-default">{{ suggestion.summary }}</p>
          <div v-if="suggestion.advice.length" class="space-y-1 rounded-lg bg-elevated/60 p-3">
            <p class="text-xs font-semibold text-highlighted">{{ $t('projectTools.pricing.suggestAdvice') }}</p>
            <p v-for="(line, i) in suggestion.advice" :key="i" class="text-xs text-default">{{ line }}</p>
          </div>
          <p v-if="suggestion.repos.length" class="text-[11px] text-dimmed">
            {{ $t('projectTools.pricing.suggestReposRead', { repos: suggestion.repos.map(r => r.read ? r.repo : `${r.repo} ✕`).join(', ') }) }}
          </p>
          <div class="max-h-[50vh] overflow-auto rounded-xl p-4" :class="dark ? 'bg-stone-950' : 'bg-stone-200/70'">
            <div ref="previewEl" />
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="$t('common.cancel')" color="neutral" variant="ghost" @click="open = false" />
        <UButton :label="suggestion ? $t('projectTools.pricing.suggestAgain') : $t('projectTools.pricing.suggestRun')" icon="i-lucide-sparkles" :color="suggestion ? 'neutral' : 'primary'" :variant="suggestion ? 'soft' : 'solid'" :loading="busy" :disabled="!focus.length" @click="suggest" />
        <UButton v-if="suggestion" :label="$t('projectTools.pricing.suggestApply')" icon="i-lucide-check" @click="apply" />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { PricingSnapshot, PublicPricingTable } from '#shared/pricing'

// What the server's suggest route returns; the server has PRICING_AI_FOCUS too.
const PRICING_AI_FOCUS = ['copy', 'features', 'prices'] as const
type Focus = typeof PRICING_AI_FOCUS[number]
type Suggestion = { summary: string, advice: string[], draft: Pick<PricingSnapshot, 'content' | 'plans' | 'features'>, preview: PublicPricingTable, repos: { repo: string, read: boolean }[] }

const props = defineProps<{ projectId: string, tableId: string, dark: boolean, beforeSuggest: () => Promise<boolean> }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ apply: [draft: Suggestion['draft']] }>()
const { api } = useAgent()
const { t } = useI18n()

const focus = ref<Focus[]>([...PRICING_AI_FOCUS])
const repos = ref<string[]>([])
const chosen = ref<string[]>([])
const notes = ref('')
const busy = ref(false)
const error = ref('')
const suggestion = ref<Suggestion | null>(null)
const previewEl = ref<HTMLElement | null>(null)

function toggle(item: Focus, on: boolean) {
  focus.value = on ? [...new Set([...focus.value, item])] : focus.value.filter(f => f !== item)
}

watch(open, async (value) => {
  if (!value || repos.value.length) return
  try {
    repos.value = (await api<{ repos: string[] }>('/admin/cms/repos', { query: { project: props.projectId } })).repos
  } catch {}
})

// The server reads the saved working copy, so unsaved edits are saved first.
async function suggest() {
  if (!(await props.beforeSuggest())) return
  busy.value = true
  error.value = ''
  try {
    suggestion.value = (await api<{ suggestion: Suggestion }>(`/admin/pricing-tables/${props.tableId}/suggest`, { method: 'POST', body: { focus: focus.value, repos: chosen.value, notes: notes.value } })).suggestion
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pricing.suggestError')
  } finally {
    busy.value = false
  }
}

watch([suggestion, previewEl, () => props.dark], () => {
  if (suggestion.value && previewEl.value) pricingQueue().push(['preview', { target: previewEl.value, table: suggestion.value.preview, theme: props.dark ? 'dark' : 'light' }])
}, { flush: 'post' })

function apply() {
  if (!suggestion.value) return
  emit('apply', suggestion.value.draft)
  open.value = false
  suggestion.value = null
}
</script>
