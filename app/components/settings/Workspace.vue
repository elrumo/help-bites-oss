<template>
  <div class="space-y-8">
    <form class="space-y-6" @submit.prevent="save">
      <UFormField label="Workspace name" hint="Shown in the top-left menu and in invitations">
        <UInput v-model="name" class="w-full sm:w-80" maxlength="80" :disabled="!canEdit" required />
      </UFormField>
      <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
      <div v-if="canEdit" class="flex items-center gap-3">
        <UButton type="submit" :loading="saving" :disabled="!dirty">Save</UButton>
        <span v-if="saved && !dirty" class="text-[13px] text-muted">Saved</span>
      </div>
      <p v-else class="text-[13px] text-muted">Only admins and owners can change the workspace's settings.</p>
    </form>

    <div v-if="canExport" class="space-y-2">
      <p class="section-label">Export data</p>
      <div class="flex items-center gap-3 rounded-xl border border-default px-4 py-3">
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-medium text-highlighted">Everything in this workspace, as one file</p>
          <p class="text-xs text-muted">
            Conversations, contacts, knowledge, emails and settings as gzipped JSON Lines, without secrets.
            <template v-if="lastExport">Last export {{ timeAgo(lastExport.at) }} · <a :href="lastExport.url" class="text-primary hover:underline">Download</a></template>
          </p>
        </div>
        <UButton label="Export data" icon="i-lucide-download" color="neutral" variant="outline" size="sm" class="shrink-0" :loading="exporting" @click="exportData" />
      </div>
    </div>

    <div v-if="canDelete" class="space-y-2">
      <p class="section-label">Danger zone</p>
      <div class="flex items-center gap-3 rounded-xl border border-error/30 px-4 py-3">
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-medium text-highlighted">Delete workspace</p>
          <p class="text-xs text-muted">Its projects, conversations, contacts, knowledge and files go for good. Everyone's account stays.</p>
        </div>
        <UButton label="Delete workspace" color="error" variant="outline" size="sm" class="shrink-0" @click="openDelete" />
      </div>
    </div>

    <UModal v-model:open="deleteOpen" title="Delete this workspace?" :ui="{ content: 'sm:max-w-md' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="remove">
          <p class="text-[13px] text-muted">
            Everything in <span class="font-medium text-highlighted">{{ workspaceName }}</span> is deleted: its projects, conversations, contacts, knowledge, emails and files. The widget and the API stop answering at once. This can't be undone, so export the data first if you want a copy.
          </p>
          <UFormField :label="`Type ${workspaceName} to confirm`">
            <UInput v-model="confirmName" class="w-full" autocomplete="off" autofocus />
          </UFormField>
          <p v-if="deleteError" class="text-[13px] text-error">{{ deleteError }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="deleteOpen = false">Cancel</UButton>
            <UButton type="submit" color="error" :loading="deleting" :disabled="confirmName !== workspaceName">Delete workspace</UButton>
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
    error.value = e?.message || 'Could not save'
  } finally {
    saving.value = false
  }
}

// ---- export -------------------------------------------------------------------

const lastExport = ref<{ at: string, url: string } | null>(null)
const exporting = ref(false)

async function exportData() {
  exporting.value = true
  try {
    await api('/admin/workspace/export', { method: 'POST' })
    toast.add({ title: 'We\'ll email you a link', description: 'The export runs in the background; a big workspace takes a few minutes.' })
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not start the export', color: 'error' })
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  // Only a convenience: the email has the link too.
  if (canExport.value) lastExport.value = (await api<{ lastExport: { at: string, url: string } | null }>('/admin/workspace/export').catch(() => null))?.lastExport || null
})

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
    deleteError.value = e?.message || 'Could not delete the workspace'
    deleting.value = false
    return
  }
  // Nothing on screen belongs anywhere now: start over in another workspace, or make one.
  const next = context.value?.workspaces.find(w => w.id !== id && w.status === 'active')
  if (next) await switchWorkspace(next.id)
  else await reloadNuxtApp({ path: '/workspaces/new' })
}
</script>
