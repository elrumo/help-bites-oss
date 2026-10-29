<template>
  <div class="space-y-8">
    <form class="space-y-6" @submit.prevent="save">
      <UFormField :label="$t('workspaceSettings.workspace.nameLabel')" :hint="$t('workspaceSettings.workspace.nameHint')">
        <UInput v-model="name" class="w-full sm:w-80" maxlength="80" :disabled="!canEdit" required />
      </UFormField>
      <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
      <div v-if="canEdit" class="flex items-center gap-3">
        <UButton type="submit" :loading="saving" :disabled="!dirty">{{ $t('workspaceSettings.save') }}</UButton>
        <span v-if="saved && !dirty" class="text-[13px] text-muted">{{ $t('common.saved') }}</span>
      </div>
      <p v-else class="text-[13px] text-muted">{{ $t('workspaceSettings.adminOnly') }}</p>
    </form>

    <SettingsTransfer v-if="canExport" />

    <div v-if="canDelete" class="space-y-2">
      <p class="section-label">{{ $t('workspaceSettings.workspace.dangerZone') }}</p>
      <div class="flex items-center gap-3 rounded-xl border border-error/30 px-4 py-3">
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-medium text-highlighted">{{ $t('workspaceSettings.workspace.deleteWorkspace') }}</p>
          <p class="text-xs text-muted">{{ $t('workspaceSettings.workspace.deleteDescription') }}</p>
        </div>
        <UButton :label="$t('workspaceSettings.workspace.deleteWorkspace')" color="error" variant="outline" size="sm" class="shrink-0" @click="openDelete" />
      </div>
    </div>

    <UModal v-model:open="deleteOpen" :title="$t('workspaceSettings.workspace.deleteTitle')" :ui="{ content: 'sm:max-w-md' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="remove">
          <i18n-t keypath="workspaceSettings.workspace.deleteBody" tag="p" class="text-[13px] text-muted">
            <template #name><span class="font-medium text-highlighted">{{ workspaceName }}</span></template>
          </i18n-t>
          <UFormField :label="$t('workspaceSettings.workspace.typeToConfirm', { name: workspaceName })">
            <UInput v-model="confirmName" class="w-full" autocomplete="off" autofocus />
          </UFormField>
          <p v-if="deleteError" class="text-[13px] text-error">{{ deleteError }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="deleteOpen = false">{{ $t('common.cancel') }}</UButton>
            <UButton type="submit" color="error" :loading="deleting" :disabled="confirmName !== workspaceName">{{ $t('workspaceSettings.workspace.deleteWorkspace') }}</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { can } from '#shared/roles'

const { api, context, switchWorkspace } = useAgent()
const toast = useToast()
const { t } = useI18n()
const canEdit = computed(() => can(context.value?.role, 'workspace.settings'))
const canExport = computed(() => can(context.value?.role, 'workspace.export'))
const canDelete = computed(() => can(context.value?.role, 'workspace.delete'))
const workspaceName = computed(() => context.value?.workspace?.name || '')
const name = ref(workspaceName.value)
const dirty = computed(() => name.value.trim() !== workspaceName.value)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

async function save() {
  saving.value = true
  error.value = ''
  try {
    const { workspace } = await api<{ workspace: { id: string, name: string } }>('/admin/workspace', { method: 'PATCH', body: { name: name.value } })
    if (context.value?.workspace) {
      context.value.workspace.name = workspace.name
      for (const w of context.value.workspaces) if (w.id === workspace.id) w.name = workspace.name
    }
    saved.value = true
  } catch (e: any) {
    error.value = e?.message || t('workspaceSettings.workspace.saveFailed')
  } finally {
    saving.value = false
  }
}


// ---- deletion -----------------------------------------------------------------

const deleteOpen = ref(false)
const confirmName = ref('')
const deleting = ref(false)
const deleteError = ref('')

function openDelete() {
  confirmName.value = ''
  deleteError.value = ''
  deleteOpen.value = true
}

async function remove() {
  const id = context.value?.workspace?.id || ''
  deleting.value = true
  deleteError.value = ''
  try {
    await api('/admin/workspace', { method: 'DELETE', body: { confirm: confirmName.value } })
  } catch (e: any) {
    deleteError.value = e?.message || t('workspaceSettings.workspace.deleteFailed')
    deleting.value = false
    return
  }
  // Nothing on screen belongs anywhere now: start over in another workspace, or make one.
  const next = context.value?.workspaces.find(w => w.id !== id && w.status === 'active')
  if (next) await switchWorkspace(next.id)
  else await reloadNuxtApp({ path: '/workspaces/new' })
}
</script>
