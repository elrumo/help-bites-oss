<template>
  <div class="flex flex-wrap items-center gap-2">
    <UButton v-if="from" icon="i-lucide-bookmark-plus" :label="$t('style.saveAsProject')" size="xs" color="neutral" variant="soft" :disabled="disabled" @click="openWith(from)" />
    <UButton icon="i-lucide-palette" :label="$t('style.editProject')" size="xs" color="neutral" variant="ghost" :disabled="disabled" @click="openWith()" />

    <UModal v-model:open="open" :title="$t('style.projectTitle')" :description="$t('style.projectDescription')" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <p v-if="from" class="rounded-lg border border-default bg-elevated px-3 py-2 text-xs text-muted">{{ $t('style.fromFeature') }}</p>
          <StyleEditor v-if="project" v-model="draft" :kit="project.look.kit" :empty-scheme="$t('style.followVisitor')" />
          <p v-if="error" class="text-sm text-error">{{ error }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="open = false" />
            <UButton type="submit" :label="$t('style.save')" :loading="saving" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { DEFAULT_PROJECT_STYLE, overlayStyle, validateProjectStyle, type ProjectStyle } from '#shared/projectStyle'
import type { AdminProject } from '~~/server/utils/projects'

// The two ways into the project style from any style panel: edit it, or save
// what this panel has chosen as the project's style so every other styled
// feature wears it too. Both open the same editor, so the person sees exactly
// what will be saved. `from` is what the panel can offer (its accent, radius…).
const props = defineProps<{ projectId: string, from?: Partial<ProjectStyle> | null, disabled?: boolean }>()
const emit = defineEmits<{ saved: [project: AdminProject] }>()

const { api, projects } = useAgent()
const { t } = useI18n()

const project = computed(() => projects.value.find(p => p.id === props.projectId) || null)
const open = ref(false)
const saving = ref(false)
const error = ref('')
const draft = ref<ProjectStyle>(structuredClone(DEFAULT_PROJECT_STYLE))

function openWith(extra?: Partial<ProjectStyle> | null) {
  const current = structuredClone(toRaw(project.value?.style) || DEFAULT_PROJECT_STYLE)
  draft.value = extra ? overlayStyle(current, validateProjectStyle(toRaw(extra)).style) : current
  error.value = ''
  open.value = true
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const result = await api<{ project: AdminProject }>(`/admin/projects/${props.projectId}`, { method: 'PATCH', body: { style: draft.value } })
    projects.value = projects.value.map(p => (p.id === props.projectId ? result.project : p))
    emit('saved', result.project)
    open.value = false
  } catch (e: any) {
    error.value = e?.message || t('style.saveError')
  } finally {
    saving.value = false
  }
}
</script>
