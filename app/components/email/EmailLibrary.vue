<script setup lang="ts">
/**
 * A folder of email templates: the masters (no project) or one project's
 * templates, where linked masters sit next to the project's own. Own
 * templates and masters open in the editor; a linked master opens a side
 * panel for this project's values, since its design belongs to the master.
 * Every card exports (HTML, JSON, API) from its menu or a right-click,
 * without opening the editor.
 */
import type { EmailDocument } from '#shared/email/blocks'
import { htmlToEmailDocument } from '#shared/email/import'
import { resolveTemplate, senderVariables } from '#shared/email/resolve'
import type { EmailTemplateDefinition } from '#shared/email/templates'
import type { EmailFolder, EmailTemplate } from '~~/server/utils/emails'
import type { AdminProject } from '~~/server/utils/projects'
import EmailCardPreview from '~/components/email/EmailCardPreview.vue'
import EmailTemplatePicker from '~/components/email/EmailTemplatePicker.vue'
import EmailLinkedPanel from '~/components/email/EmailLinkedPanel.vue'
import EmailApiDialog from '~/components/email/EmailApiDialog.vue'
import EmailTabs from '~/components/email/EmailTabs.vue'
import EmailTestDialog from '~/components/email/EmailTestDialog.vue'

const props = defineProps<{ project?: AdminProject | null }>()

const { api } = useAgent()
const toast = useToast()
const { t } = useI18n()
const projectId = computed(() => props.project?.id || null)

const templates = ref<EmailTemplate[]>([])
const folders = ref<EmailFolder[]>([])
const usage = ref<Record<string, number>>({})
const masters = ref<EmailTemplate[]>([])
const loading = ref(true)
const search = ref('')
const folderId = ref<string | null>(null)
const pickerOpen = ref(false)
const linkOpen = ref(false)
const openLinkedId = ref<string | null>(null)
const busy = ref(false)

async function load() {
  const query = projectId.value ? { project: projectId.value } : {}
  const [list, folderList] = await Promise.all([
    api<{ templates: EmailTemplate[], usage?: Record<string, number> }>('/admin/emails', { query }),
    api<{ folders: EmailFolder[] }>('/admin/email-folders', { query })
  ])
  templates.value = list.templates
  usage.value = list.usage || {}
  folders.value = folderList.folders
  loading.value = false
}
onMounted(() => load().catch(fail))

function fail(error: any) {
  loading.value = false
  toast.add({ title: error?.message || t('emailLibrary.library.genericError'), color: 'error' })
}

// ---- folders ------------------------------------------------------------------
const crumbs = computed(() => {
  const out: EmailFolder[] = []
  for (let at = folders.value.find(f => f.id === folderId.value); at; at = folders.value.find(f => f.id === at!.parentId)) out.unshift(at)
  return out
})
const subfolders = computed(() => search.value ? [] : folders.value.filter(f => f.parentId === folderId.value))
/** The top level shows each folder as a row of its templates, so everything is visible at a glance. */
const atRoot = computed(() => !folderId.value && !search.value)

function folderMenu(folder: EmailFolder) {
  return [[{ label: t('emailLibrary.common.rename'), icon: 'i-lucide-pencil', onSelect: () => renameFolder(folder) }, { label: t('emailLibrary.common.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => deleteFolder(folder) }]]
}

async function newFolder() {
  const name = window.prompt(t('emailLibrary.library.folderName'))?.trim()
  if (!name) return
  const { folder } = await api<{ folder: EmailFolder }>('/admin/email-folders', { method: 'POST', body: { name, project: projectId.value, parent: folderId.value } }).catch(fail) || {}
  if (folder) folders.value.push(folder)
}

async function renameFolder(folder: EmailFolder) {
  const name = window.prompt(t('emailLibrary.library.renameFolder'), folder.name)?.trim()
  if (!name || name === folder.name) return
  const res = await api<{ folder: EmailFolder }>(`/admin/email-folders/${folder.id}`, { method: 'PATCH', body: { name } }).catch(fail)
  if (res) folder.name = res.folder.name
}

async function deleteFolder(folder: EmailFolder) {
  if (!window.confirm(t('emailLibrary.library.deleteFolderConfirm', { name: folder.name }))) return
  await api(`/admin/email-folders/${folder.id}`, { method: 'DELETE' }).catch(fail)
  await load().catch(fail)
}

// ---- templates ----------------------------------------------------------------
const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return templates.value.filter(t => q
    ? `${t.name} ${t.key} ${t.master?.name || ''}`.toLowerCase().includes(q)
    : t.folderId === folderId.value)
})

/** Card groups: one per folder (a scrolling row) at the top level, then the loose templates as a grid. */
const groups = computed(() => [
  ...(atRoot.value ? subfolders.value.map(folder => ({ folder, items: templates.value.filter(t => t.folderId === folder.id) })) : []),
  { folder: null, items: visible.value }
])

/** What a card shows: masters with their sample values, project rows with this project's brand. */
function previewOf(t: EmailTemplate): EmailDocument | null {
  if (t.masterId && !t.master) return null
  return resolveTemplate(t, { master: t.master, brand: props.project }).document
}

function open(t: EmailTemplate) {
  if (t.masterId) openLinkedId.value = t.id
  else navigateTo(`/emails/${t.id}`)
}

async function create(body: Record<string, unknown>) {
  busy.value = true
  try {
    const { template } = await api<{ template: EmailTemplate }>('/admin/emails', { method: 'POST', body: { ...body, project: projectId.value, folder: folderId.value } })
    if (template.masterId) {
      templates.value.unshift(template)
      linkOpen.value = false
      openLinkedId.value = template.id
    } else {
      await navigateTo(`/emails/${template.id}`)
    }
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}

function onPick(payload: { template: EmailTemplateDefinition }) {
  pickerOpen.value = false
  create({ starterId: payload.template.id, name: payload.template.name })
}

function onBlank() {
  pickerOpen.value = false
  create({})
}

const fileInput = ref<HTMLInputElement | null>(null)
async function importHtml(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const html = await file.text()
  // One raw-HTML block: the design stays as written; edit it or rebuild with blocks.
  const document = htmlToEmailDocument(html)
  if (document.settings.title === 'Untitled email') document.settings.title = file.name.replace(/\.html?$/i, '')
  await create({ document, name: document.settings.title })
  if (fileInput.value) fileInput.value.value = ''
}

// ---- JSON backup: every template of this project (or every master) in one file ----
const jsonInput = ref<HTMLInputElement | null>(null)
const transferItems = computed(() => [[
  { label: t('emailLibrary.library.importHtml'), icon: 'i-lucide-file-code', onSelect: () => fileInput.value?.click() },
  { label: t('emailLibrary.library.importJson'), icon: 'i-lucide-file-json', onSelect: () => jsonInput.value?.click() },
  { label: t('emailLibrary.library.exportAll'), icon: 'i-lucide-download', onSelect: exportAll }
]])

async function exportAll() {
  try {
    const data = await api<{ templates: unknown[] }>('/admin/emails/export', { query: projectId.value ? { project: projectId.value } : {} })
    const name = (props.project?.name || 'masters').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'emails'
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const a = window.document.createElement('a')
    a.href = url
    a.download = `helpbites-emails-${name}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    fail(error)
  }
}

type ImportSummary = { created: number, updated: number, unchanged: number, skipped: number, failed: number, results: { key: string, error?: string }[] }

async function importJson(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (jsonInput.value) jsonInput.value.value = ''
  if (!file) return
  try {
    const parsed = JSON.parse(await file.text())
    const templates: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.templates) ? parsed.templates : []
    if (!templates.length) throw new Error(t('emailLibrary.library.noTemplatesInFile'))
    // The endpoint takes 100 at a time; a dry run first says what will change.
    const run = async (dryRun: boolean) => {
      const total: ImportSummary = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, results: [] }
      for (let i = 0; i < templates.length; i += 100) {
        const res = await api<ImportSummary>('/admin/emails/import', { method: 'POST', body: { project: projectId.value, mode: 'upsert', dryRun, templates: templates.slice(i, i + 100) } })
        for (const k of ['created', 'updated', 'unchanged', 'skipped', 'failed'] as const) total[k] += res[k]
        total.results.push(...res.results)
      }
      return total
    }
    const plan = await run(true)
    const errors = plan.results.filter(r => r.error).map(r => `${r.key}: ${r.error}`)
    if (!window.confirm(`${t('emailLibrary.library.importConfirm', { file: file.name }, templates.length)}\n\n${t('emailLibrary.library.importPlan', { created: plan.created, updated: plan.updated, unchanged: plan.unchanged })}${plan.failed ? t('emailLibrary.library.importPlanErrors', { failed: plan.failed, errors: errors.slice(0, 5).join('\n') }) : ''}`)) return
    const done = await run(false)
    toast.add({ title: t('emailLibrary.library.importedToast', { created: done.created, updated: done.updated }), description: done.failed ? t('emailLibrary.library.importFailed', { failed: done.failed }) : undefined, color: done.failed ? 'warning' : 'success' })
    await load()
  } catch (error) {
    fail(error)
  }
}

async function openLinkPicker() {
  linkOpen.value = true
  if (!masters.value.length) masters.value = (await api<{ templates: EmailTemplate[] }>('/admin/emails').catch(fail))?.templates || []
}

async function duplicate(t: EmailTemplate) {
  const res = await api<{ template: EmailTemplate }>(`/admin/emails/${t.id}/duplicate`, { method: 'POST' }).catch(fail)
  if (res) templates.value.unshift({ ...res.template, master: t.master })
}

/** A new master with this template's design and variables; the project keeps its own copy. */
async function copyToMasters(tpl: EmailTemplate) {
  const res = await api<{ template: EmailTemplate }>('/admin/emails', { method: 'POST', body: { name: tpl.name, document: tpl.document, variables: tpl.variables } }).catch(fail)
  if (res) toast.add({ title: t('emailLibrary.library.copiedToMasters', { name: tpl.name }), color: 'success', actions: [{ label: t('emailLibrary.library.openMaster'), onClick: () => navigateTo(`/emails/${res.template.id}`) }] })
}

async function move(t: EmailTemplate, folder: string | null) {
  const res = await api<{ template: EmailTemplate }>(`/admin/emails/${t.id}`, { method: 'PATCH', body: { folder } }).catch(fail)
  if (res) t.folderId = res.template.folderId
}

async function remove(tpl: EmailTemplate) {
  const what = tpl.masterId ? t('emailLibrary.library.removeMasterConfirm', { name: tpl.master?.name || tpl.name }) : t('emailLibrary.library.deleteConfirm', { name: tpl.name })
  if (!window.confirm(what)) return
  const res = await api(`/admin/emails/${tpl.id}`, { method: 'DELETE' }).catch(fail)
  if (res) templates.value = templates.value.filter(x => x.id !== tpl.id)
}

const exportItemsFor = useEmailExport()
const apiTemplate = ref<EmailTemplate | null>(null)
const apiOpen = ref(false)
const testTemplate = ref<EmailTemplate | null>(null)
const testOpen = ref(false)

function exportSource(t: EmailTemplate) {
  return {
    name: t.master?.name || t.name,
    rendered: previewOf(t)!,
    design: (t.master?.document || t.document)!,
    variables: senderVariables(t, t.master)
  }
}

function menu(tpl: EmailTemplate) {
  return [
    [{ label: tpl.masterId ? t('emailLibrary.common.open') : t('emailLibrary.common.edit'), icon: 'i-lucide-pencil', onSelect: () => open(tpl) }, { label: t('emailLibrary.common.duplicate'), icon: 'i-lucide-copy', onSelect: () => duplicate(tpl) }, { label: t('emailLibrary.library.sendTest'), icon: 'i-lucide-send', onSelect: () => { testTemplate.value = tpl; testOpen.value = true } }],
    [{
      label: t('emailLibrary.library.export'),
      icon: 'i-lucide-code-xml',
      disabled: !previewOf(tpl),
      children: exportItemsFor(() => exportSource(tpl), () => { apiTemplate.value = tpl; apiOpen.value = true })
    }],
    [{
      label: t('emailLibrary.library.moveTo'),
      icon: 'i-lucide-folder-input',
      children: [{ label: t('emailLibrary.library.topLevel'), onSelect: () => move(tpl, null) }, ...folders.value.map(f => ({ label: f.name, onSelect: () => move(tpl, f.id) }))]
    }, ...(props.project && !tpl.masterId ? [{ label: t('emailLibrary.library.copyToMasters'), icon: 'i-lucide-library', onSelect: () => copyToMasters(tpl) }] : [])],
    [{ label: tpl.masterId ? t('emailLibrary.library.removeFromProject') : t('emailLibrary.common.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => remove(tpl) }]
  ]
}

function onLinkedChange(updated: EmailTemplate | null, removedId?: string) {
  if (removedId) templates.value = templates.value.filter(t => t.id !== removedId)
  if (!updated) return
  const i = templates.value.findIndex(t => t.id === updated.id)
  if (i >= 0) templates.value[i] = updated
  if (!updated.masterId) navigateTo(`/emails/${updated.id}`) // detached: it is an editable template now
}

const linkedOpen = computed({ get: () => !!openLinkedId.value, set: (v) => { if (!v) openLinkedId.value = null } })
const linkedTemplate = computed(() => templates.value.find(t => t.id === openLinkedId.value) || null)
const linkedMasterIds = computed(() => new Set(templates.value.map(t => t.masterId).filter(Boolean)))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project?.id" :title="$t('nav.email')">
      <template #title><EmailTabs current="templates" :masters="!project" /></template>
      <template #actions>
        <UInput v-model="search" icon="i-lucide-search" :placeholder="$t('common.search')" size="sm" class="hidden w-44 sm:block" />
        <UTooltip :text="$t('emailLibrary.library.newFolder')"><UButton icon="i-lucide-folder-plus" size="sm" color="neutral" variant="ghost" square class="text-muted" :aria-label="$t('emailLibrary.library.newFolder')" @click="newFolder" /></UTooltip>
        <UDropdownMenu :items="transferItems">
          <UTooltip :text="$t('emailLibrary.library.importExport')"><UButton icon="i-lucide-file-up" size="sm" color="neutral" variant="ghost" square class="text-muted" :aria-label="$t('emailLibrary.library.importExport')" /></UTooltip>
        </UDropdownMenu>
        <input ref="fileInput" type="file" accept=".html,.htm,text/html" class="hidden" @change="importHtml">
        <input ref="jsonInput" type="file" accept=".json,application/json" class="hidden" @change="importJson">
        <UButton v-if="project" icon="i-lucide-link" :label="$t('emailLibrary.library.addMaster')" size="sm" color="neutral" variant="outline" @click="openLinkPicker" />
        <UButton icon="i-lucide-plus" :label="project ? $t('emailLibrary.library.newTemplate') : $t('emailLibrary.library.newMaster')" size="sm" :loading="busy" @click="pickerOpen = true" />
      </template>
    </PageHeader>
    <p class="shrink-0 border-b border-default px-6 py-2.5 text-[13px] text-muted">
      <template v-if="project">{{ $t('emailLibrary.library.projectSubtitle') }}</template>
      <template v-else>{{ $t('emailLibrary.library.masterSubtitle') }}</template>
    </p>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
      <nav v-if="crumbs.length && !search" class="mb-4 flex flex-wrap items-center gap-1 text-sm" :aria-label="$t('emailLibrary.library.folder')">
        <button type="button" class="text-muted hover:text-default" @click="folderId = null">{{ $t('emailLibrary.library.all') }}</button>
        <template v-for="c in crumbs" :key="c.id">
          <UIcon name="i-lucide-chevron-right" class="size-3.5 text-dimmed" />
          <button type="button" class="hover:text-default" :class="c.id === folderId ? 'font-medium text-highlighted' : 'text-muted'" @click="folderId = c.id">{{ c.name }}</button>
        </template>
      </nav>

      <div v-if="subfolders.length && !atRoot" class="mb-5 grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
        <div v-for="f in subfolders" :key="f.id" class="group flex items-center gap-2 rounded-lg border border-default bg-default px-3 py-2 hover:border-accented">
          <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" @click="folderId = f.id">
            <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-muted" /><span class="truncate">{{ f.name }}</span>
          </button>
          <UDropdownMenu :items="folderMenu(f)">
            <UButton icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" :aria-label="$t('emailLibrary.library.folderActions')" class="opacity-60 group-hover:opacity-100" />
          </UDropdownMenu>
        </div>
      </div>

      <div v-if="loading" class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
        <USkeleton v-for="n in 4" :key="n" class="h-64 rounded-xl" />
      </div>
      <template v-else>
      <section v-for="g in groups" :key="g.folder?.id || 'loose'" :class="g.folder && 'mb-6'">
        <div v-if="g.folder" class="group mb-2 flex items-center gap-1">
          <button type="button" class="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm font-medium hover:bg-elevated" @click="folderId = g.folder.id">
            <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-muted" /><span class="truncate">{{ g.folder.name }}</span>
            <span class="text-xs font-normal text-dimmed">{{ g.items.length }}</span>
            <UIcon name="i-lucide-chevron-right" class="size-3.5 shrink-0 text-dimmed" />
          </button>
          <UDropdownMenu :items="folderMenu(g.folder)">
            <UButton icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" :aria-label="$t('emailLibrary.library.folderActions')" class="opacity-60 group-hover:opacity-100" />
          </UDropdownMenu>
        </div>
        <p v-if="g.folder && !g.items.length" class="px-1 text-xs text-dimmed">{{ $t('emailLibrary.library.noTemplatesInFolder') }}</p>
        <div :class="g.folder ? 'flex snap-x gap-4 overflow-x-auto pb-2' : 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4'">
        <UContextMenu v-for="t in g.items" :key="t.id" :items="menu(t)">
        <article class="group flex flex-col overflow-hidden rounded-xl border border-default bg-default transition hover:border-accented hover:shadow-sm" :class="g.folder && 'w-60 shrink-0 snap-start'">
          <button type="button" class="relative block h-48 overflow-hidden bg-muted text-left" :aria-label="$t('emailLibrary.library.openTemplate', { name: t.name })" @click="open(t)">
            <div class="origin-top-left scale-[0.42] w-[238%]">
              <EmailCardPreview v-if="previewOf(t)" :document="previewOf(t)!" />
            </div>
            <span v-if="t.masterId" class="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-inverted shadow-sm"><UIcon name="i-lucide-link" class="size-3" />{{ $t('emailLibrary.common.master') }}</span>
          </button>
          <div class="flex items-start gap-2 border-t border-default px-3 py-2.5">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ t.master?.name || t.name }}</p>
              <p class="truncate text-xs text-muted">
                <template v-if="project"><code class="font-mono">{{ t.key }}</code></template>
                <template v-else>{{ usage[t.id] ? $t('emailLibrary.library.usedBy', usage[t.id]) : $t('emailLibrary.library.notUsed') }}</template>
                · {{ new Date(Math.max(t.updatedAt, t.master?.updatedAt || 0)).toLocaleDateString() }}
              </p>
            </div>
            <UDropdownMenu :items="menu(t)">
              <UButton icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" :aria-label="$t('emailLibrary.library.templateActions')" />
            </UDropdownMenu>
          </div>
        </article>
        </UContextMenu>
        </div>
      </section>
      <EmptyState
        v-if="!groups.some(g => g.items.length)"
        icon="i-lucide-mail"
        :title="search ? $t('emailLibrary.library.noMatch') : $t('emailLibrary.library.noTemplatesYet')"
        :description="search ? $t('emailLibrary.library.noMatchDescription') : project ? $t('emailLibrary.library.emptyProjectDescription') : $t('emailLibrary.library.emptyMasterDescription')"
      >
        <UButton v-if="!search" icon="i-lucide-plus" :label="project ? $t('emailLibrary.library.newTemplate') : $t('emailLibrary.library.newMaster')" @click="pickerOpen = true" />
      </EmptyState>
      </template>
    </div>

    <EmailTemplatePicker
      v-model:open="pickerOpen"
      :busy="busy"
      :title="project ? $t('emailLibrary.library.newTemplate') : $t('emailLibrary.library.newMaster')"
      :description="$t('emailLibrary.library.pickerDescription')"
      @select="onPick"
      @blank="onBlank"
    />

    <UModal v-model:open="linkOpen" :title="$t('emailLibrary.library.addMasterTitle')" :description="$t('emailLibrary.library.addMasterDescription')">
      <template #body>
        <i18n-t v-if="!masters.length" keypath="emailLibrary.library.noMastersYet" tag="p" class="text-sm text-muted">
          <template #link><NuxtLink to="/emails" class="underline">{{ $t('emailLibrary.library.createOne') }}</NuxtLink></template>
        </i18n-t>
        <ul v-else class="divide-y divide-default">
          <li v-for="m in masters" :key="m.id" class="flex items-center gap-3 py-2">
            <span class="min-w-0 flex-1 truncate text-sm">{{ m.name }}</span>
            <UBadge v-if="linkedMasterIds.has(m.id)" :label="$t('emailLibrary.library.inUse')" color="neutral" variant="soft" size="sm" />
            <UButton :label="$t('emailLibrary.common.add')" size="xs" color="primary" variant="soft" :loading="busy" @click="create({ master: m.id })" />
          </li>
        </ul>
      </template>
    </UModal>

    <EmailApiDialog v-model:open="apiOpen" :template="apiTemplate" @key="(key) => { if (apiTemplate) apiTemplate.key = key }" />
    <EmailTestDialog v-model:open="testOpen" :template="testTemplate" />

    <USlideover v-model:open="linkedOpen" :title="linkedTemplate?.master?.name || $t('emailLibrary.common.master')" :description="$t('emailLibrary.library.linkedDescription')" :ui="{ content: 'max-w-xl' }">
      <template #body>
        <EmailLinkedPanel v-if="linkedTemplate && project" :template="linkedTemplate" :project="project" @change="onLinkedChange" />
      </template>
    </USlideover>
  </div>
</template>
