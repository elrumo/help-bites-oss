<template>
  <UModal v-model:open="open" :title="$t('legal.look.title')" :description="$t('legal.look.description')">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <p class="text-xs text-muted">
          <i18n-t keypath="legal.look.companyNote" tag="span">
            <template #company><NuxtLink :to="`/projects/${projectId}/settings#company`" class="font-medium text-default underline-offset-2 hover:underline">{{ $t('legal.look.companyLink') }}</NuxtLink></template>
          </i18n-t>
        </p>
        <UFormField :label="$t('legal.look.entity')" :hint="$t('legal.look.entityHint')"><UInput v-model="form.entity.name" class="w-full" /></UFormField>
        <UFormField :label="$t('legal.look.address')"><UInput v-model="form.entity.address" class="w-full" /></UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="$t('legal.look.email')"><UInput v-model="form.entity.email" type="email" class="w-full" /></UFormField>
          <UFormField :label="$t('legal.look.dpo')" :hint="$t('legal.optional')"><UInput v-model="form.entity.dpo" class="w-full" /></UFormField>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="$t('legal.look.accent')" :hint="$t('legal.look.accentHint')">
            <div class="flex items-center gap-2">
              <input v-model="form.accent" type="color" class="h-8 w-10 cursor-pointer rounded border border-default bg-transparent" :aria-label="$t('legal.look.accent')">
              <UInput v-model="form.accent" placeholder="#4f46e5" class="w-full font-mono" />
            </div>
          </UFormField>
          <UFormField :label="$t('legal.look.font')"><USelect v-model="form.font" :items="fonts" class="w-full" /></UFormField>
        </div>
        <UFormField :label="$t('legal.look.logo')" :hint="$t('legal.look.logoHint')"><UInput v-model="form.logoUrl" placeholder="https://" class="w-full" /></UFormField>
        <UFormField :label="$t('legal.look.footer')"><UInput v-model="form.footerText" class="w-full" /></UFormField>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" :label="$t('common.cancel')" @click="open = false" />
          <UButton type="submit" :label="$t('legal.save')" :loading="saving" />
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
const { t } = useI18n()

const fonts = computed(() => [{ label: t('legal.look.fontSans'), value: 'system' }, { label: t('legal.look.fontSerif'), value: 'serif' }, { label: t('legal.look.fontMono'), value: 'mono' }])
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
    error.value = e?.message || t('legal.couldNotSave')
  } finally {
    saving.value = false
  }
}
</script>
