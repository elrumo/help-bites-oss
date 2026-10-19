<template>
  <div class="flex-1 min-h-0 flex flex-col">
    <PageHeader :project-id="id" title="Changelog">
      <template #title>
        <span v-if="!loading && !error" class="ml-1 hidden text-xs font-normal tabular-nums text-muted sm:inline">{{ publicCount }} public, {{ draftCount }} {{ draftCount === 1 ? 'draft' : 'drafts' }}</span>
      </template>
      <template #actions>
        <UButton icon="i-lucide-sparkles" label="Public changelog" color="neutral" variant="ghost" size="sm" @click="copyChangelogUrl" />
        <UButton v-if="changelogReady" icon="i-lucide-external-link" color="neutral" variant="ghost" size="sm" square :to="changelogUrl" target="_blank" aria-label="Open the public changelog" />
        <UButton icon="i-lucide-settings-2" label="Settings" color="neutral" variant="ghost" size="sm" @click="showSettings = true" />
        <UButton icon="i-lucide-package-plus" label="New release" color="neutral" variant="soft" size="sm" @click="openNewRelease" />
        <UButton icon="i-lucide-plus" label="New entry" size="sm" @click="openNewEntry" />
      </template>
    </PageHeader>

    <div v-if="error" class="p-8 text-sm text-error">{{ error }}</div>
    <div v-else-if="loading" class="space-y-2 p-4"><USkeleton v-for="i in 4" :key="i" class="h-16" /></div>

    <div v-else class="flex-1 min-h-0 overflow-y-auto">
      <div class="mx-auto max-w-4xl space-y-8 px-4 py-4 md:px-6">
        <p v-if="project && !changelogReady" class="rounded-lg border border-default bg-elevated px-3 py-2 text-[13px] text-muted">
          The public changelog is published through the feedback board: turn it on, with its Changelog option, under
          <NuxtLink :to="`/projects/${id}/feedback`" class="font-medium text-default underline underline-offset-2">Feedback → Settings</NuxtLink>.
        </p>

        <EmptyState v-if="!entries.length && !releases.length" icon="i-lucide-sparkles" title="Nothing here yet" description="Write what shipped, in your own words, and group it into releases. Entries stay private until you publish them; link the posts, board items, tickets and errors they come from so you can see what is done.">
          <UButton icon="i-lucide-plus" label="New entry" @click="openNewEntry" />
        </EmptyState>

        <section v-for="group in groups" :key="group.key" class="space-y-2">
          <header class="flex flex-wrap items-center gap-2">
            <template v-if="group.release">
              <h2 class="text-sm font-semibold">{{ group.release.version }}<span v-if="group.release.title" class="font-normal text-muted"> · {{ group.release.title }}</span></h2>
              <span class="rounded-full px-1.5 text-[11px]" :class="group.release.status === 'published' ? 'bg-success/10 text-success' : 'bg-elevated text-toned'">{{ group.release.status === 'published' ? 'Published' : 'Draft' }}</span>
              <time v-if="group.release.publishedAt" class="text-xs text-muted" :datetime="group.release.publishedAt">{{ shortDate(group.release.publishedAt) }}</time>
              <span class="ml-auto flex items-center gap-1">
                <UButton v-if="group.release.status === 'draft'" label="Publish release" icon="i-lucide-rocket" size="xs" color="primary" variant="soft" :loading="publishing === group.release.id" @click="publishRelease(group.release)" />
                <UButton icon="i-lucide-pencil" size="xs" color="neutral" variant="ghost" square :aria-label="`Edit release ${group.release.version}`" @click="openRelease(group.release)" />
              </span>
            </template>
            <h2 v-else class="text-sm font-semibold">No release</h2>
          </header>
          <ul class="divide-y divide-default rounded-lg border border-default">
            <li v-for="entry in group.entries" :key="entry.id">
              <button type="button" class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-elevated" @click="openEntry(entry.id)">
                <span class="w-16 shrink-0 rounded-full px-1.5 text-center text-[11px] font-semibold" :class="CHANGELOG_TAG_CLASS[entry.tag]">{{ CHANGELOG_TAG_LABELS[entry.tag] }}</span>
                <span v-if="entry.number" class="shrink-0 tabular-nums text-muted">#{{ entry.number }}</span>
                <span class="min-w-0 flex-1 truncate">{{ entry.title }}</span>
                <span v-if="entry.sources.length" class="inline-flex shrink-0 items-center gap-1 text-xs text-muted" :title="`${entry.sources.filter(s => s.done).length} of ${entry.sources.length} linked items are done`"><UIcon name="i-lucide-link" class="size-3" />{{ entry.sources.filter(s => s.done).length }}/{{ entry.sources.length }}</span>
                <span class="shrink-0 rounded-full px-1.5 text-[11px]" :class="STATE_CLASS[stateOf(entry).key]">{{ stateOf(entry).label }}</span>
              </button>
            </li>
            <li v-if="!group.entries.length" class="px-3 py-2.5 text-xs text-muted">No entries yet. Add one and choose this release.</li>
          </ul>
        </section>
      </div>
    </div>

    <!-- Entry editor -->
    <USlideover v-model:open="entryOpen" :title="current ? (current.number ? `Entry #${current.number}` : 'Entry') : 'New entry'" :description="current ? `Created ${timeAgo(current.createdAt)}` : 'A draft until you publish it'" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <div class="space-y-6">
          <div class="space-y-2">
            <UInput v-model="draft.title" placeholder="What changed" variant="none" size="xl" class="w-full" :ui="{ base: 'px-0 text-lg font-semibold' }" :maxlength="200" aria-label="Title" @blur="saveText('title')" @keydown.enter.prevent="saveText('title')" />
            <UTextarea v-model="draft.body" placeholder="Say it the way your users would. Markdown. This text is public once published." variant="none" :rows="4" autoresize :maxrows="18" class="w-full" :ui="{ base: 'px-0' }" aria-label="Text" @blur="saveText('body')" />
          </div>

          <section class="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <UInput v-model="draft.summary" placeholder="Summary: one line for list cards" size="sm" class="w-full sm:col-span-2" :maxlength="300" aria-label="Summary" @blur="saveField('summary')" />
            <UInput v-if="current" v-model="draft.slug" placeholder="slug" size="sm" class="w-full" :maxlength="120" aria-label="Slug" :ui="{ base: 'font-mono text-xs' }" @blur="saveField('slug')" />
            <UInput v-model="draft.area" :placeholder="project?.changelog.areas?.length ? `Area: ${project.changelog.areas.join(', ')}` : 'Area (optional)'" size="sm" class="w-full" :maxlength="40" aria-label="Area" @blur="saveField('area')" />
          </section>

          <section class="grid gap-x-4 sm:grid-cols-2">
            <USelect v-model="draft.tag" :items="tagItems" variant="ghost" size="sm" class="w-full" :ui="property" aria-label="Type" @update:model-value="patch({ tag: draft.tag })">
              <template #leading><UIcon name="i-lucide-tag" class="size-3.5 text-dimmed" /></template>
            </USelect>
            <USelect v-model="draft.releaseId" :items="releaseItems" variant="ghost" size="sm" class="w-full" :ui="property" aria-label="Release" @update:model-value="patch({ releaseId: draft.releaseId === NO_RELEASE ? null : draft.releaseId })">
              <template #leading><UIcon name="i-lucide-package" class="size-3.5 text-dimmed" /></template>
            </USelect>
            <USelect v-model="draft.status" :items="statusItems" variant="ghost" size="sm" class="w-full" :ui="property" aria-label="Status" @update:model-value="patch({ status: draft.status })">
              <template #leading><span class="size-2.5 rounded-full" :class="draft.status === 'published' ? 'bg-emerald-500' : 'bg-stone-400'" /></template>
            </USelect>
            <label class="group relative flex h-8 items-center rounded-md ps-8 pe-2 text-[13px] text-default hover:bg-elevated" :class="current ? '' : 'pointer-events-none opacity-50'">
              <UIcon name="i-lucide-calendar" class="absolute left-2.5 size-3.5 text-dimmed" />
              <input v-model="draft.date" type="date" class="w-full bg-transparent outline-none [color-scheme:light] dark:[color-scheme:dark]" :class="draft.date ? '' : 'text-dimmed'" aria-label="Date" :disabled="!current" @change="patch({ publishedAt: draft.date ? `${draft.date}T12:00:00.000Z` : null })">
            </label>
          </section>

          <section v-if="current && current.status === 'draft' && current.reviewStatus" class="space-y-2 rounded-lg border border-default bg-elevated px-3 py-2">
            <p class="text-xs text-muted">
              <span class="font-medium text-default">{{ current.reviewStatus === 'rejected' ? 'Sent back' : 'Waiting for review' }}</span>
              <template v-if="current.reviewedBy"> · {{ current.reviewedBy }}<template v-if="current.reviewNotes">: {{ current.reviewNotes }}</template></template>
            </p>
            <div class="flex items-center gap-2">
              <UInput v-model="reviewNotes" placeholder="Notes (optional)" size="sm" class="min-w-0 flex-1" :maxlength="2000" aria-label="Review notes" />
              <UButton label="Reject" size="sm" color="neutral" variant="soft" :loading="reviewing === 'reject'" @click="review('reject')" />
              <UButton label="Approve and publish" size="sm" color="primary" :loading="reviewing === 'approve'" @click="review('approve')" />
            </div>
          </section>

          <p v-if="current && stateOf(current).key === 'waiting'" class="rounded-lg border border-default bg-elevated px-3 py-2 text-xs text-muted">Not public yet: its release is still a draft. Publish the release and it goes out with it.</p>

          <template v-if="current">
            <section class="space-y-2">
              <h3 class="flex items-center gap-2 text-sm font-semibold">Made from <span class="font-normal text-muted">{{ current.sources.length }}</span></h3>
              <ul v-if="current.sources.length" class="divide-y divide-default rounded-lg border border-default">
                <li v-for="source in current.sources" :key="`${source.kind}:${source.id}`" class="group flex items-center gap-2 px-2.5 py-2 text-[13px]">
                  <UIcon :name="SOURCE_ICON[source.kind]" class="size-3.5 shrink-0 text-muted" :aria-label="SOURCE_LABEL[source.kind]" />
                  <NuxtLink v-if="sourceLink(source)" :to="sourceLink(source)!" class="min-w-0 flex-1 truncate hover:underline"><span v-if="source.number" class="mr-1 tabular-nums text-muted">#{{ source.number }}</span>{{ source.label || SOURCE_LABEL[source.kind] }}</NuxtLink>
                  <span v-else class="min-w-0 flex-1 truncate"><span v-if="source.number" class="mr-1 tabular-nums text-muted">#{{ source.number }}</span>{{ source.label || SOURCE_LABEL[source.kind] }}</span>
                  <span class="shrink-0 rounded-full px-1.5 text-[11px]" :class="source.done ? 'bg-success/10 text-success' : 'bg-elevated text-toned'">{{ source.done ? 'Done' : source.status || 'Open' }}</span>
                  <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :aria-label="`Unlink ${source.label}`" @click="setLink(source.kind, source.id, false)" />
                </li>
              </ul>
              <form class="flex gap-2" @submit.prevent="addSource">
                <USelect v-model="sourceKind" :items="sourceKindItems" size="sm" class="w-36" aria-label="Kind" />
                <UInput v-model="sourceRef" size="sm" class="w-32" placeholder="#12" aria-label="Number" />
                <UButton type="submit" label="Link" size="sm" color="neutral" variant="soft" :disabled="!sourceRef.trim()" :loading="linking" />
              </form>
              <p class="text-xs text-muted">Tickets and errors link from the inbox: open one and use the Changelog section. Nothing is copied from what you link.</p>
            </section>
          </template>

          <p v-if="entryError" class="text-sm text-error">{{ entryError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full items-center gap-2">
          <UButton v-if="current" :label="confirmDelete ? 'Click again to delete' : 'Delete'" icon="i-lucide-trash-2" :color="confirmDelete ? 'error' : 'neutral'" :variant="confirmDelete ? 'solid' : 'ghost'" @click="deleteEntry" />
          <span v-if="current" class="ml-auto text-xs text-muted">{{ savingEntry ? 'Saving…' : 'Changes save as you go' }}</span>
          <template v-else>
            <UButton class="ml-auto" label="Cancel" color="neutral" variant="ghost" @click="entryOpen = false" />
            <UButton label="Create draft" color="primary" :loading="savingEntry" :disabled="!draft.title.trim()" @click="createEntry" />
          </template>
        </div>
      </template>
    </USlideover>

    <!-- Settings -->
    <USlideover v-model:open="showSettings" title="Changelog settings" description="How entries get started." :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-4">
          <USwitch :model-value="project?.changelog.autoDraft || false" label="Draft entries automatically" description="A feedback post or board item reaching a done status gets a draft entry, unless one already links it. Drafts are never published for you. Tickets and errors are always added by hand." @update:model-value="saveSettings({ autoDraft: $event })" />
          <USwitch :model-value="project?.changelog.comments || false" label="Comments" description="Signed-in readers can comment on published entries. Your site sends their identity token; admins can hide or delete any comment." @update:model-value="saveSettings({ comments: $event })" />
          <USwitch :model-value="project?.changelog.notify || false" label="Email subscribers" description="Readers can ask for an email when something ships (as it happens, or weekly on Monday). Needs CHANGELOG_LINK_SECRET on the server, and ENABLE_CHANGELOG_NOTIFY=true for the scheduler to send." @update:model-value="saveSettings({ notify: $event })" />
          <USwitch :model-value="project?.changelog.enabled || false" label="Public without the feedback board" description="Serve the changelog page, JSON and RSS even when the feedback board is off. Off, they follow the board's Changelog option." @update:model-value="saveSettings({ enabled: $event })" />
          <p class="text-xs text-muted">{{ savingSettings ? 'Saving…' : settingsSaved ? 'Saved' : 'Saves as you change it' }}</p>
          <p v-if="settingsError" class="text-sm text-error">{{ settingsError }}</p>
          <p class="text-xs text-muted">Unless you turn that on, whether the changelog is public, and its page and RSS feed, follow the feedback board's <NuxtLink :to="`/projects/${id}/feedback`" class="underline underline-offset-2">Changelog option</NuxtLink>.</p>
        </div>
      </template>
    </USlideover>

    <!-- Release editor -->
    <USlideover v-model:open="releaseOpen" :title="releaseDraft.id ? `Release ${releaseDraft.version}` : 'New release'" description="A version that groups entries. Nothing in it is public until the release is." :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="saveRelease">
          <UFormField label="Version" required hint="Free text: 2.4, 2026.10…">
            <UInput v-model="releaseDraft.version" class="w-full" :maxlength="60" placeholder="2.4" />
          </UFormField>
          <UFormField label="Title" hint="Optional headline">
            <UInput v-model="releaseDraft.title" class="w-full" :maxlength="200" placeholder="The autumn release" />
          </UFormField>
          <UFormField label="Summary" hint="Optional intro, Markdown">
            <UTextarea v-model="releaseDraft.summary" :rows="3" autoresize :maxrows="12" class="w-full" :maxlength="2000" />
          </UFormField>
          <p v-if="releaseError" class="text-sm text-error">{{ releaseError }}</p>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full items-center gap-2">
          <UButton v-if="releaseDraft.id" :label="confirmDeleteRelease ? 'Click again to delete' : 'Delete'" icon="i-lucide-trash-2" :color="confirmDeleteRelease ? 'error' : 'neutral'" :variant="confirmDeleteRelease ? 'solid' : 'ghost'" @click="deleteRelease" />
          <UButton class="ml-auto" label="Cancel" color="neutral" variant="ghost" @click="releaseOpen = false" />
          <UButton :label="releaseDraft.id ? 'Save' : 'Create release'" color="primary" :loading="savingRelease" :disabled="!releaseDraft.version.trim()" @click="saveRelease" />
        </div>
      </template>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import { CHANGELOG_TAGS, CHANGELOG_TAG_LABELS, isEntryPublic, type ChangelogEntry, type ChangelogLinkKind, type ChangelogRelease, type ChangelogSource, type ChangelogStatus, type ChangelogTag } from '#shared/changelog'
import type { AdminProject } from '~~/server/utils/projects'

// A project's changelog: entries (what shipped, in your own words) grouped into
// releases, each linked to the posts, board items, tickets and errors it came
// from. Operators only. Existing entries save field by field, the way the board's
// items do; nothing is public until the entry (and its release) is published.

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const router = useRouter()
const id = String(route.params.id)
const { api, projects, loadProjects } = useAgent()
const toast = useToast()
const appUrl = useAppUrl()

const project = computed<AdminProject | null>(() => projects.value.find(p => p.id === id) || null)
const entries = ref<ChangelogEntry[]>([])
const releases = ref<ChangelogRelease[]>([])
const loading = ref(true)
const error = ref('')

const NO_RELEASE = '__none__'
const SOURCE_LABEL: Record<ChangelogLinkKind, string> = { feedback: 'Feedback post', board: 'Board item', conversation: 'Conversation' }
const SOURCE_ICON: Record<ChangelogLinkKind, string> = { feedback: 'i-lucide-lightbulb', board: 'i-lucide-square-kanban', conversation: 'i-lucide-message-square' }
const STATE_CLASS = { public: 'bg-success/10 text-success', waiting: 'bg-warning/10 text-warning', draft: 'bg-elevated text-toned' }
const property = { base: 'h-8 w-full rounded-md ps-8 text-[13px] text-default', trailing: 'opacity-0 transition-opacity group-hover:opacity-100' }
const tagItems = CHANGELOG_TAGS.map(value => ({ label: CHANGELOG_TAG_LABELS[value], value }))
const statusItems = [{ label: 'Draft', value: 'draft' }, { label: 'Published', value: 'published' }]
const sourceKindItems = [{ label: 'Feedback post', value: 'feedback' }, { label: 'Board item', value: 'board' }]

const releaseOf = (releaseId: string) => releases.value.find(r => r.id === releaseId) || null
const releaseItems = computed(() => [{ label: 'No release', value: NO_RELEASE }, ...releases.value.map(r => ({ label: `${r.version}${r.title ? ` · ${r.title}` : ''}${r.status === 'draft' ? ' (draft)' : ''}`, value: r.id }))])

/** Where an entry stands: public, a published entry still waiting on its draft release, or a draft. */
function stateOf(entry: ChangelogEntry): { key: 'public' | 'waiting' | 'draft', label: string } {
  if (entry.status !== 'published') return { key: 'draft', label: 'Draft' }
  return isEntryPublic(entry, entry.releaseId ? releaseOf(entry.releaseId) : null) ? { key: 'public', label: 'Public' } : { key: 'waiting', label: 'Waiting for release' }
}

const publicCount = computed(() => entries.value.filter(e => stateOf(e).key === 'public').length)
const draftCount = computed(() => entries.value.filter(e => stateOf(e).key !== 'public').length)

/** Release-less entries first (where new drafts land), then draft releases, then published ones, newest first. */
const groups = computed(() => {
  const loose = entries.value.filter(e => !e.releaseId || !releaseOf(e.releaseId))
  const out: { key: string, release: ChangelogRelease | null, entries: ChangelogEntry[] }[] = []
  if (loose.length) out.push({ key: 'none', release: null, entries: loose })
  const ordered = [...releases.value].sort((a, b) => Number(b.status === 'draft') - Number(a.status === 'draft') || String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt)))
  for (const release of ordered) out.push({ key: release.id, release, entries: entries.value.filter(e => e.releaseId === release.id) })
  return out
})

// ---- the public link ----
const changelogUrl = computed(() => (project.value ? `${appUrl.value}/changelog/${project.value.publicKey}` : ''))
const changelogReady = computed(() => Boolean(project.value?.feedback.enabled && project.value.feedback.changelog))

async function copyChangelogUrl() {
  if (!changelogReady.value) {
    toast.add({ title: 'Turn on the changelog first', description: 'The changelog is published through the feedback board: turn the board on, with its Changelog option, under Feedback → Settings.', icon: 'i-lucide-info', color: 'warning' })
    return
  }
  try {
    await navigator.clipboard.writeText(changelogUrl.value)
    toast.add({ title: 'Changelog link copied', description: changelogUrl.value, icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {
    toast.add({ title: 'Your public changelog', description: changelogUrl.value, icon: 'i-lucide-sparkles' })
  }
}

// ---- load ----
async function loadAll() {
  const [entryResult, releaseResult] = await Promise.all([
    api<{ entries: ChangelogEntry[] }>('/admin/changelog/entries', { query: { project: id } }),
    api<{ releases: ChangelogRelease[] }>('/admin/changelog/releases', { query: { project: id } })
  ])
  entries.value = entryResult.entries
  releases.value = releaseResult.releases
}

/** No live sync between operators yet: coming back to the tab refetches. */
function onFocus() {
  if (!savingEntry.value && !loading.value) loadAll().catch(() => {})
}

onMounted(async () => {
  window.addEventListener('focus', onFocus)
  try {
    if (!project.value) await loadProjects()
    if (!project.value) throw new Error('Project not found')
    await loadAll()
  } catch (e: any) {
    error.value = e?.message || 'Could not load the changelog'
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => window.removeEventListener('focus', onFocus))

// ---- the entry editor ----
const entryOpen = ref(false)
const editingId = ref('')
const current = computed(() => entries.value.find(e => e.id === editingId.value) || null)
const draft = reactive({ title: '', summary: '', slug: '', area: '', body: '', tag: 'improved' as ChangelogTag, releaseId: NO_RELEASE, status: 'draft' as ChangelogStatus, date: '' })
const reviewNotes = ref('')
const reviewing = ref<'' | 'approve' | 'reject'>('')
const entryError = ref('')
const savingEntry = ref(false)
const confirmDelete = ref(false)
const sourceKind = ref<'feedback' | 'board'>('feedback')
const sourceRef = ref('')
const linking = ref(false)

function fill(entry: ChangelogEntry | null) {
  Object.assign(draft, {
    title: entry?.title || '',
    summary: entry?.summary || '',
    slug: entry?.slug || '',
    area: entry?.area || '',
    body: entry?.body || '',
    tag: entry?.tag || 'improved',
    releaseId: entry?.releaseId || NO_RELEASE,
    status: entry?.status === 'published' ? 'published' : 'draft',
    date: entry?.publishedAt ? entry.publishedAt.slice(0, 10) : ''
  })
  entryError.value = ''
  confirmDelete.value = false
  sourceRef.value = ''
}

function replaceEntry(entry: ChangelogEntry) {
  entries.value = entries.value.some(e => e.id === entry.id) ? entries.value.map(e => (e.id === entry.id ? entry : e)) : [entry, ...entries.value]
  if (editingId.value === entry.id) fill(entry)
}

function openEntry(entryId: string) {
  void router.replace({ query: { ...route.query, entry: entryId } })
}

function openNewEntry() {
  editingId.value = ''
  fill(null)
  entryOpen.value = true
}

// `?entry=<id>` is the editor's address: the inbox and the feedback board link to it.
watch(() => [route.query.entry, loading.value, entries.value.length] as const, ([wanted]) => {
  const entryId = typeof wanted === 'string' ? wanted : ''
  if (!entryId) {
    if (editingId.value && entryOpen.value) entryOpen.value = false
    return
  }
  if (loading.value || (editingId.value === entryId && entryOpen.value)) return
  const entry = entries.value.find(e => e.id === entryId)
  if (!entry) return
  editingId.value = entryId
  fill(entry)
  entryOpen.value = true
}, { immediate: true })

watch(entryOpen, (open) => {
  if (open) return
  editingId.value = ''
  if (route.query.entry) void router.replace({ query: { ...route.query, entry: undefined } })
})

async function patch(body: Record<string, unknown>) {
  if (!current.value) return
  savingEntry.value = true
  entryError.value = ''
  try {
    replaceEntry((await api<{ entry: ChangelogEntry }>(`/admin/changelog/entries/${current.value.id}`, { method: 'PATCH', body })).entry)
  } catch (e: any) {
    entryError.value = e?.message || 'Could not save'
    fill(current.value)
  } finally {
    savingEntry.value = false
  }
}

/** Summary, slug and area: saved when the field is left, only when it changed. */
function saveField(key: 'summary' | 'slug' | 'area') {
  if (!current.value) return
  const value = draft[key].trim()
  if (key === 'slug' && !value) { draft.slug = current.value.slug; return }
  if (value !== current.value[key]) void patch({ [key]: value })
}

async function review(action: 'approve' | 'reject') {
  if (!current.value) return
  reviewing.value = action
  entryError.value = ''
  try {
    replaceEntry((await api<{ entry: ChangelogEntry }>(`/admin/changelog/entries/${current.value.id}/review`, { method: 'POST', body: { action, notes: reviewNotes.value } })).entry)
    reviewNotes.value = ''
  } catch (e: any) {
    entryError.value = e?.message || 'Could not review the entry'
  } finally {
    reviewing.value = ''
  }
}

function saveText(key: 'title' | 'body') {
  if (!current.value) return
  const value = draft[key].trim()
  if (key === 'title' && !value) { draft.title = current.value.title; return }
  if (value !== current.value[key]) void patch({ [key]: value })
}

async function createEntry() {
  if (!draft.title.trim()) return
  savingEntry.value = true
  entryError.value = ''
  try {
    const { entry } = await api<{ entry: ChangelogEntry }>('/admin/changelog/entries', {
      method: 'POST',
      query: { project: id },
      body: { title: draft.title, summary: draft.summary, area: draft.area, body: draft.body, tag: draft.tag, status: draft.status, releaseId: draft.releaseId === NO_RELEASE ? null : draft.releaseId }
    })
    replaceEntry(entry)
    editingId.value = entry.id
    void router.replace({ query: { ...route.query, entry: entry.id } })
  } catch (e: any) {
    entryError.value = e?.message || 'Could not create the entry'
  } finally {
    savingEntry.value = false
  }
}

async function deleteEntry() {
  if (!current.value) return
  if (!confirmDelete.value) {
    confirmDelete.value = true
    setTimeout(() => { confirmDelete.value = false }, 3500)
    return
  }
  const entryId = current.value.id
  try {
    await api(`/admin/changelog/entries/${entryId}`, { method: 'DELETE' })
    entries.value = entries.value.filter(e => e.id !== entryId)
    entryOpen.value = false
  } catch (e: any) {
    entryError.value = e?.message || 'Could not delete'
  }
}

function sourceLink(source: ChangelogSource): string | null {
  if (source.kind === 'board') return `/projects/${id}/board?item=${source.id}`
  if (source.kind === 'conversation') return `/inbox?c=${source.id}`
  return null
}

async function setLink(kind: ChangelogLinkKind, targetId: string, linked: boolean) {
  if (!current.value) return false
  linking.value = true
  entryError.value = ''
  try {
    replaceEntry((await api<{ entry: ChangelogEntry }>(`/admin/changelog/entries/${current.value.id}/links`, { method: 'POST', body: { kind, id: targetId, linked } })).entry)
    return true
  } catch (e: any) {
    entryError.value = e?.message || 'Could not change the link'
    return false
  } finally {
    linking.value = false
  }
}

async function addSource() {
  const value = sourceRef.value.trim()
  if (value && await setLink(sourceKind.value, value, true)) sourceRef.value = ''
}

// ---- settings ----
const showSettings = ref(false)
const savingSettings = ref(false)
const settingsSaved = ref(false)
const settingsError = ref('')

async function saveSettings(next: { autoDraft?: boolean, enabled?: boolean, comments?: boolean, notify?: boolean }) {
  savingSettings.value = true
  settingsSaved.value = false
  settingsError.value = ''
  try {
    const { project: saved } = await api<{ project: AdminProject }>(`/admin/projects/${id}`, { method: 'PATCH', body: { changelog: next } })
    projects.value = projects.value.map(p => (p.id === saved.id ? saved : p))
    settingsSaved.value = true
  } catch (e: any) {
    settingsError.value = e?.message || 'Could not save'
  } finally {
    savingSettings.value = false
  }
}

// ---- releases ----
const releaseOpen = ref(false)
const releaseDraft = reactive({ id: '', version: '', title: '', summary: '' })
const releaseError = ref('')
const savingRelease = ref(false)
const confirmDeleteRelease = ref(false)
const publishing = ref('')

function openNewRelease() {
  Object.assign(releaseDraft, { id: '', version: '', title: '', summary: '' })
  releaseError.value = ''
  confirmDeleteRelease.value = false
  releaseOpen.value = true
}

function openRelease(release: ChangelogRelease) {
  Object.assign(releaseDraft, { id: release.id, version: release.version, title: release.title, summary: release.summary })
  releaseError.value = ''
  confirmDeleteRelease.value = false
  releaseOpen.value = true
}

async function saveRelease() {
  if (!releaseDraft.version.trim()) return
  savingRelease.value = true
  releaseError.value = ''
  const body = { version: releaseDraft.version, title: releaseDraft.title, summary: releaseDraft.summary }
  try {
    const { release } = releaseDraft.id
      ? await api<{ release: ChangelogRelease }>(`/admin/changelog/releases/${releaseDraft.id}`, { method: 'PATCH', body })
      : await api<{ release: ChangelogRelease }>('/admin/changelog/releases', { method: 'POST', query: { project: id }, body })
    releases.value = releases.value.some(r => r.id === release.id) ? releases.value.map(r => (r.id === release.id ? release : r)) : [release, ...releases.value]
    releaseOpen.value = false
  } catch (e: any) {
    releaseError.value = e?.message || 'Could not save the release'
  } finally {
    savingRelease.value = false
  }
}

async function publishRelease(release: ChangelogRelease) {
  publishing.value = release.id
  try {
    await api(`/admin/changelog/releases/${release.id}/publish`, { method: 'POST' })
    // Its draft entries went out with it: refetch rather than patch each.
    await loadAll()
    toast.add({ title: `${release.version} published`, icon: 'i-lucide-rocket', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not publish the release', description: e?.message, color: 'error' })
  } finally {
    publishing.value = ''
  }
}

async function deleteRelease() {
  if (!releaseDraft.id) return
  if (!confirmDeleteRelease.value) {
    confirmDeleteRelease.value = true
    setTimeout(() => { confirmDeleteRelease.value = false }, 3500)
    return
  }
  try {
    await api(`/admin/changelog/releases/${releaseDraft.id}`, { method: 'DELETE' })
    releaseOpen.value = false
    // Its entries stay, as entries of no release.
    await loadAll()
  } catch (e: any) {
    releaseError.value = e?.message || 'Could not delete the release'
  }
}
</script>
