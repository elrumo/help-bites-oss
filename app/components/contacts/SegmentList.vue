<script setup lang="ts">
/**
 * Saved filters over a project's contacts. Each one is an audience for a
 * campaign, a filter on the people list, and `?segment=` on the API.
 */
import { EMPTY_SEGMENT, type ContactSegment, type SegmentFilter } from '#shared/segments'
import type { AdminProject } from '~~/server/utils/projects'
import ContactsTabs from '~/components/contacts/ContactsTabs.vue'
import SegmentBuilder from '~/components/contacts/SegmentBuilder.vue'

const props = defineProps<{ project: AdminProject }>()

const { api } = useAgent()
const toast = useToast()

const segments = ref<ContactSegment[]>([])
const counts = ref<Record<string, number>>({})
const loading = ref(true)

async function load() {
  try {
    const res = await api<{ segments: ContactSegment[] }>('/segments', { query: { project: props.project.id } })
    segments.value = res.segments
    for (const s of res.segments) {
      api<{ count: number }>('/segments/preview', { method: 'POST', body: { project: props.project.id, segment: s.id } }).then(r => { counts.value[s.id] = r.count }).catch(() => {})
    }
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not load segments', color: 'error' })
  } finally {
    loading.value = false
  }
}
onMounted(load)

const editOpen = ref(false)
const editing = ref<ContactSegment | null>(null)
const name = ref('')
const filter = ref<SegmentFilter>(structuredClone(EMPTY_SEGMENT))
const saving = ref(false)

function edit(segment: ContactSegment | null) {
  editing.value = segment
  name.value = segment?.name || ''
  filter.value = structuredClone(segment ? toRaw(segment.filter) : EMPTY_SEGMENT)
  editOpen.value = true
}

async function save() {
  saving.value = true
  try {
    const body = { project: props.project.id, name: name.value, filter: filter.value }
    if (editing.value) await api(`/segments/${editing.value.id}`, { method: 'PATCH', body })
    else await api('/segments', { method: 'POST', body })
    editOpen.value = false
    await load()
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not save the segment', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function remove(segment: ContactSegment) {
  if (!window.confirm(`Delete the segment "${segment.name}"? Its contacts stay.`)) return
  try {
    await api(`/segments/${segment.id}`, { method: 'DELETE', query: { project: props.project.id } })
    segments.value = segments.value.filter(s => s.id !== segment.id)
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not delete it', color: 'error' })
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project.id" title="Contacts">
      <template #title><ContactsTabs current="segments" /></template>
      <template #actions>
        <UButton icon="i-lucide-plus" label="New segment" size="sm" @click="edit(null)" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="space-y-1 p-4"><USkeleton v-for="i in 4" :key="i" class="h-11" /></div>
      <EmptyState v-else-if="!segments.length" icon="i-lucide-filter" title="No segments yet" description="Group contacts by what you know about them — plan, tags, when they were last seen — then email exactly that group." />
      <ul v-else class="py-2" aria-label="Segments">
        <li v-for="s in segments" :key="s.id" class="group mx-2 flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] hover:bg-elevated">
          <button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="edit(s)">
            <UIcon name="i-lucide-filter" class="size-4 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate font-medium text-highlighted">{{ s.name }}</span>
            <span class="text-xs text-muted">{{ s.filter.rules.length }} rule{{ s.filter.rules.length === 1 ? '' : 's' }}</span>
            <span class="w-24 text-right text-xs tabular-nums text-muted">{{ counts[s.id] === undefined ? '…' : `${counts[s.id]!.toLocaleString()} people` }}</span>
          </button>
          <UTooltip text="Show these people"><UButton icon="i-lucide-users" size="xs" color="neutral" variant="ghost" square :to="{ query: { segment: s.id } }" aria-label="Show these people" /></UTooltip>
          <UTooltip text="Delete"><UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square class="text-muted opacity-60 group-hover:opacity-100" aria-label="Delete segment" @click="remove(s)" /></UTooltip>
        </li>
      </ul>
    </div>

    <UModal v-model:open="editOpen" :title="editing ? 'Edit segment' : 'New segment'" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="save">
          <UFormField label="Name"><UInput v-model="name" placeholder="Pro users seen this month" class="w-full" autofocus /></UFormField>
          <SegmentBuilder v-if="editOpen" v-model="filter" :project-id="project.id" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="editOpen = false">Cancel</UButton>
            <UButton type="submit" :loading="saving" :disabled="!name.trim()">Save</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
