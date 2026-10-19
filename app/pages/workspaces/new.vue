<template>
  <div class="flex min-h-full items-center justify-center bg-default px-6 py-16">
    <form class="w-full max-w-[22rem]" @submit.prevent="create">
      <span class="mb-10 grid size-8 place-items-center rounded-lg bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-[18px]" /></span>
      <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ context?.workspace ? $t('admin.workspace.newTitle') : $t('admin.workspace.noWorkspaceTitle') }}</h1>
      <p class="mb-8 mt-1 text-[15px] text-muted">{{ context?.workspace ? $t('admin.workspace.newHint') : $t('admin.workspace.noWorkspaceHint') }}</p>
      <UFormField :label="$t('admin.workspace.name')" class="mb-6" :ui="{ label: 'font-normal text-muted' }"><UInput v-model="name" required maxlength="80" size="lg" class="w-full" :ui="{ base: 'h-11' }" autofocus /></UFormField>
      <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
      <div class="flex items-center justify-end gap-2">
        <UButton color="neutral" variant="ghost" size="lg" @click="logout()">{{ $t('nav.signOut') }}</UButton>
        <UButton type="submit" size="lg" :loading="saving">{{ $t('admin.workspace.create') }}</UButton>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'bare', middleware: 'agent' })

const { api, context, logout, switchWorkspace } = useAgent()
const { t } = useI18n()
const name = ref('')
const saving = ref(false)
const error = ref('')

async function create() {
  saving.value = true
  error.value = ''
  try {
    const { workspace } = await api<{ workspace: { id: string } }>('/admin/workspaces', { method: 'POST', body: { name: name.value } })
    await switchWorkspace(workspace.id)
  } catch (e: any) {
    error.value = e?.message || t('admin.workspace.couldNotCreate')
    saving.value = false
  }
}
</script>
