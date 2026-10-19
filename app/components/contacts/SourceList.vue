<script setup lang="ts">
/**
 * The databases a project's contacts sync from: your Parse server, Postgres
 * or Supabase, or Firestore. Read only and one way; each source runs on its
 * schedule and remembers where it stopped.
 */
import type { AdminProject } from '~~/server/utils/projects'
import type { ContactSourceDto } from '~~/server/utils/contactSources'
import ContactsTabs from '~/components/contacts/ContactsTabs.vue'
import SourceForm from '~/components/contacts/SourceForm.vue'
import { logTime } from '~/utils/emailStatus'

const props = defineProps<{ project: AdminProject }>()

const { api } = useAgent()
const toast = useToast()
const { t } = useI18n()

const sources = ref<ContactSourceDto[]>([])
const kinds = ref<{ kind: string, label: string }[]>([])
const loading = ref(true)

async function load() {
  try {
    const res = await api<{ sources: ContactSourceDto[], kinds: { kind: string, label: string }[] }>('/admin/contact-sources', { query: { project: props.project.id } })
    sources.value = res.sources
    kinds.value = res.kinds
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.sources.loadError'), color: 'error' })
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  load()
  // A running sync updates its counts as it goes.
  timer = setInterval(() => { if (sources.value.some(s => s.status === 'running')) load() }, 3000)
})
onBeforeUnmount(() => clearInterval(timer))

const formOpen = ref(false)
const editing = ref<ContactSourceDto | null>(null)
function openForm(source: ContactSourceDto | null) {
  editing.value = source
  formOpen.value = true
}

async function run(source: ContactSourceDto, reset = false) {
  try {
    const res = await api<{ source: ContactSourceDto }>(`/admin/contact-sources/${source.id}/run`, { method: 'POST', body: { project: props.project.id, reset } })
    Object.assign(source, res.source)
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.sources.syncError'), color: 'error' })
  }
}

async function toggle(source: ContactSourceDto) {
  try {
    const res = await api<{ source: ContactSourceDto }>(`/admin/contact-sources/${source.id}`, { method: 'PATCH', body: { project: props.project.id, enabled: !source.enabled } })
    Object.assign(source, res.source)
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.sources.changeError'), color: 'error' })
  }
}

async function remove(source: ContactSourceDto) {
  if (!window.confirm(t('contacts.sources.deleteConfirm', { name: source.name }))) return
  try {
    await api(`/admin/contact-sources/${source.id}`, { method: 'DELETE', query: { project: props.project.id } })
    sources.value = sources.value.filter(s => s.id !== source.id)
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.sources.deleteError'), color: 'error' })
  }
}

const KIND_ICON: Record<string, string> = { parse: 'i-lucide-server', postgres: 'i-lucide-database', firestore: 'i-lucide-flame' }
const every = (minutes: number) => (!minutes ? t('contacts.sources.manual') : minutes < 60 ? t('contacts.sources.everyMinutes', { n: minutes }) : minutes === 60 ? t('contacts.sources.hourly') : minutes === 1440 ? t('contacts.sources.daily') : t('contacts.sources.everyHours', { n: minutes / 60 }))
const what = (s: ContactSourceDto) => s.config.className || s.config.table || s.config.collection || ''
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project.id" :title="$t('contacts.title')">
      <template #title><ContactsTabs current="sources" /></template>
      <template #actions>
        <UButton icon="i-lucide-plus" :label="$t('contacts.sources.connect')" size="sm" @click="openForm(null)" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="space-y-1 p-4"><USkeleton v-for="i in 3" :key="i" class="h-16" /></div>
      <EmptyState v-else-if="!sources.length" icon="i-lucide-database" :title="$t('contacts.sources.emptyTitle')" :description="$t('contacts.sources.emptyDescription')" />
      <ul v-else class="space-y-2 p-4" :aria-label="$t('contacts.sources.listLabel')">
        <li v-for="s in sources" :key="s.id" class="rounded-lg border border-default p-3 text-[13px]">
          <div class="flex items-center gap-3">
            <UIcon :name="KIND_ICON[s.kind] || 'i-lucide-database'" class="size-5 shrink-0 text-muted" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium text-highlighted">{{ s.name }}</p>
              <p class="truncate text-xs text-muted">{{ kinds.find(k => k.kind === s.kind)?.label }} · {{ what(s) }} · {{ every(s.config.everyMinutes) }}<span v-if="!s.config.updatedField"> · {{ $t('contacts.sources.fullScan') }}</span></p>
            </div>
            <UBadge v-if="!s.enabled" :label="$t('contacts.sources.paused')" color="neutral" variant="subtle" size="sm" />
            <UBadge v-else-if="s.status === 'running'" :label="$t('contacts.sources.syncing')" icon="i-lucide-refresh-cw" color="info" variant="subtle" size="sm" />
            <UBadge v-else-if="s.status === 'error'" :label="$t('contacts.sources.failing')" icon="i-lucide-triangle-alert" color="error" variant="subtle" size="sm" />
            <UBadge v-else :label="$t('contacts.sources.upToDate')" color="success" variant="subtle" size="sm" />
            <UDropdownMenu :items="[[{ label: $t('contacts.sources.syncNow'), icon: 'i-lucide-refresh-cw', onSelect: () => run(s) }, { label: $t('contacts.sources.readAgain'), icon: 'i-lucide-rotate-ccw', onSelect: () => run(s, true) }], [{ label: $t('contacts.sources.edit'), icon: 'i-lucide-pencil', onSelect: () => openForm(s) }, { label: s.enabled ? $t('contacts.sources.pause') : $t('contacts.sources.resume'), icon: s.enabled ? 'i-lucide-pause' : 'i-lucide-play', onSelect: () => toggle(s) }], [{ label: $t('contacts.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove(s) }]]">
              <UButton icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" square :aria-label="$t('contacts.sources.actions')" />
            </UDropdownMenu>
          </div>
          <p v-if="s.lastError" class="mt-2 rounded bg-error/10 px-2 py-1 font-mono text-xs text-error">{{ s.lastError }}</p>
          <dl class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <div><dt class="inline">{{ $t('contacts.sources.read') }} </dt><dd class="inline tabular-nums text-default">{{ s.stats.seen.toLocaleString() }}</dd></div>
            <div><dt class="inline">{{ $t('contacts.sources.new') }} </dt><dd class="inline tabular-nums text-default">{{ s.stats.created.toLocaleString() }}</dd></div>
            <div><dt class="inline">{{ $t('contacts.sources.updated') }} </dt><dd class="inline tabular-nums text-default">{{ s.stats.updated.toLocaleString() }}</dd></div>
            <div v-if="s.stats.skipped"><dt class="inline">{{ $t('contacts.sources.skipped') }} </dt><dd class="inline tabular-nums text-default" :title="$t('contacts.sources.skippedTitle')">{{ s.stats.skipped.toLocaleString() }}</dd></div>
            <div v-if="s.stats.failed"><dt class="inline">{{ $t('contacts.sources.failed') }} </dt><dd class="inline tabular-nums text-error">{{ s.stats.failed.toLocaleString() }}</dd></div>
            <div v-if="s.lastRunAt"><dt class="inline">{{ $t('contacts.sources.lastRun') }} </dt><dd class="inline">{{ logTime(s.lastRunAt) }}</dd></div>
            <div v-if="s.position"><dt class="inline">{{ $t('contacts.sources.upTo') }} </dt><dd class="inline font-mono">{{ s.position.slice(0, 32) }}</dd></div>
          </dl>
        </li>
      </ul>
    </div>

    <SourceForm v-model:open="formOpen" :project="project" :kinds="kinds" :source="editing" @saved="load" />
  </div>
</template>
