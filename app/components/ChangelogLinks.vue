<template>
  <!-- The changelog entries a post, board item or conversation is behind: open one, unlink it, or start a new one. -->
  <div class="space-y-1.5">
    <div v-if="loading && !linked.length" class="h-7 animate-pulse rounded-md bg-elevated" />
    <div v-for="entry in linked" :key="entry.id" class="group -mx-1 flex items-center gap-1.5 rounded-lg px-1 text-[13px] transition-colors hover:bg-elevated">
      <NuxtLink :to="`/projects/${projectId}/changelog?entry=${entry.id}`" class="flex min-w-0 flex-1 items-center gap-2 py-1">
        <span class="size-2 shrink-0 rounded-full" :class="entry.status === 'published' ? 'bg-emerald-500' : 'bg-stone-400'" :title="entry.status === 'published' ? $t('changelog.published') : $t('changelog.draft')" />
        <span v-if="entry.number" class="shrink-0 tabular-nums text-muted">#{{ entry.number }}</span>
        <span class="min-w-0 truncate text-default">{{ entry.title }}</span>
      </NuxtLink>
      <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" :aria-label="$t('changelog.unlinkEntry', { number: entry.number ?? '', title: entry.title })" :loading="busy === entry.id" @click="unlink(entry)" />
    </div>

    <form v-if="composing" class="flex items-center gap-1.5 pt-0.5" @submit.prevent="createEntry">
      <UInput v-model="title" size="xs" class="min-w-0 flex-1" :placeholder="$t('changelog.whatChangedUsers')" :maxlength="200" autofocus :aria-label="$t('changelog.entryTitle')" />
      <UButton type="submit" :label="$t('changelog.createDraft')" size="xs" :loading="creating" :disabled="!title.trim()" />
      <UButton :label="$t('common.cancel')" size="xs" color="neutral" variant="ghost" @click="composing = false" />
    </form>
    <div v-else class="flex flex-wrap items-center gap-1.5 pt-0.5">
      <UButton icon="i-lucide-plus" :label="$t('changelog.newEntry')" size="xs" color="neutral" variant="outline" @click="startComposing" />
      <USelectMenu
        v-model="picked"
        :items="candidates"
        value-key="value"
        size="xs"
        class="min-w-0 flex-1"
        :placeholder="$t('changelog.addToExisting')"
        :search-input="{ placeholder: $t('changelog.searchEntries') }"
        :loading="loadingAll"
        @update:open="open => open && loadAll()"
        @update:model-value="addExisting"
      />
    </div>
    <p v-if="error" class="text-xs text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { changelogPrefill, type ChangelogEntry, type ChangelogLinkKind } from '#shared/changelog'

// Used by the feedback post editor (kind "feedback"), the board item editor
// ("board") and the inbox ("conversation": tickets and error issues alike).
// "New entry" starts a draft linked to this item. It starts with only what is
// already public (`changelogPrefill`): a ticket or error gives nothing, so you
// write the title. Nothing is published from here.

const props = defineProps<{
  projectId: string
  kind: ChangelogLinkKind
  targetId: string
  /** The source's own fields that `changelogPrefill` reads: title, body, type, publicDescription… */
  source?: Record<string, unknown>
}>()

const { api } = useAgent()
const { t } = useI18n()

const FILTER_KEY = { feedback: 'feedbackPost', board: 'boardItem', conversation: 'conversation' } as const
const LINK_FIELD = { feedback: 'feedbackPostIds', board: 'boardItemIds', conversation: 'conversationIds' } as const

const linked = ref<ChangelogEntry[]>([])
const all = ref<ChangelogEntry[]>([])
const loading = ref(false)
const loadingAll = ref(false)
const creating = ref(false)
const composing = ref(false)
const title = ref('')
const busy = ref('')
const error = ref('')
const picked = ref<string | undefined>(undefined)

const candidates = computed(() => all.value
  .filter(entry => !linked.value.some(l => l.id === entry.id))
  .map(entry => ({ label: `${entry.number ? `#${entry.number} ` : ''}${entry.title}${entry.status === 'draft' ? ` ${t('changelog.draftSuffix')}` : ''}`, value: entry.id })))

async function load() {
  if (!props.targetId || !props.projectId) { linked.value = []; return }
  loading.value = true
  error.value = ''
  try {
    linked.value = (await api<{ entries: ChangelogEntry[] }>('/admin/changelog/entries', { query: { project: props.projectId, [FILTER_KEY[props.kind]]: props.targetId } })).entries
  } catch (e: any) {
    error.value = e?.message || t('changelog.loadError')
  } finally {
    loading.value = false
  }
}

async function loadAll() {
  loadingAll.value = true
  try {
    all.value = (await api<{ entries: ChangelogEntry[] }>('/admin/changelog/entries', { query: { project: props.projectId } })).entries
  } catch (e: any) {
    error.value = e?.message || t('changelog.loadError')
  } finally {
    loadingAll.value = false
  }
}

async function link(entryId: string, on: boolean) {
  const { entry } = await api<{ entry: ChangelogEntry }>(`/admin/changelog/entries/${entryId}/links`, { method: 'POST', body: { kind: props.kind, id: props.targetId, linked: on } })
  return entry
}

async function addExisting(entryId: string | undefined) {
  if (!entryId) return
  busy.value = entryId
  error.value = ''
  try {
    const entry = await link(entryId, true)
    if (!linked.value.some(l => l.id === entry.id)) linked.value = [...linked.value, entry]
  } catch (e: any) {
    error.value = e?.message || t('changelog.linkEntryError')
  } finally {
    busy.value = ''
    picked.value = undefined
  }
}

async function unlink(entry: ChangelogEntry) {
  busy.value = entry.id
  error.value = ''
  try {
    await link(entry.id, false)
    linked.value = linked.value.filter(l => l.id !== entry.id)
  } catch (e: any) {
    error.value = e?.message || t('changelog.unlinkEntryError')
  } finally {
    busy.value = ''
  }
}

function startComposing() {
  title.value = changelogPrefill(props.kind, props.source || {}).title
  composing.value = true
}

async function createEntry() {
  const text = title.value.trim()
  if (!text) return
  creating.value = true
  error.value = ''
  const prefill = changelogPrefill(props.kind, props.source || {})
  try {
    const { entry } = await api<{ entry: ChangelogEntry }>('/admin/changelog/entries', {
      method: 'POST',
      query: { project: props.projectId },
      body: { title: text.slice(0, 200), body: prefill.body, tag: prefill.tag, status: 'draft', [LINK_FIELD[props.kind]]: [props.targetId] }
    })
    linked.value = [...linked.value, entry]
    all.value = []
    composing.value = false
  } catch (e: any) {
    error.value = e?.message || t('changelog.createError')
  } finally {
    creating.value = false
  }
}

watch(() => [props.projectId, props.kind, props.targetId], () => { all.value = []; composing.value = false; void load() }, { immediate: true })
</script>
