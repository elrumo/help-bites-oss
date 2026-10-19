<template>
  <!-- Edit link: the full editor, saving through the share token. -->
  <EmailEditor
    v-if="shared?.template"
    :template="editable(shared.template)"
    :save="save"
    :stream-url="`/v1/share/emails/${token}/events`"
  >
    <template #badge>
      <UBadge :label="$t('emailLibrary.share.badge')" icon="i-lucide-globe" color="neutral" variant="soft" size="sm" class="shrink-0" />
    </template>
  </EmailEditor>

  <!-- View link: the email as it renders, nothing else. -->
  <div v-else-if="shared" class="flex h-full flex-col">
    <header class="flex h-12 shrink-0 items-center gap-3 border-b border-default bg-default px-4">
      <UIcon name="i-lucide-mail" class="size-4 text-muted" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">{{ shared.subject || shared.name }}</p>
      </div>
      <UColorModeButton color="neutral" variant="ghost" size="xs" />
    </header>
    <iframe :srcdoc="shared.html" sandbox="" :title="$t('emailLibrary.preview.frameTitle')" class="min-h-0 w-full flex-1 bg-white" />
  </div>

  <div v-else class="grid h-full place-items-center p-6 text-center text-sm text-muted">
    <UIcon v-if="!error" name="i-lucide-loader-circle" class="size-5 animate-spin" />
    <span v-else>{{ error }}</span>
  </div>
</template>

<script setup lang="ts">
import type { EmailTemplate, SharedEmailTemplate } from '~~/server/utils/emails'
import EmailEditor from '~/components/email/EmailEditor.vue'

// No agent middleware: the token in the URL is the credential.
definePageMeta({ layout: 'bare' })

type Shared = { mode: 'view' | 'edit', name: string, subject: string, html: string, template?: SharedEmailTemplate }

const token = String(useRoute().params.token)
const shared = ref<Shared | null>(null)
const error = ref('')
const { t } = useI18n()

onMounted(async () => {
  try {
    shared.value = await $fetch<Shared>(`/v1/share/emails/${token}`)
  } catch (e: any) {
    error.value = e?.data?.statusMessage || t('emailLibrary.share.inactive')
  }
})

// The editor takes a whole template; an edit link carries only the design.
function editable(design: SharedEmailTemplate): EmailTemplate {
  return { id: '', projectId: null, masterId: null, folderId: null, key: '', description: '', variableValues: {}, shareMode: 'edit', shareToken: null, shareExpiresAt: null, lastSharedEdit: null, master: null, ...design }
}

async function save(patch: Record<string, unknown>) {
  const { name: _name, ...design } = patch
  return editable((await $fetch<{ template: SharedEmailTemplate }>(`/v1/share/emails/${token}`, { method: 'PATCH', body: design })).template)
}

useHead({ title: () => shared.value?.name || t('emailLibrary.share.pageTitle'), meta: [{ name: 'robots', content: 'noindex' }] })
</script>
