<template>
  <div class="flex min-h-full items-center justify-center bg-default px-6 py-16">
    <form class="w-full max-w-[22rem]" @submit.prevent="create">
      <span class="mb-10 grid size-8 place-items-center rounded-lg bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-[18px]" /></span>
      <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ context?.workspace ? 'New workspace' : 'You\'re not in a workspace' }}</h1>
      <p class="mb-8 mt-1 text-[15px] text-muted">{{ context?.workspace ? 'A separate space with its own projects, inbox and team.' : 'Start your own, or ask a teammate to invite you to theirs.' }}</p>
      <UFormField label="Workspace name" class="mb-6" :ui="{ label: 'font-normal text-muted' }"><UInput v-model="name" required maxlength="80" size="lg" class="w-full" :ui="{ base: 'h-11' }" autofocus /></UFormField>
      <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
      <div class="flex items-center justify-end gap-2">
        <UButton color="neutral" variant="ghost" size="lg" @click="logout()">Sign out</UButton>
        <UButton type="submit" size="lg" :loading="saving">Create workspace</UButton>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'bare', middleware: 'agent' })

const { api, context, logout, switchWorkspace } = useAgent()
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
    error.value = e?.message || 'Could not create the workspace'
    saving.value = false
  }
}
</script>
