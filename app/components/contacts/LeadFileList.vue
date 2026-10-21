<template>
  <div v-if="files.length || loading" class="space-y-2">
    <slot name="title" />
    <p v-if="loading && !files.length" class="text-xs text-dimmed">{{ $t('projectTools.forms.files.loading') }}</p>
    <ul v-else class="divide-y divide-default rounded-lg border border-default">
      <li v-for="file in files" :key="file.id" class="flex items-center gap-2 px-3 py-2 text-[13px]">
        <UIcon :name="file.mime.startsWith('image/') ? 'i-lucide-image' : 'i-lucide-file'" class="size-4 shrink-0 text-muted" />
        <span class="min-w-0 flex-1 truncate">
          {{ file.name }}
          <span class="text-xs text-muted"> · {{ labelFor(file.field) }} · {{ size(file.size) }}</span>
        </span>
        <span class="text-xs text-muted">{{ logTime(file.createdAt || '') }}</span>
        <UButton icon="i-lucide-download" size="xs" color="neutral" variant="ghost" square :loading="busy === file.id" :aria-label="$t('projectTools.forms.files.download')" @click="download(file)" />
        <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.forms.files.delete')" @click="remove(file)" />
      </li>
    </ul>
    <p v-if="error" class="text-xs text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import type { LeadFile, LeadFormField } from '#shared/leadForms'
import { logTime } from '~/utils/emailStatus'

// Files people sent through a lead form's file fields: one person's (contact)
// or one form's. They are private: the download goes through the API with the
// operator's session, never by a public link.

const props = defineProps<{ projectId: string, contact?: string, form?: string, fields?: LeadFormField[] }>()

const { api, agentHeaders } = useAgent()
const { t } = useI18n()
const files = ref<LeadFile[]>([])
const loading = ref(false)
const busy = ref('')
const error = ref('')

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
const labelFor = (key: string) => props.fields?.find(f => f.key === key)?.label || key

async function load() {
  if (!props.contact && !props.form) return
  loading.value = true
  try {
    files.value = (await api<{ files: LeadFile[] }>('/admin/lead-files', { query: { project: props.projectId, contact: props.contact || undefined, form: props.form || undefined, limit: 20 } })).files
  } catch {
    files.value = []
  } finally {
    loading.value = false
  }
}

async function download(file: LeadFile) {
  busy.value = file.id
  error.value = ''
  try {
    const blob = await $fetch<Blob>(`/v1/admin/lead-files/${file.id}/download`, { headers: agentHeaders(), responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    URL.revokeObjectURL(url)
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || t('projectTools.forms.files.downloadError')
  } finally {
    busy.value = ''
  }
}

async function remove(file: LeadFile) {
  if (!confirm(t('projectTools.forms.files.deleteConfirm', { name: file.name }))) return
  error.value = ''
  try {
    await api(`/admin/lead-files/${file.id}`, { method: 'DELETE' })
    files.value = files.value.filter(f => f.id !== file.id)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.forms.files.deleteError')
  }
}

watch(() => [props.projectId, props.contact, props.form], load, { immediate: true })
</script>
