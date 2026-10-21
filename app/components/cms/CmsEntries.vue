<script setup lang="ts">
/** The project's entries (pages and its own entry types), newest edit first. */
import type { CmsEntryView } from '~~/server/utils/cms'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ (e: 'new'): void }>()

const { api } = useAgent()
const { t } = useI18n()
const appUrl = useAppUrl()
const entries = ref<CmsEntryView[]>([])
const loading = ref(true)
const error = ref('')
const query = ref('')
const type = ref('all')

const types = computed(() => ['all', ...new Set(entries.value.map(e => e.type))])
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return entries.value.filter(e => (type.value === 'all' || e.type === type.value) && (!q || e.name.toLowerCase().includes(q) || e.slug.includes(q)))
})
const when = (at: string | null) => at ? new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' }) : ''

async function remove(entry: CmsEntryView) {
  if (!confirm(t('projectTools.pages.deleteEntryConfirm', { name: entry.name }))) return
  try {
    await api(`/admin/cms/entries/${entry.id}`, { method: 'DELETE' })
    entries.value = entries.value.filter(e => e.id !== entry.id)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pages.deleteError')
  }
}

onMounted(async () => {
  try {
    entries.value = (await api<{ entries: CmsEntryView[] }>('/admin/cms/entries', { query: { project: props.projectId } })).entries
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pages.loadError')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="space-y-4">
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
    <div v-if="loading" class="space-y-2"><USkeleton v-for="n in 3" :key="n" class="h-14 w-full" /></div>

    <EmptyState v-else-if="!entries.length && !error" icon="i-lucide-layout-template" :title="$t('projectTools.pages.emptyTitle')" :description="$t('projectTools.pages.emptyDescription')" class="rounded-xl border border-dashed border-default">
      <UButton icon="i-lucide-plus" :label="$t('projectTools.pages.newPage')" @click="emit('new')" />
    </EmptyState>

    <template v-else-if="entries.length">
      <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="query" icon="i-lucide-search" :placeholder="$t('projectTools.pages.search')" size="sm" class="min-w-0 flex-1 basis-48" />
        <USelect v-if="types.length > 2" v-model="type" :items="types.map(v => ({ label: v === 'all' ? $t('projectTools.pages.allTypes') : v, value: v }))" size="sm" class="w-40" />
      </div>
      <ul class="divide-y divide-default overflow-hidden rounded-xl border border-default">
        <li v-for="entry in shown" :key="entry.id" class="group flex items-center gap-2 pe-2 transition-colors hover:bg-elevated/60">
          <NuxtLink :to="`/projects/${projectId}/pages/${entry.id}`" class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div class="min-w-0 flex-1 basis-60">
              <p class="truncate text-[13px] font-medium text-highlighted">{{ entry.name }}</p>
              <p class="truncate font-mono text-xs text-muted">/{{ entry.slug === 'home' ? '' : entry.slug }}<span v-if="entry.type !== 'page'" class="ms-2 text-dimmed">{{ entry.type }}</span></p>
            </div>
            <span class="text-xs tabular-nums text-dimmed">{{ when(entry.updatedAt) }}</span>
            <UBadge v-if="entry.changed" :label="$t('projectTools.pages.unpublishedChanges')" color="warning" variant="soft" size="sm" />
            <UBadge :label="entry.status === 'published' ? $t('projectTools.pages.publishedVersion', { version: entry.version }) : $t('projectTools.pages.draft')" :color="entry.status === 'published' ? 'success' : 'neutral'" variant="soft" size="sm" />
          </NuxtLink>
          <UButton v-if="entry.status === 'published'" icon="i-lucide-external-link" size="xs" color="neutral" variant="ghost" square :to="`${appUrl}${entry.path}`" target="_blank" :aria-label="$t('projectTools.pages.openLive')" />
          <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square class="opacity-0 group-hover:opacity-100 focus:opacity-100" :aria-label="$t('projectTools.pages.delete')" @click="remove(entry)" />
        </li>
      </ul>
    </template>
  </div>
</template>
