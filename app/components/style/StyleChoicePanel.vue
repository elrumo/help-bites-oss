<template>
  <form class="space-y-4" @submit.prevent="save">
    <URadioGroup v-model="source" :items="sourceItems" variant="card" />
    <div v-if="source === 'project'" class="space-y-3">
      <p class="text-[13px] text-muted">{{ $t('style.projectNote') }}</p>
      <StylePreview :style="project.look.style" />
    </div>
    <StyleEditor v-else v-model="custom" :kit="project.look.kit" :under="[project.style]" />
    <StyleProjectActions :project-id="project.id" :from="source === 'custom' ? custom : null" />
    <p v-if="error" class="text-sm text-error">{{ error }}</p>
    <div class="flex items-center justify-end gap-2">
      <span v-if="saved" class="text-xs text-muted">{{ $t('common.saved') }}</span>
      <UButton type="submit" :label="$t('style.save')" :loading="saving" />
    </div>
  </form>
</template>

<script setup lang="ts">
import type { StyleChoice } from '#shared/projectStyle'
import type { AdminProject } from '~~/server/utils/projects'

// The style panel of one public feature (the changelog, the feedback board…):
// wear the project's style, or lay this feature's own choices over it. Saves
// as `{ [target]: { style } }` on the project, like the feature's other settings.
const props = defineProps<{ project: AdminProject, target: 'changelog' | 'feedback' }>()
const { api, projects } = useAgent()
const { t } = useI18n()

const choice = computed<StyleChoice>(() => props.project[props.target].style)
const source = ref<StyleChoice['source']>(choice.value.source)
const custom = ref(structuredClone(toRaw(choice.value.custom)))
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const sourceItems = computed(() => [
  { value: 'project', label: t('style.useProject'), description: t('style.useProjectHint') },
  { value: 'custom', label: t('style.custom'), description: t('style.customHint') }
])

async function save() {
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    const result = await api<{ project: AdminProject }>(`/admin/projects/${props.project.id}`, { method: 'PATCH', body: { [props.target]: { style: { source: source.value, custom: custom.value } } } })
    projects.value = projects.value.map(p => (p.id === result.project.id ? result.project : p))
    saved.value = true
  } catch (e: any) {
    error.value = e?.message || t('style.saveError')
  } finally {
    saving.value = false
  }
}
</script>
