<template>
  <UModal v-model:open="open" :title="$t('errors.reports.title')" :description="$t('errors.reports.description')" :ui="{ content: 'max-w-3xl' }">
    <template #body>
      <div class="space-y-3">
        <div v-if="loading" class="space-y-3" aria-busy="true"><USkeleton v-for="n in 3" :key="n" class="h-12 w-full" /></div>
        <p v-else-if="!reports.length" class="py-6 text-center text-sm text-muted">{{ $t('errors.reports.empty') }}</p>
        <UCollapsible v-for="report in reports" :key="report.id" class="rounded-lg border border-default">
          <div class="flex items-center gap-2 p-2">
            <UButton color="neutral" variant="ghost" size="sm" class="min-w-0 flex-1 justify-start" trailing-icon="i-lucide-chevron-down" :label="new Date(report.at!).toLocaleString()" />
            <UBadge color="neutral" variant="subtle" size="sm" class="rounded-full">{{ report.source === 'scheduled' ? $t('errors.reports.scheduled') : $t('errors.reports.manual') }}</UBadge>
            <span class="hidden text-xs text-muted sm:inline">{{ $t('errors.reports.errorCount', report.count) }}</span>
            <UButton color="neutral" variant="ghost" size="xs" :icon="copied === report.id ? 'i-lucide-check' : 'i-lucide-copy'" :aria-label="$t('errors.reports.copy')" @click="copy(report)" />
            <UButton color="error" variant="ghost" size="xs" icon="i-lucide-trash-2" :aria-label="$t('errors.reports.delete')" :loading="deleting === report.id" @click="remove(report)" />
          </div>
          <template #content>
            <div class="border-t border-default p-3">
              <MarkdownBlock :text="report.text" />
              <p v-if="report.files.length" class="mt-2 text-xs text-muted">{{ $t('errors.reports.sources', { files: report.files.join(', ') }) }}</p>
            </div>
          </template>
        </UCollapsible>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { ErrorReport } from '~~/server/utils/errorAi'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ projectId: string }>()
// The page shows the latest report, so it hears when that one is deleted.
const emit = defineEmits<{ changed: [latest: ErrorReport | null] }>()
const { api } = useAgent()
const { t } = useI18n()

const reports = ref<ErrorReport[]>([])
const loading = ref(true)
const error = ref('')
const copied = ref('')
const deleting = ref('')

watch(open, async (isOpen) => {
  if (!isOpen) return
  loading.value = true
  error.value = ''
  try { reports.value = (await api<{ reports: ErrorReport[] }>('/admin/errors/reports', { query: { project: props.projectId } })).reports } catch (cause: any) { error.value = cause.message || t('errors.reports.loadFailed') } finally { loading.value = false }
}, { immediate: true })

async function copy(report: ErrorReport) {
  try { await navigator.clipboard.writeText(report.text); copied.value = report.id; setTimeout(() => { if (copied.value === report.id) copied.value = '' }, 1500) } catch {}
}

async function remove(report: ErrorReport) {
  if (!confirm(t('errors.reports.deleteConfirm', { date: new Date(report.at!).toLocaleString() }))) return
  deleting.value = report.id
  error.value = ''
  try {
    await api(`/admin/errors/reports/${encodeURIComponent(report.id)}`, { method: 'DELETE', query: { project: props.projectId } })
    reports.value = reports.value.filter(item => item.id !== report.id)
    emit('changed', reports.value[0] || null)
  } catch (cause: any) { error.value = cause.message || t('errors.reports.deleteFailed') } finally { deleting.value = '' }
}
</script>
