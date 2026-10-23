<template>
  <UModal v-model:open="open" :title="$t('sections.settings')" :description="$t('projectPages.settings.generalHint')" :ui="{ content: 'sm:max-w-6xl overflow-hidden' }">
    <template #content>
      <SettingsProject v-if="target" ref="form" :key="target.id" :project-id="target.id" :section="target.section" @close="open = false" />
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type SettingsProject from './Project.vue'

const { target } = useProjectSettings()
const { t } = useI18n()
const form = ref<InstanceType<typeof SettingsProject> | null>(null)
// Closing with unsaved changes asks first, as leaving the old page did.
const open = computed({
  get: () => !!target.value,
  set: (value) => { if (!value && !(form.value?.dirty && !confirm(t('projectPages.settings.leaveConfirm')))) target.value = null }
})
</script>
