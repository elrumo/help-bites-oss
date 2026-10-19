<template>
  <div class="flex min-h-full items-center justify-center bg-default px-6 py-16">
    <div class="w-full max-w-[22rem]">
      <span class="mb-10 grid size-8 place-items-center rounded-lg bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-[18px]" /></span>

      <div v-if="loading" class="space-y-3"><USkeleton class="h-7 w-48" /><USkeleton class="h-11" /></div>

      <template v-else-if="!invite">
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">This invitation has expired</h1>
        <p class="mt-1 text-[15px] text-muted">{{ error || 'It may have been used or revoked. Ask whoever invited you for a new link.' }}</p>
        <UButton class="mt-8" to="/login" color="neutral" variant="outline">Go to sign in</UButton>
      </template>

      <form v-else @submit.prevent="accept">
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">Join {{ invite.workspace.name }}</h1>
        <p class="mb-8 mt-1 text-[15px] text-muted">{{ invite.invitedBy || 'A teammate' }} invited {{ invite.email }} as {{ ROLE_LABELS[invite.role] || invite.role }}.</p>

        <template v-if="token">
          <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
          <div class="flex justify-end"><UButton type="submit" size="lg" :loading="saving">Join workspace</UButton></div>
        </template>
        <template v-else-if="invite.hasAccount">
          <p class="mb-6 text-[13px] text-muted">{{ invite.email }} already has an account. Sign in with it, and you'll come back here to join.</p>
          <div class="flex justify-end"><UButton size="lg" :to="{ path: '/login', query: { next: route.fullPath } }">Sign in to accept</UButton></div>
        </template>
        <template v-else>
          <UFormField label="Name" class="mb-4" :ui="labelUi"><UInput v-model="name" autocomplete="name" size="lg" class="w-full" :ui="fieldUi" autofocus /></UFormField>
          <UFormField label="Email" class="mb-4" :ui="labelUi"><UInput :model-value="invite.email" disabled size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <UFormField label="Password" hint="At least 8 characters" class="mb-6" :ui="labelUi"><UInput v-model="password" type="password" autocomplete="new-password" required minlength="8" size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
          <div class="flex justify-end"><UButton type="submit" size="lg" :loading="saving">Create account and join</UButton></div>
        </template>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ROLE_LABELS, type Role } from '#shared/roles'

definePageMeta({ layout: 'bare' })

type Invite = { workspace: { name: string }, email: string, role: Role, invitedBy: string, hasAccount: boolean }

const route = useRoute()
const { token, agent, workspaceId } = useAgent()
const code = computed(() => String(route.params.token || ''))
const invite = ref<Invite | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const name = ref('')
const password = ref('')
const fieldUi = { base: 'h-11' }
const labelUi = { label: 'font-normal text-muted' }

onMounted(async () => {
  try {
    invite.value = await $fetch<Invite>(`/v1/invitations/${encodeURIComponent(code.value)}`)
  } catch (e: any) {
    error.value = e?.data?.statusMessage || ''
  } finally {
    loading.value = false
  }
})

async function accept() {
  saving.value = true
  error.value = ''
  try {
    const result = await $fetch<{ workspace: { id: string }, sessionToken?: string, agent?: any }>(`/v1/invitations/${encodeURIComponent(code.value)}/accept`, {
      method: 'POST',
      body: { name: name.value, password: password.value },
      headers: token.value ? { Authorization: `Bearer ${token.value}` } : {}
    })
    if (result.sessionToken) token.value = result.sessionToken
    // Land in the workspace just joined, with a fresh panel.
    agent.value = null
    workspaceId.value = result.workspace.id
    try { localStorage.setItem('hb-workspace', result.workspace.id) } catch {}
    await reloadNuxtApp({ path: '/inbox' })
  } catch (e: any) {
    error.value = e?.data?.statusMessage || 'Could not accept the invitation'
  } finally {
    saving.value = false
  }
}
</script>
