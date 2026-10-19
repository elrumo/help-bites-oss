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
    :master="!template.projectId"
    can-rename
    :on-send-test="() => { testOpen = true }"
  >
    <template #badge>
      <UBadge v-if="!template.projectId" :label="$t('emailLibrary.common.master')" icon="i-lucide-layers" color="primary" variant="soft" size="sm" class="shrink-0" />
      <UBadge v-else-if="projectName" :label="projectName" color="neutral" variant="soft" size="sm" class="hidden shrink-0 sm:inline-flex" />
    </template>
    <template #actions>
      <UPopover>
        <UButton :icon="share.mode === 'off' ? 'i-lucide-share-2' : 'i-lucide-globe'" :label="share.mode === 'off' ? $t('emailLibrary.share.share') : $t('emailLibrary.share.shared')" color="neutral" variant="ghost" size="xs" :ui="{ label: 'hidden sm:inline' }" />
        <template #content>
          <div class="w-80 space-y-3 p-3">
            <p class="text-sm font-medium">{{ $t('emailLibrary.share.link') }}</p>
            <URadioGroup v-model="shareMode" :items="shareModes" :disabled="shareBusy" @update:model-value="pickShareMode" />
            <template v-if="shareUrl">
              <div class="flex gap-2">
                <UInput :model-value="shareUrl" readonly size="sm" class="flex-1" :aria-label="$t('emailLibrary.share.link')" />
                <UButton icon="i-lucide-copy" size="sm" color="neutral" variant="soft" :aria-label="$t('emailLibrary.share.copyLink')" @click="copyShare" />
              </div>
              <div class="flex items-center gap-2">
                <p class="min-w-0 flex-1 text-xs" :class="shareExpired ? 'text-error' : 'text-muted'">{{ shareExpiry }}</p>
                <UButton v-if="shareExpired" :label="$t('emailLibrary.share.renew')" size="xs" color="neutral" variant="soft" :disabled="shareBusy" @click="setShare(share.mode)" />
                <USelect v-model="shareDays" :items="shareDayOptions" :placeholder="$t('emailLibrary.share.setExpiry')" size="xs" class="w-28" :disabled="shareBusy" :aria-label="$t('emailLibrary.share.lifetime')" @update:model-value="setShare(share.mode)" />
              </div>
            </template>
            <p v-if="template.lastSharedEdit" class="text-xs text-muted">
              {{ $t('emailLibrary.share.lastEdited', { when: when(template.lastSharedEdit.at), ip: template.lastSharedEdit.ip || $t('emailLibrary.share.unknownAddress') }) }}
            </p>
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
const { t } = useI18n()
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
    share.value = { mode: t.shareMode || 'off', token: t.shareToken, expiresAt: t.shareExpiresAt }
    shareMode.value = share.value.mode
    if (!projects.value.length) loadProjects().catch(() => {})
  } catch (error: any) {
    loadError.value = error?.message || t('emailLibrary.editor.openError')
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
type ShareState = { mode: ShareMode, token: string | null, expiresAt: number | null }
// `share` is what the server holds; the radio's `shareMode` goes back to it when a change is refused.
const share = ref<ShareState>({ mode: 'off', token: null, expiresAt: null })
const shareMode = ref<ShareMode>('off')
// Unset: the server's default for the mode (7 days to edit, 30 to view).
const shareDays = ref<number>()
const shareBusy = ref(false)
const shareModes = computed(() => [
  { value: 'off', label: t('emailLibrary.share.modeOff'), description: t('emailLibrary.share.modeOffDescription') },
  { value: 'view', label: t('emailLibrary.share.modeView'), description: t('emailLibrary.share.modeViewDescription') },
  { value: 'edit', label: t('emailLibrary.share.modeEdit'), description: t('emailLibrary.share.modeEditDescription') }
])
const shareDayOptions = computed(() => [1, 7, 30, 90].map(days => ({ label: t('emailLibrary.share.days', days), value: days })))
const when = (at: number | string) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const shareUrl = computed(() => share.value.token && share.value.mode !== 'off' ? `${window.location.origin}/share/emails/${share.value.token}` : '')
// A link shared before links expired has no date; the server treats it as expired.
const shareExpired = computed(() => !share.value.expiresAt || share.value.expiresAt <= Date.now())
const shareExpiry = computed(() => share.value.expiresAt
  ? (shareExpired.value ? t('emailLibrary.share.expiredOn', { date: when(share.value.expiresAt) }) : t('emailLibrary.share.expiresOn', { date: when(share.value.expiresAt) }))
  : t('emailLibrary.share.expiredRenew'))

function pickShareMode(mode: unknown) {
  shareDays.value = undefined
  setShare(mode as ShareMode)
}

async function setShare(mode: ShareMode) {
  shareBusy.value = true
  try {
    const body = { mode, ...(shareDays.value ? { expiresInDays: shareDays.value } : {}) }
    share.value = await api<ShareState>(`/admin/emails/${id}/share`, { method: 'POST', body })
  } catch (error: any) {
    toast.add({ title: error?.message || t('emailLibrary.share.changeError'), color: 'error' })
  } finally {
    shareMode.value = share.value.mode
    shareBusy.value = false
  }
}

async function copyShare() {
  await navigator.clipboard.writeText(shareUrl.value)
  toast.add({ title: t('emailLibrary.share.copied'), icon: 'i-lucide-clipboard-check', color: 'success' })
}
</script>
