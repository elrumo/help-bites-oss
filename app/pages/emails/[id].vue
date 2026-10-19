<template>
  <EmailEditor
    v-if="template"
    :template="template"
    :save="save"
    :stream-url="`/v1/admin/emails/${id}/events`"
    :stream-token="token"
    :back-to="template.projectId ? `/projects/${template.projectId}/email?view=templates` : '/emails?view=templates'"
    :agent-token="token"
    :brand="project"
    can-rename
    :on-send-test="() => { testOpen = true }"
  >
    <template #badge>
      <UBadge v-if="!template.projectId" label="Master" icon="i-lucide-layers" color="primary" variant="soft" size="sm" class="shrink-0" />
      <UBadge v-else-if="projectName" :label="projectName" color="neutral" variant="soft" size="sm" class="hidden shrink-0 sm:inline-flex" />
    </template>
    <template #actions>
      <UPopover>
        <UButton :icon="shareMode === 'off' ? 'i-lucide-share-2' : 'i-lucide-globe'" :label="shareMode === 'off' ? 'Share' : 'Shared'" color="neutral" variant="ghost" size="xs" :ui="{ label: 'hidden sm:inline' }" />
        <template #content>
          <div class="w-80 space-y-3 p-3">
            <p class="text-sm font-medium">Share link</p>
            <URadioGroup v-model="shareMode" :items="shareModes" :disabled="shareBusy" @update:model-value="setShare" />
            <div v-if="shareUrl" class="flex gap-2">
              <UInput :model-value="shareUrl" readonly size="sm" class="flex-1" aria-label="Share link" />
              <UButton icon="i-lucide-copy" size="sm" color="neutral" variant="soft" aria-label="Copy link" @click="copyShare" />
            </div>
          </div>
        </template>
      </UPopover>
    </template>
  </EmailEditor>
  <div v-else class="grid h-full place-items-center text-sm text-muted">
    <UIcon v-if="!loadError" name="i-lucide-loader-circle" class="size-5 animate-spin" />
    <span v-else>{{ loadError }}</span>
  </div>
  <EmailTestDialog v-if="template" v-model:open="testOpen" :template="template" />
</template>

<script setup lang="ts">
import type { EmailTemplate } from '~~/server/utils/emails'
import EmailEditor from '~/components/email/EmailEditor.vue'
import EmailTestDialog from '~/components/email/EmailTestDialog.vue'

definePageMeta({ layout: 'bare', middleware: 'agent' })

const id = String(useRoute().params.id)
const { api, token, projects, loadProjects } = useAgent()
const toast = useToast()
const template = ref<EmailTemplate | null>(null)
const loadError = ref('')
const testOpen = ref(false)

const project = computed(() => projects.value.find(p => p.id === template.value?.projectId) || null)
const projectName = computed(() => project.value?.name || '')

onMounted(async () => {
  try {
    const t = (await api<{ template: EmailTemplate }>(`/admin/emails/${id}`)).template
    // A project's link has no design of its own: edit its master instead.
    if (t.masterId) return navigateTo(`/emails/${t.masterId}`, { replace: true })
    template.value = t
    shareMode.value = t.shareMode || 'off'
    shareToken.value = t.shareToken
    if (!projects.value.length) loadProjects().catch(() => {})
  } catch (error: any) {
    loadError.value = error?.message || 'Could not open this template'
  }
})

async function save(patch: Record<string, unknown>) {
  const saved = (await api<{ template: EmailTemplate }>(`/admin/emails/${id}`, { method: 'PATCH', body: patch })).template
  // Keeps the test dialog's values in step with the design.
  if (template.value) Object.assign(template.value, { name: saved.name, variables: saved.variables })
  return saved
}

// ---- sharing -----------------------------------------------------------------
type ShareMode = 'off' | 'view' | 'edit'
const shareMode = ref<ShareMode>('off')
const shareToken = ref<string | null>(null)
const shareBusy = ref(false)
const shareModes = [
  { value: 'off', label: 'Off', description: 'Only operators can open it.' },
  { value: 'view', label: 'Anyone with the link can view', description: 'A rendered preview, no sign-in.' },
  { value: 'edit', label: 'Anyone with the link can edit', description: 'Changes sync live. Share with care.' }
]
const shareUrl = computed(() => shareToken.value && shareMode.value !== 'off' ? `${window.location.origin}/share/emails/${shareToken.value}` : '')

async function setShare(mode: unknown) {
  shareBusy.value = true
  try {
    const res = await api<{ mode: ShareMode, token: string | null }>(`/admin/emails/${id}/share`, { method: 'POST', body: { mode } })
    shareMode.value = res.mode
    shareToken.value = res.token
  } catch (error: any) {
    toast.add({ title: error?.message || 'Could not change sharing', color: 'error' })
  } finally {
    shareBusy.value = false
  }
}

async function copyShare() {
  await navigator.clipboard.writeText(shareUrl.value)
  toast.add({ title: 'Link copied', icon: 'i-lucide-clipboard-check', color: 'success' })
}
</script>
