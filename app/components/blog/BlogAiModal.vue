<template>
  <UModal v-model:open="open" :title="$t('blog.ai.title')" :description="$t('blog.ai.intro')" :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <div class="space-y-4">
        <UFormField :label="$t('blog.ai.mode')">
          <div class="flex flex-wrap gap-2">
            <UButton v-for="item in BLOG_AI_MODES" :key="item" :label="$t(`blog.ai.modes.${item}`)" size="sm" :color="mode === item ? 'primary' : 'neutral'" :variant="mode === item ? 'solid' : 'outline'" :disabled="item !== 'write' && !hasText" @click="pick(item)" />
          </div>
          <p v-if="!hasText" class="mt-1 text-xs text-muted">{{ $t('blog.ai.needsText') }}</p>
        </UFormField>
        <UFormField :label="$t('blog.ai.instruction')" :hint="`${instruction.length} / 2000`">
          <UTextarea v-model="instruction" :maxlength="2000" :placeholder="$t('blog.ai.instructionPlaceholder')" autoresize :rows="2" :maxrows="6" class="w-full" />
        </UFormField>
        <UFormField :label="$t('blog.ai.repos')" :help="repos.length ? undefined : $t('blog.ai.noRepos')">
          <USelectMenu v-model="chosen" :items="repos" multiple :disabled="!repos.length" :placeholder="$t('blog.ai.allRepos')" class="w-full" />
        </UFormField>
        <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

        <div v-if="result" class="space-y-3 border-t border-default pt-4">
          <p v-if="result.notes" class="text-[13px] text-default">{{ result.notes }}</p>
          <dl v-if="result.title || result.excerpt || result.metaDescription || result.tags.length" class="space-y-2 rounded-lg bg-elevated/60 p-3 text-xs">
            <div v-if="result.title"><dt class="font-semibold text-highlighted">{{ $t('blog.title') }}</dt><dd class="text-default">{{ result.title }}</dd></div>
            <div v-if="result.excerpt"><dt class="font-semibold text-highlighted">{{ $t('blog.excerpt') }}</dt><dd class="text-default">{{ result.excerpt }}</dd></div>
            <div v-if="result.metaDescription"><dt class="font-semibold text-highlighted">{{ $t('blog.seo.metaDescription') }}</dt><dd class="text-default">{{ result.metaDescription }}</dd></div>
            <div v-if="result.tags.length"><dt class="font-semibold text-highlighted">{{ $t('blog.tags') }}</dt><dd class="text-default">{{ result.tags.join(', ') }}</dd></div>
          </dl>
          <pre v-if="result.body" class="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg border border-default p-3 font-sans text-[13px] text-default">{{ result.body }}</pre>
          <p v-if="result.repos.length" class="text-[11px] text-dimmed">{{ $t('blog.ai.reposRead', { repos: result.repos.map(r => r.read ? r.repo : `${r.repo} ✕`).join(', ') }) }}</p>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="$t('common.cancel')" color="neutral" variant="ghost" @click="open = false" />
        <UButton :label="result ? $t('blog.ai.again') : $t('blog.ai.run')" icon="i-lucide-sparkles" :color="result ? 'neutral' : 'primary'" :variant="result ? 'soft' : 'solid'" :loading="busy" :disabled="mode !== 'write' && !hasText" @click="run" />
        <UButton v-if="result" :label="$t(`blog.ai.apply${mode[0]!.toUpperCase()}${mode.slice(1)}`)" icon="i-lucide-check" @click="apply" />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { BlogAiResult } from '~/utils/blogDraft'

// "Write with AI" (native: BlogAiSheet in Blog/BlogAi.swift). The server reads the
// project's GitHub repos and the post as it is in the editor, unsaved edits
// included; the proposal is applied to the editor, where it saves like any edit.
const BLOG_AI_MODES = ['write', 'continue', 'improve', 'meta'] as const
type Mode = typeof BLOG_AI_MODES[number]

const props = defineProps<{ projectId: string, title: string, body: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ apply: [mode: Mode, result: BlogAiResult] }>()
const { api } = useAgent()
const { t } = useI18n()

const hasText = computed(() => !!props.body.trim())
const mode = ref<Mode>('write')
const instruction = ref('')
const repos = ref<string[]>([])
const chosen = ref<string[]>([])
const busy = ref(false)
const error = ref('')
const result = ref<BlogAiResult | null>(null)

function pick(next: Mode) {
  mode.value = next
  result.value = null
}

watch(open, async (value) => {
  if (!value) return
  if (!hasText.value) pick('write')
  if (repos.value.length) return
  try {
    repos.value = (await api<{ repos: string[] }>('/admin/cms/repos', { query: { project: props.projectId } })).repos
  } catch {}
})

async function run() {
  busy.value = true
  error.value = ''
  try {
    result.value = (await api<{ result: BlogAiResult }>('/admin/blog/ai', { method: 'POST', body: { project: props.projectId, mode: mode.value, instruction: instruction.value, title: props.title, body: props.body, repos: chosen.value } })).result
  } catch (e: any) {
    error.value = e?.message || t('blog.ai.error')
  } finally {
    busy.value = false
  }
}

function apply() {
  if (!result.value) return
  emit('apply', mode.value, result.value)
  open.value = false
  result.value = null
}
</script>
