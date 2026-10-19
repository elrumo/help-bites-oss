<template>
  <div>
    <div class="flex items-center gap-3 p-4">
      <button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" :aria-expanded="open" @click="toggle">
        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted transition-transform" :class="open ? 'rotate-90' : ''" />
        <UIcon name="i-lucide-bug" :class="issue.level === 'error' || issue.level === 'fatal' ? 'text-error' : 'text-warning'" class="size-4 shrink-0" />
        <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-highlighted">{{ issue.title }}</span><span class="block truncate text-xs text-muted">{{ issue.culprit || 'Unknown location' }} · {{ issue.count || 1 }} events</span></span>
      </button>
      <UBadge v-if="showLink" color="neutral" variant="subtle" size="sm" class="shrink-0 rounded-full">{{ issue.linkLabel }}</UBadge>
      <UButton :to="issue.url" target="_blank" color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-up-right" :aria-label="`Open in ${issue.providerName}`" />
      <UDropdownMenu :items="[statusItems]"><UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-ellipsis" aria-label="Change status" /></UDropdownMenu>
    </div>
    <div v-if="open" class="space-y-4 border-t border-default bg-elevated/30 p-4">
      <div v-if="loading" class="space-y-2" aria-busy="true"><USkeleton class="h-4 w-1/2" /><USkeleton class="h-24 w-full" /></div>
      <p v-else-if="loadError" class="text-sm text-error">{{ loadError }}</p>
      <template v-else-if="detail">
        <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
          <div v-for="[label, value] in keyInfo" :key="label" class="min-w-0"><dt class="text-xs text-muted">{{ label }}</dt><dd class="truncate text-highlighted">{{ value }}</dd></div>
        </dl>
        <div>
          <p class="text-sm font-medium text-highlighted">{{ detail.exception.type }}</p>
          <p v-if="detail.exception.value" class="break-words text-sm text-muted">{{ detail.exception.value }}</p>
        </div>
        <UTabs v-model="tab" :items="tabs" :content="false" color="neutral" size="xs" class="w-full" />
        <div v-if="tab === 'stack'" class="space-y-1.5">
          <p v-if="!detail.frames.length" class="text-sm text-muted">This event has no stack trace.</p>
          <template v-for="(frame, index) in detail.frames" :key="index">
            <details v-if="showAll || frame.inApp || !hasInApp" :open="index === 0" class="rounded-lg border border-default bg-default">
              <summary class="cursor-pointer break-all px-3 py-2 font-mono text-xs"><span :class="frame.inApp ? 'text-highlighted' : 'text-muted'">{{ frame.file }}</span><span v-if="frame.line" class="text-muted">:{{ frame.line }}</span> <span class="text-muted">in</span> {{ frame.function }}</summary>
              <pre v-if="frame.context" class="overflow-x-auto border-t border-default px-3 py-2 font-mono text-xs"><template v-for="(line, n) in frame.before" :key="`b${n}`"><span class="text-muted">{{ line }}</span>{{ '\n' }}</template><span class="font-semibold text-error">{{ frame.context }}</span>{{ '\n' }}<template v-for="(line, n) in frame.after" :key="`a${n}`"><span class="text-muted">{{ line }}</span>{{ '\n' }}</template></pre>
            </details>
          </template>
          <UButton v-if="hasInApp && detail.frames.some(frame => !frame.inApp)" color="neutral" variant="link" size="xs" :label="showAll ? 'Show only your code' : 'Show library frames too'" @click="showAll = !showAll" />
        </div>
        <dl v-else-if="tab === 'details'" class="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <p v-if="!detail.details.length" class="col-span-2 text-muted">No extra details on this event.</p>
          <template v-for="[label, value] in detail.details" :key="label"><dt class="text-muted">{{ label }}</dt><dd class="break-all">{{ value }}</dd></template>
        </dl>
        <ul v-else-if="tab === 'crumbs'" class="space-y-1 text-sm">
          <li v-if="!detail.breadcrumbs.length" class="text-muted">No breadcrumbs recorded.</li>
          <li v-for="(crumb, index) in detail.breadcrumbs" :key="index" class="flex gap-3"><span class="w-24 shrink-0 truncate text-xs text-muted">{{ crumb.category || crumb.level }}</span><span class="min-w-0 break-all">{{ crumb.message }}</span></li>
        </ul>
        <dl v-else class="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <p v-if="!detail.tags.length" class="col-span-2 text-muted">No tags on this event.</p>
          <template v-for="[label, value] in detail.tags" :key="label"><dt class="text-muted">{{ label }}</dt><dd class="break-all">{{ value }}</dd></template>
        </dl>
        <p class="text-xs text-muted">Showing the latest event{{ detail.at ? `, ${new Date(detail.at).toLocaleString()}` : '' }}. Older events are in {{ issue.providerName }}.</p>
      </template>
      <section class="space-y-3 rounded-lg border border-default bg-default p-3">
        <div class="flex flex-wrap items-center gap-2">
          <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
          <p class="mr-auto text-sm font-medium text-highlighted">Fix with AI</p>
          <UButton color="primary" variant="soft" size="xs" icon="i-lucide-wand-sparkles" :label="analysis ? 'Analyze again' : 'Analyze and suggest a fix'" :loading="analyzing" @click="analyze(!!analysis)" />
          <UButton color="neutral" variant="soft" size="xs" :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'" label="Copy prompt for a coding agent" :loading="copying" @click="copyPrompt" />
        </div>
        <p v-if="aiError" class="text-sm text-error">{{ aiError }}</p>
        <template v-if="analysis">
          <MarkdownBlock :text="analysis.text" />
          <p class="text-xs text-muted">{{ analysis.files.length ? `Read ${analysis.files.join(', ')} from your GitHub repos (default branch).` : 'No source files from GitHub were found for this stack trace, so this is based on the event alone.' }}{{ analysis.cached ? ' Saved from an earlier run.' : '' }}</p>
        </template>
        <p v-else-if="!analyzing" class="text-xs text-muted">Reads the stack trace and, when GitHub repos are connected to the project, the source files it passes through.</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ErrorDetail } from '#shared/errors'

const props = defineProps<{ issue: any, projectId: string, showLink: boolean }>()
const emit = defineEmits<{ (event: 'status', value: string): void }>()
const { api } = useAgent()

const open = ref(false)
const loading = ref(false)
const loadError = ref('')
const detail = ref<ErrorDetail | null>(null)
const tab = ref('stack')
const showAll = ref(false)
const tabs = [{ label: 'Stacktrace', value: 'stack' }, { label: 'Event details', value: 'details' }, { label: 'Breadcrumbs', value: 'crumbs' }, { label: 'Tags', value: 'tags' }]
const hasInApp = computed(() => Boolean(detail.value?.frames.some(frame => frame.inApp)))
const when = (value: string) => (value ? new Date(value).toLocaleString() : '—')
const keyInfo = computed<Array<[string, string]>>(() => {
  const info = detail.value!.issue
  return [['Issue', info.shortId || props.issue.shortId || props.issue.id], ['State', info.status], ['Events', String(info.count || props.issue.count || 1)], ['First seen', when(info.firstSeen)], ['Last seen', when(info.lastSeen || props.issue.lastSeen)]]
})
const statusItems = [
  { label: 'Open', onSelect: () => emit('status', 'open') },
  { label: 'Resolve', onSelect: () => emit('status', 'resolved') },
  { label: 'Ignore', onSelect: () => emit('status', 'closed') }
]
const query = () => ({ project: props.projectId, link: props.issue.linkId })

async function toggle() {
  open.value = !open.value
  if (!open.value || detail.value || loading.value) return
  loading.value = true
  loadError.value = ''
  try { detail.value = await api<ErrorDetail>(`/admin/errors/${encodeURIComponent(props.issue.id)}`, { query: query() }) } catch (cause: any) { loadError.value = cause.message || 'Could not load this error' } finally { loading.value = false }
}

const analysis = ref<{ text: string, files: string[], cached: boolean } | null>(null)
const analyzing = ref(false)
const aiError = ref('')
async function analyze(refresh: boolean) {
  analyzing.value = true
  aiError.value = ''
  try { analysis.value = await api(`/admin/errors/${encodeURIComponent(props.issue.id)}/analyze`, { method: 'POST', body: { ...query(), refresh } }) } catch (cause: any) { aiError.value = cause.message || 'Could not analyze this error' } finally { analyzing.value = false }
}

const copying = ref(false)
const copied = ref(false)
async function copyPrompt() {
  copying.value = true
  aiError.value = ''
  try {
    const { prompt } = await api<{ prompt: string }>(`/admin/errors/${encodeURIComponent(props.issue.id)}/analyze`, { method: 'POST', body: { ...query(), prompt: true } })
    await navigator.clipboard.writeText(`Fix this production error. Find the cause in the code and make the smallest safe change.\n\n${prompt}`)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch (cause: any) { aiError.value = cause.message || 'Could not build the prompt' } finally { copying.value = false }
}
</script>
