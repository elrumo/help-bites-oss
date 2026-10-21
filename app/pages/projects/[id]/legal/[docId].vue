<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="doc?.title || $t('projectTools.legalDoc.document')" :crumbs="[{ label: $t('sections.legal'), to: `/projects/${id}/legal` }]">
      <template #actions>
        <UButton v-if="doc?.status === 'published'" :to="publicUrl" target="_blank" icon="i-lucide-external-link" :label="$t('projectTools.legalDoc.viewPage')" size="sm" color="neutral" variant="ghost" />
        <UButton v-if="dirty" :label="$t('projectTools.shared.save')" size="sm" :loading="busy === 'save'" @click="save" />
        <UButton v-if="doc?.status === 'published'" :label="$t('projectTools.legalDoc.unpublish')" size="sm" color="neutral" variant="ghost" :loading="busy === 'unpublish'" @click="act('unpublish', 'unpublish')" />
        <UButton v-if="doc" :label="doc.status === 'published' ? $t('projectTools.legalDoc.publishNewVersion') : $t('projectTools.shared.publish')" size="sm" :color="dirty ? 'neutral' : 'primary'" :disabled="dirty" :loading="busy === 'publish'" @click="publish" />
      </template>
    </PageHeader>

    <div v-if="loading" class="mx-auto w-full max-w-5xl space-y-3 px-6 py-8"><USkeleton v-for="n in 4" :key="n" class="h-24 w-full" /></div>
    <p v-else-if="!doc" class="px-6 py-8 text-[13px] text-error">{{ error || $t('projectTools.legalDoc.notFound') }}</p>

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <!-- sections -->
        <div class="space-y-3">
          <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
          <div v-for="(s, i) in sections" :key="s.id" class="rounded-xl border border-default p-4">
            <div class="flex flex-wrap items-center gap-2">
              <UInput v-model="s.heading" class="min-w-0 flex-1 basis-40 font-medium" :aria-label="$t('projectTools.legalDoc.headingOfSection', { n: i + 1 })" />
              <UBadge :label="s.source" :color="s.source === 'human' ? 'primary' : s.source === 'ai' ? 'info' : 'neutral'" variant="soft" size="sm" />
              <UButton :icon="s.locked ? 'i-lucide-lock' : 'i-lucide-lock-open'" size="sm" color="neutral" variant="ghost" square :aria-label="s.locked ? $t('projectTools.legalDoc.unlockSection') : $t('projectTools.legalDoc.lockSection')" @click="s.locked = !s.locked" />
              <UButton icon="i-lucide-arrow-up" size="sm" color="neutral" variant="ghost" square :disabled="i === 0" :aria-label="$t('projectTools.legalDoc.moveUp')" @click="move(i, -1)" />
              <UButton icon="i-lucide-arrow-down" size="sm" color="neutral" variant="ghost" square :disabled="i === sections.length - 1" :aria-label="$t('projectTools.legalDoc.moveDown')" @click="move(i, 1)" />
              <UButton icon="i-lucide-trash-2" size="sm" color="neutral" variant="ghost" square :aria-label="$t('projectTools.legalDoc.removeSection')" @click="sections.splice(i, 1)" />
            </div>
            <UTextarea v-model="s.body" autoresize :rows="3" :maxrows="24" class="mt-3 w-full font-mono text-[13px]" :aria-label="$t('projectTools.legalDoc.textOfSection', { n: i + 1 })" />
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <UButton v-if="!dirty" icon="i-lucide-sparkles" :label="$t('projectTools.legalDoc.rewriteWithAi')" size="xs" color="neutral" variant="soft" :disabled="s.locked" @click="rewriting = rewriting === s.id ? '' : s.id" />
              <span v-else class="text-xs text-dimmed">{{ $t('projectTools.legalDoc.saveToUseAi') }}</span>
              <span v-if="s.satisfies.length" class="text-xs text-dimmed">{{ $t('projectTools.legalDoc.answers', s.satisfies.length) }}</span>
            </div>
            <form v-if="rewriting === s.id" class="mt-3 space-y-2" @submit.prevent="rewrite(s.id)">
              <UInput v-model="instruction" :placeholder="$t('projectTools.legalDoc.instructionPlaceholder')" class="w-full" autofocus />
              <div v-if="proposal" class="rounded-lg border border-default bg-elevated p-3">
                <p class="mb-1 text-xs font-medium text-muted">{{ $t('projectTools.legalDoc.proposal') }}</p>
                <pre class="whitespace-pre-wrap font-mono text-[13px] text-default">{{ proposal }}</pre>
                <div class="mt-3 flex gap-2">
                  <UButton size="xs" :label="$t('projectTools.legalDoc.useThis')" :loading="busy === 'apply'" @click="applyProposal(s.id)" />
                  <UButton size="xs" :label="$t('projectTools.legalDoc.discard')" color="neutral" variant="ghost" @click="proposal = ''" />
                </div>
              </div>
              <UButton v-else type="submit" size="xs" :label="$t('projectTools.legalDoc.proposeRewrite')" :loading="busy === 'rewrite'" :disabled="!instruction.trim()" />
            </form>
          </div>
          <UButton icon="i-lucide-plus" :label="$t('projectTools.legalDoc.addSection')" color="neutral" variant="soft" size="sm" @click="addSection" />
        </div>

        <!-- sidebar -->
        <aside class="space-y-5">
          <section class="rounded-xl border border-default p-4">
            <div class="flex items-center justify-between">
              <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.legalDoc.summary') }}</h3>
              <UBadge v-if="tldrSource" :label="tldrSource" :color="tldrSource === 'human' ? 'primary' : 'info'" variant="soft" size="sm" />
            </div>
            <UTextarea v-model="tldr" :rows="4" :placeholder="$t('projectTools.legalDoc.summaryPlaceholder')" class="mt-3 w-full" @update:model-value="tldrEdited = true" />
            <UButton icon="i-lucide-sparkles" :label="tldrSource === 'human' ? $t('projectTools.legalDoc.replaceWithAi') : $t('projectTools.legalDoc.writeWithAi')" size="xs" color="neutral" variant="soft" class="mt-2" :disabled="dirty" :loading="busy === 'tldr'" @click="generateTldr" />
          </section>

          <section class="rounded-xl border border-default p-4">
            <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.legalDoc.details') }}</h3>
            <div class="mt-3 space-y-3">
              <UFormField :label="$t('projectTools.legalDoc.titleLabel')"><UInput v-model="title" class="w-full" /></UFormField>
              <UFormField :label="$t('projectTools.legalDoc.urlName')"><UInput v-model="slug" class="w-full font-mono" /></UFormField>
              <UFormField :label="$t('projectTools.legalDoc.effectiveDate')"><UInput v-model="effective" type="date" class="w-full" /></UFormField>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <UButton icon="i-lucide-list-checks" :label="$t('projectTools.legalDoc.answersAndRecompose')" size="xs" color="neutral" variant="soft" :disabled="dirty" @click="wizardOpen = true" />
            </div>
          </section>

          <section class="rounded-xl border border-default p-4">
            <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('translations.title') }}</h3>
            <p class="mt-1 text-xs text-dimmed">{{ $t('translations.legalIntro') }}</p>
            <UFormField :label="$t('translations.thisLanguage')" class="mt-3">
              <USelectMenu v-model="locale" :items="localeItems" value-key="value" create-item="always" class="w-full" @create="setLocale($event)">
                <template #create-item-label="{ item }">{{ $t('translations.addTag', { tag: item }) }}</template>
              </USelectMenu>
            </UFormField>
            <ul v-if="siblings.length" class="mt-3 space-y-1.5">
              <li v-for="s in siblings" :key="s.id" class="flex items-center gap-2 text-[13px]">
                <NuxtLink :to="`/projects/${id}/legal/${s.id}`" class="min-w-0 flex-1 truncate font-medium text-highlighted hover:underline">{{ localeName(s.locale, uiLocale) }}</NuxtLink>
                <UBadge :label="s.status === 'published' ? $t('translations.published') : $t('translations.draft')" :color="s.status === 'published' ? 'success' : 'neutral'" variant="soft" size="sm" />
              </li>
            </ul>
            <div class="mt-3 flex gap-2">
              <USelectMenu v-model="target" :items="targetItems" value-key="value" :placeholder="$t('translations.add')" create-item="always" size="sm" class="min-w-0 flex-1" @create="setTarget($event)">
                <template #create-item-label="{ item }">{{ $t('translations.addTag', { tag: item }) }}</template>
              </USelectMenu>
              <UButton icon="i-lucide-sparkles" :label="$t('translations.translate')" size="sm" color="neutral" variant="soft" :disabled="dirty || !target" :loading="busy === 'translate'" @click="translateTo" />
            </div>
            <p class="mt-2 text-xs text-dimmed">{{ dirty ? $t('projectTools.legalDoc.saveToUseAi') : $t('translations.legalReview') }}</p>
          </section>

          <section class="rounded-xl border border-default p-4">
            <div class="flex items-center justify-between">
              <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.legalDoc.rulesCheck') }}</h3>
              <span v-if="coverage?.mapped" class="text-xs text-muted">{{ $t('projectTools.legalDoc.covered', { covered: coverage.covered.length, total: coverage.total }) }}</span>
            </div>
            <p v-if="coverage?.unreviewedPacks.length" class="mt-2 text-xs text-warning">{{ $t('projectTools.legalDoc.unreviewed') }}</p>
            <ul v-if="coverage?.mapped && coverage.gaps.length" class="mt-3 space-y-2">
              <li v-for="g in coverage.gaps" :key="g.id" class="text-[13px]">
                <p class="text-highlighted">{{ g.summary }}</p>
                <p class="text-xs text-dimmed">{{ g.citation }} · {{ g.severity }}</p>
              </li>
            </ul>
            <p v-else-if="coverage?.mapped" class="mt-2 text-[13px] text-muted">{{ $t('projectTools.legalDoc.allCovered') }}</p>
            <p v-else-if="coverage" class="mt-2 text-[13px] text-muted">{{ $t('projectTools.legalDoc.notMapped') }}</p>
            <UButton icon="i-lucide-scan-search" :label="$t('projectTools.legalDoc.checkWithAi')" size="xs" color="neutral" variant="soft" class="mt-3" :disabled="dirty" :loading="busy === 'check'" @click="checkWithAi" />
            <ul v-if="findings" class="mt-3 space-y-2">
              <li v-for="f in findings.filter(x => x.status !== 'ok')" :key="f.requirement" class="text-[13px]">
                <UBadge :label="f.status" :color="f.status === 'unclear' ? 'warning' : 'error'" variant="soft" size="sm" />
                <span class="ml-1 text-highlighted">{{ f.note }}</span>
              </li>
              <li v-if="!findings.some(x => x.status !== 'ok')" class="text-[13px] text-muted">{{ $t('projectTools.legalDoc.nothingToFlag') }}</li>
            </ul>
          </section>

          <section v-if="versions.length" class="rounded-xl border border-default p-4">
            <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.legalDoc.versions') }}</h3>
            <ul class="mt-3 space-y-2">
              <li v-for="v in versions" :key="v.version" class="flex items-center gap-2 text-[13px]">
                <span class="font-medium text-highlighted">v{{ v.version }}</span>
                <span class="min-w-0 flex-1 truncate text-muted">{{ v.note || new Date(v.publishedAt).toLocaleDateString() }}</span>
                <UButton :label="$t('projectTools.legalDoc.restore')" size="xs" color="neutral" variant="ghost" :disabled="dirty" @click="restore(v.version)" />
              </li>
            </ul>
          </section>

          <UButton icon="i-lucide-trash-2" :label="$t('projectTools.legalDoc.deleteDocument')" size="xs" color="error" variant="ghost" @click="remove" />
        </aside>
      </div>
    </div>

    <LegalWizard v-if="doc" v-model:open="wizardOpen" :project-id="id" :document="{ id: doc.id, type: doc.type, answers: doc.answers }" @done="load" />
  </div>
</template>

<script setup lang="ts">
import type { LegalFinding, LegalSection } from '#shared/legal/types'
import { COMMON_LOCALES, localeName, normalizeLocale } from '#shared/locales'

definePageMeta({ middleware: 'agent' })

type Doc = { id: string, type: any, slug: string, locale: string, translationOf: string | null, title: string, status: string, sections: LegalSection[], answers: any, tldr: { text: string, source: string } | null, effectiveDate: string | null, version: number, path: string }
type Coverage = { total: number, covered: any[], gaps: { id: string, summary: string, citation: string, severity: string }[], unreviewedPacks: string[], mapped: boolean }

const { api } = useAgent()
const route = useRoute()
const { t, locale: uiLocale } = useI18n()
const toast = useToast()
const id = String(route.params.id)
const docId = String(route.params.docId)

const doc = ref<Doc | null>(null)
const coverage = ref<Coverage | null>(null)
const versions = ref<{ version: number, note: string, publishedAt: string }[]>([])
const findings = ref<LegalFinding[] | null>(null)
const loading = ref(true)
const error = ref('')
const busy = ref('')
const wizardOpen = ref(false)

// The working copy; `dirty` says whether it differs from what the server has.
const sections = ref<LegalSection[]>([])
const title = ref('')
const slug = ref('')
const effective = ref('')
const tldr = ref('')
const tldrEdited = ref(false)
const locale = ref('en')
const target = ref('')
const siblings = ref<{ id: string, locale: string, status: string }[]>([])

const tldrSource = computed(() => (tldrEdited.value ? 'human' : doc.value?.tldr?.source || ''))
const publicUrl = computed(() => (doc.value ? `${location.origin}${doc.value.path}` : ''))
const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
const dirty = computed(() => !!doc.value && (
  JSON.stringify(sections.value.map(s => [s.id, s.heading, s.body, s.locked])) !== JSON.stringify(doc.value.sections.map(s => [s.id, s.heading, s.body, s.locked]))
  || locale.value !== doc.value.locale || title.value !== doc.value.title || slug.value !== doc.value.slug || effective.value !== dateOnly(doc.value.effectiveDate) || tldrEdited.value
))

function adopt(next: Doc, nextCoverage?: Coverage) {
  doc.value = next
  if (nextCoverage) coverage.value = nextCoverage
  sections.value = next.sections.map(s => ({ ...s, satisfies: [...s.satisfies] }))
  locale.value = next.locale
  title.value = next.title
  slug.value = next.slug
  effective.value = dateOnly(next.effectiveDate)
  tldr.value = next.tldr?.text || ''
  tldrEdited.value = false
}

// Documents sharing the original's id are one text in several languages.
async function loadSiblings() {
  if (!doc.value) return
  const group = doc.value.translationOf || doc.value.id
  const { documents } = await api<{ documents: Doc[] }>('/admin/legal/documents', { query: { project: id } })
  siblings.value = documents.filter(d => d.id !== doc.value!.id && (d.translationOf || d.id) === group).map(d => ({ id: d.id, locale: d.locale, status: d.status }))
}

const localeItems = computed(() => [...new Set([locale.value, ...COMMON_LOCALES])].map(value => ({ value, label: `${localeName(value, uiLocale.value)} · ${value}` })))
const targetItems = computed(() => COMMON_LOCALES
  .filter(tag => ![locale.value, ...siblings.value.map(s => s.locale)].some(have => have.toLowerCase() === tag.toLowerCase()))
  .map(value => ({ value, label: `${localeName(value, uiLocale.value)} · ${value}` })))

function setLocale(tag: string) {
  const next = normalizeLocale(tag)
  if (next) locale.value = next
  else toast.add({ title: t('translations.badTag'), color: 'error', icon: 'i-lucide-circle-alert' })
}
function setTarget(tag: string) {
  const next = normalizeLocale(tag)
  if (next) target.value = next
  else toast.add({ title: t('translations.badTag'), color: 'error', icon: 'i-lucide-circle-alert' })
}

// A new draft in the other language, linked to this one; the person reviews it there.
async function translateTo() {
  const result = await run('translate', () => call<{ document: Doc }>('/translate', 'POST', { locale: target.value }))
  if (result) await navigateTo(`/projects/${id}/legal/${result.document.id}`)
}

async function loadVersions() {
  versions.value = (await api<{ versions: any[] }>(`/admin/legal/documents/${docId}/versions`)).versions
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api<{ document: Doc, coverage: Coverage }>(`/admin/legal/documents/${docId}`)
    adopt(result.document, result.coverage)
    await loadVersions()
    await loadSiblings().catch(() => {})
  } catch (e: any) {
    error.value = e?.message || t('projectTools.legalDoc.loadError')
  } finally {
    loading.value = false
  }
}

async function run<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  busy.value = name
  error.value = ''
  try {
    return await fn()
  } catch (e: any) {
    error.value = e?.message || t('projectTools.shared.somethingWrong')
  } finally {
    busy.value = ''
  }
}

const call = <T = any>(path: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST', body?: unknown) => api<T>(`/admin/legal/documents/${docId}${path}`, { method, body })

async function save() {
  const body: Record<string, unknown> = {
    title: title.value,
    slug: slug.value,
    locale: locale.value,
    effectiveDate: effective.value || null,
    sections: sections.value.map(s => ({ id: s.id, heading: s.heading, body: s.body, locked: s.locked }))
  }
  // Sent only when edited, since saving a text turns an AI summary into a human one.
  if (tldrEdited.value) body.tldr = tldr.value.trim() || null
  const result = await run('save', () => call<{ document: Doc, coverage: Coverage }>('', 'PATCH', body))
  if (result) adopt(result.document, result.coverage)
}

async function publish() {
  const note = doc.value?.status === 'published' ? (prompt(t('projectTools.legalDoc.whatChanged')) ?? '') : ''
  const result = await run('publish', () => call<{ document: Doc }>('/publish', 'POST', { note }))
  if (result) { adopt(result.document); await loadVersions() }
}

async function act(name: string, path: string) {
  const result = await run(name, () => call<{ document: Doc }>(`/${path}`))
  if (result) adopt(result.document)
}

async function restore(version: number) {
  if (!confirm(t('projectTools.legalDoc.restoreConfirm', { version }))) return
  const result = await run('restore', () => call<{ document: Doc, coverage: Coverage }>(`/versions/${version}/restore`))
  if (result) adopt(result.document, result.coverage)
}

async function generateTldr() {
  const force = tldrSource.value === 'human'
  if (force && !confirm(t('projectTools.legalDoc.replaceSummaryConfirm'))) return
  const result = await run('tldr', () => call<{ document: Doc }>('/tldr/generate', 'POST', { force }))
  if (result) adopt(result.document)
}

async function checkWithAi() {
  const result = await run('check', () => call<{ coverage: Coverage, findings: LegalFinding[] }>('/check', 'POST', { ai: true }))
  if (result) { coverage.value = result.coverage; findings.value = result.findings }
}

const rewriting = ref('')
const instruction = ref('')
const proposal = ref('')

async function rewrite(sectionId: string) {
  const result = await run('rewrite', () => call<{ proposal: string }>(`/sections/${sectionId}/rewrite`, 'POST', { instruction: instruction.value }))
  if (result) proposal.value = result.proposal
}

async function applyProposal(sectionId: string) {
  const result = await run('apply', () => call<{ document: Doc, coverage: Coverage }>(`/sections/${sectionId}/rewrite`, 'POST', { instruction: instruction.value, apply: true }))
  if (result) { adopt(result.document, result.coverage); rewriting.value = ''; proposal.value = ''; instruction.value = '' }
}

function move(index: number, by: number) {
  const next = [...sections.value]
  const [item] = next.splice(index, 1)
  next.splice(index + by, 0, item!)
  sections.value = next
}

function addSection() {
  sections.value.push({ id: `new_${Date.now()}`, heading: t('projectTools.legalDoc.newSection'), body: '', source: 'human', locked: false, satisfies: [] })
}

async function remove() {
  if (!confirm(t('projectTools.legalDoc.deleteConfirm'))) return
  if (await run('delete', () => call('', 'DELETE'))) await navigateTo(`/projects/${id}/legal`)
}

onMounted(async () => {
  await load()
  // Sent by the import wizard when the person asked to analyse what they imported.
  if (route.query.analyse && doc.value) await checkWithAi()
})
</script>
