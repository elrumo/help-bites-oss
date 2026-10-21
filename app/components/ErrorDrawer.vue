<script setup lang="ts">
/** One error in a side panel: the latest event (stack trace, details, breadcrumbs, tags) and its saved AI write-up. */
import type { BoardItem } from '#shared/board'
import type { ErrorDetail } from '#shared/errors'
import type { SavedAnalysis } from '~~/server/utils/errorAi'

const props = defineProps<{ projectId: string, saved?: SavedAnalysis }>()
const issue = defineModel<any | null>('issue', { default: null })
const emit = defineEmits<{ analyzed: [issue: any, analysis: SavedAnalysis] }>()
const { api } = useAgent()
const { t } = useI18n()

const open = computed({ get: () => Boolean(issue.value), set: (v) => { if (!v) issue.value = null } })
const loading = ref(false)
const loadError = ref('')
const detail = ref<ErrorDetail | null>(null)
const tab = ref('stack')
const showAll = ref(false)
const aiError = ref('')
const analysis = ref<SavedAnalysis | null>(null)
const analysisOpen = ref(true)
const cached = ref(false)
const tabs = computed(() => [{ label: t('errors.drawer.tabs.stack'), value: 'stack' }, { label: t('errors.drawer.tabs.details'), value: 'details' }, { label: t('errors.drawer.tabs.breadcrumbs'), value: 'crumbs' }, { label: t('errors.drawer.tabs.tags'), value: 'tags' }])
const hasInApp = computed(() => Boolean(detail.value?.frames.some(frame => frame.inApp)))
const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : '—')
const keyInfo = computed<Array<[string, string]>>(() => {
  const info = detail.value!.issue
  const row = issue.value
  return [[t('errors.drawer.issue'), info.shortId || row.shortId || row.id], [t('errors.drawer.state'), info.status], [t('errors.drawer.events'), String(info.count || row.count || 1)], [t('errors.drawer.firstSeen'), when(info.firstSeen)], [t('errors.drawer.lastSeen'), when(info.lastSeen || row.lastSeen)]]
})
const query = () => ({ project: props.projectId, link: issue.value.linkId })
const path = () => `/admin/errors/${encodeURIComponent(issue.value.id)}`

// The board item this error was filed as, if any (a project with the board off cannot file).
const board = ref<{ item: BoardItem | null, boardEnabled: boolean } | null>(null)
const filed = computed(() => board.value?.item || null)
const filing = ref(false)
const boardError = ref('')

async function loadBoard(row: any) {
  try {
    const found = await api<{ item: BoardItem | null, boardEnabled: boolean }>(`${path()}/board`, { query: query() })
    if (issue.value === row) board.value = found
  } catch { /* the drawer works without it: no button */ }
}

async function fileOnBoard() {
  const row = issue.value
  filing.value = true
  boardError.value = ''
  try {
    const { item } = await api<{ item: BoardItem, created: boolean }>(`${path()}/board`, { method: 'POST', body: query() })
    if (issue.value === row) board.value = { item, boardEnabled: true }
  } catch (cause: any) { boardError.value = cause.message || t('errors.board.failed') } finally { filing.value = false }
}

watch(issue, async (row) => {
  detail.value = null; loadError.value = ''; aiError.value = ''; tab.value = 'stack'; showAll.value = false
  board.value = null; boardError.value = ''
  analysis.value = props.saved || null
  cached.value = Boolean(props.saved)
  if (!row) return
  void loadBoard(row)
  loading.value = true
  try {
    const loaded = await api<ErrorDetail>(path(), { query: query() })
    if (issue.value === row) detail.value = loaded
  } catch (cause: any) {
    if (issue.value === row) loadError.value = cause.message || t('errors.drawer.loadFailed')
  } finally { if (issue.value === row) loading.value = false }
}, { immediate: true })

const analyzing = ref(false)
async function analyze(refresh: boolean) {
  const row = issue.value
  analyzing.value = true
  aiError.value = ''
  try {
    const result = await api<SavedAnalysis & { cached: boolean }>(`${path()}/analyze`, { method: 'POST', body: { ...query(), refresh } })
    analysis.value = result
    cached.value = result.cached
    analysisOpen.value = true
    emit('analyzed', row, result)
  } catch (cause: any) { aiError.value = cause.message || t('errors.drawer.analyzeFailed') } finally { analyzing.value = false }
}

const copying = ref(false)
const copied = ref(false)
async function copyPrompt() {
  copying.value = true
  aiError.value = ''
  try {
    const { prompt } = await api<{ prompt: string }>(`${path()}/analyze`, { method: 'POST', body: { ...query(), prompt: true } })
    await navigator.clipboard.writeText(`Fix this production error. Find the cause in the code and make the smallest safe change.\n\n${prompt}`)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch (cause: any) { aiError.value = cause.message || t('errors.drawer.promptFailed') } finally { copying.value = false }
}
</script>

<template>
  <USlideover v-model:open="open" :title="issue?.title || $t('errors.error')" :description="issue ? `${issue.culprit || $t('errors.unknownLocation')} · ${$t('errors.eventCount', issue.count || 1)}` : ''" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <div v-if="issue" class="space-y-4 text-[13px]">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge v-if="issue.linkLabel" color="neutral" variant="subtle" size="sm" class="rounded-full">{{ issue.linkLabel }}</UBadge>
          <!-- Filed once, as a board item; pressing it again only opens that item. -->
          <UButton v-if="filed" :to="`/projects/${projectId}/board?item=${filed.id}`" color="neutral" variant="soft" size="xs" icon="i-lucide-square-kanban" :label="$t('errors.board.onBoard', { number: filed.number ?? '', title: filed.title })" class="max-w-64" :ui="{ label: 'truncate' }" />
          <UButton v-else-if="board?.boardEnabled" color="neutral" variant="soft" size="xs" icon="i-lucide-square-kanban" :label="$t('errors.board.file')" :loading="filing" @click="fileOnBoard" />
          <UButton :to="issue.url" target="_blank" color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-up-right" :label="$t('errors.openIn', { provider: issue.providerName })" class="ml-auto" />
        </div>
        <p v-if="boardError" class="text-sm text-error">{{ boardError }}</p>

        <section class="space-y-3 rounded-lg border border-default bg-default p-3">
          <div class="flex flex-wrap items-center gap-2">
            <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
            <p class="mr-auto text-sm font-medium text-highlighted">{{ $t('errors.drawer.fixWithAi') }}</p>
            <UButton color="primary" variant="soft" size="xs" icon="i-lucide-wand-sparkles" :label="analysis ? $t('errors.drawer.analyzeAgain') : $t('errors.drawer.analyze')" :loading="analyzing" @click="analyze(!!analysis)" />
            <UButton color="neutral" variant="soft" size="xs" :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'" :label="$t('errors.drawer.copyPrompt')" :loading="copying" @click="copyPrompt" />
          </div>
          <p v-if="aiError" class="text-sm text-error">{{ aiError }}</p>
          <UCollapsible v-if="analysis" v-model:open="analysisOpen">
            <UButton color="neutral" variant="ghost" size="xs" block class="justify-between" trailing-icon="i-lucide-chevron-down" :label="analysisOpen ? $t('errors.drawer.hideAnalysis') : analysis.at ? $t('errors.drawer.showAnalysisFrom', { time: when(analysis.at) }) : $t('errors.drawer.showAnalysis')" />
            <template #content>
              <div class="space-y-3 pt-2">
                <MarkdownBlock :text="analysis.text" />
                <p class="text-xs text-muted">{{ analysis.files.length ? $t('errors.drawer.readFiles', { files: analysis.files.join(', ') }) : $t('errors.drawer.noSourceFiles') }}{{ cached ? (analysis.at ? $t('errors.drawer.savedOn', { time: when(analysis.at) }) : $t('errors.drawer.savedShort')) : '' }}</p>
              </div>
            </template>
          </UCollapsible>
          <p v-else-if="!analyzing" class="text-xs text-muted">{{ $t('errors.drawer.analysisHelp') }}</p>
        </section>

        <div v-if="loading" class="space-y-2" aria-busy="true"><USkeleton class="h-4 w-1/2" /><USkeleton class="h-24 w-full" /></div>
        <p v-else-if="loadError" class="text-sm text-error">{{ loadError }}</p>
        <template v-else-if="detail">
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            <div v-for="[label, value] in keyInfo" :key="label" class="min-w-0"><dt class="text-xs text-muted">{{ label }}</dt><dd class="truncate text-highlighted">{{ value }}</dd></div>
          </dl>
          <div>
            <p class="text-sm font-medium text-highlighted">{{ detail.exception.type }}</p>
            <p v-if="detail.exception.value" class="break-words text-sm text-muted">{{ detail.exception.value }}</p>
          </div>
          <UTabs v-model="tab" :items="tabs" :content="false" color="neutral" size="xs" class="w-full" />
          <div v-if="tab === 'stack'" class="space-y-1.5">
            <p v-if="!detail.frames.length" class="text-sm text-muted">{{ $t('errors.drawer.noStack') }}</p>
            <template v-for="(frame, index) in detail.frames" :key="index">
              <details v-if="showAll || frame.inApp || !hasInApp" :open="index === 0" class="rounded-lg border border-default bg-default">
                <summary class="cursor-pointer break-all px-3 py-2 font-mono text-xs"><span :class="frame.inApp ? 'text-highlighted' : 'text-muted'">{{ frame.file }}</span><span v-if="frame.line" class="text-muted">:{{ frame.line }}</span> <span class="text-muted">in</span> {{ frame.function }}</summary>
                <pre v-if="frame.context" class="overflow-x-auto border-t border-default px-3 py-2 font-mono text-xs"><template v-for="(line, n) in frame.before" :key="`b${n}`"><span class="text-muted">{{ line }}</span>{{ '\n' }}</template><span class="font-semibold text-error">{{ frame.context }}</span>{{ '\n' }}<template v-for="(line, n) in frame.after" :key="`a${n}`"><span class="text-muted">{{ line }}</span>{{ '\n' }}</template></pre>
              </details>
            </template>
            <UButton v-if="hasInApp && detail.frames.some(frame => !frame.inApp)" color="neutral" variant="link" size="xs" :label="showAll ? $t('errors.drawer.showOwnCode') : $t('errors.drawer.showLibraryFrames')" @click="showAll = !showAll" />
          </div>
          <dl v-else-if="tab === 'details'" class="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
            <p v-if="!detail.details.length" class="col-span-2 text-muted">{{ $t('errors.drawer.noDetails') }}</p>
            <template v-for="[label, value] in detail.details" :key="label"><dt class="text-muted">{{ label }}</dt><dd class="break-all">{{ value }}</dd></template>
          </dl>
          <ul v-else-if="tab === 'crumbs'" class="space-y-1">
            <li v-if="!detail.breadcrumbs.length" class="text-muted">{{ $t('errors.drawer.noBreadcrumbs') }}</li>
            <li v-for="(crumb, index) in detail.breadcrumbs" :key="index" class="flex gap-3"><span class="w-24 shrink-0 truncate text-xs text-muted">{{ crumb.category || crumb.level }}</span><span class="min-w-0 break-all">{{ crumb.message }}</span></li>
          </ul>
          <dl v-else class="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5">
            <p v-if="!detail.tags.length" class="col-span-2 text-muted">{{ $t('errors.drawer.noTags') }}</p>
            <template v-for="[label, value] in detail.tags" :key="label"><dt class="text-muted">{{ label }}</dt><dd class="break-all">{{ value }}</dd></template>
          </dl>
          <p class="text-xs text-muted">{{ detail.at ? $t('errors.drawer.showingLatestAt', { time: new Date(detail.at).toLocaleString(), provider: issue.providerName }) : $t('errors.drawer.showingLatest', { provider: issue.providerName }) }}</p>
        </template>
      </div>
    </template>
  </USlideover>
</template>
