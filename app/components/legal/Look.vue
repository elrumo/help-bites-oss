<template>
  <UModal v-model:open="open" title="Identity and look" description="Used by every legal document of this project.">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField label="Company or person" hint="Named as the operator"><UInput v-model="form.entity.name" class="w-full" /></UFormField>
        <UFormField label="Postal address"><UInput v-model="form.entity.address" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Legal contact email"><UInput v-model="form.entity.email" type="email" class="w-full" /></UFormField>
          <UFormField label="Data protection officer" hint="Optional"><UInput v-model="form.entity.dpo" class="w-full" /></UFormField>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Accent colour" hint="Empty uses the project's">
            <div class="flex items-center gap-2">
              <input v-model="form.accent" type="color" class="h-8 w-10 cursor-pointer rounded border border-default bg-transparent" aria-label="Accent colour">
              <UInput v-model="form.accent" placeholder="#4f46e5" class="w-full font-mono" />
            </div>
          </UFormField>
          <UFormField label="Font"><USelect v-model="form.font" :items="fonts" class="w-full" /></UFormField>
        </div>
        <UFormField label="Logo URL" hint="Empty uses the project's logo"><UInput v-model="form.logoUrl" placeholder="https://" class="w-full" /></UFormField>
        <UFormField label="Footer text"><UInput v-model="form.footerText" class="w-full" /></UFormField>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton type="submit" label="Save" :loading="saving" />
        </div>
      </form>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { normalizeLegalConfig, type LegalConfig } from '#shared/legal/config'
import type { AdminProject } from '~~/server/utils/projects'

const props = defineProps<{ projectId: string }>()
const open = defineModel<boolean>('open', { default: false })
const { api, projects } = useAgent()

const fonts = [{ label: 'Sans-serif', value: 'system' }, { label: 'Serif', value: 'serif' }, { label: 'Monospace', value: 'mono' }]
const form = ref<LegalConfig>(normalizeLegalConfig(undefined))
const saving = ref(false)
const error = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  const project = projects.value.find(p => p.id === props.projectId)
  form.value = JSON.parse(JSON.stringify(normalizeLegalConfig(project?.legal)))
})

async function save() {
  saving.value = true
  error.value = ''
  try {
    const result = await api<{ project: AdminProject }>(`/admin/projects/${props.projectId}`, { method: 'PATCH', body: { legal: form.value } })
    projects.value = projects.value.map(p => (p.id === props.projectId ? result.project : p))
    open.value = false
  } catch (e: any) {
    error.value = e?.message || 'Could not save'
  } finally {
    saving.value = false
  }
}
</script>
