<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="saved?.name || $t('projectTools.forms.form')" :crumbs="[{ label: $t('sections.forms'), to: `/projects/${id}/forms` }]">
      <template #actions>
        <UBadge v-if="saved" :label="saved.active ? $t('projectTools.forms.live') : $t('projectTools.forms.closed')" :color="saved.active ? 'success' : 'neutral'" variant="soft" size="sm" class="hidden sm:inline-flex" />
        <UButton v-if="saved" :label="$t('projectTools.shared.save')" size="sm" :disabled="!dirty" :loading="busy === 'save'" @click="save()" />
        <UDropdownMenu v-if="saved" :items="menu">
          <UButton icon="i-lucide-ellipsis" size="sm" color="neutral" variant="ghost" square :aria-label="$t('projectTools.shared.more')" />
        </UDropdownMenu>
      </template>
    </PageHeader>

    <div v-if="loading" class="mx-auto w-full max-w-6xl space-y-3 px-6 py-8"><USkeleton v-for="n in 4" :key="n" class="h-24 w-full" /></div>
    <p v-else-if="!saved" class="px-6 py-8 text-[13px] text-error">{{ error || $t('projectTools.forms.notFound') }}</p>

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div class="min-w-0 space-y-5">
          <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

          <section class="grid gap-4 rounded-xl border border-default p-4 sm:grid-cols-2">
            <UFormField :label="$t('projectTools.forms.name')">
              <UInput v-model="form.name" :maxlength="LEAD_FORM_LIMITS.name" class="w-full" />
            </UFormField>
            <UFormField :label="$t('projectTools.forms.key')" :help="$t('projectTools.forms.keyHint')" :error="keyValid ? undefined : $t('projectTools.forms.keyInvalid')">
              <UInput v-model="form.key" class="w-full font-mono" />
            </UFormField>
            <USwitch v-model="form.active" :label="$t('projectTools.forms.active')" :description="$t('projectTools.forms.activeHint')" class="sm:col-span-2" />
          </section>

          <section class="space-y-3">
            <div class="flex items-baseline justify-between">
              <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.forms.fields') }}</h3>
              <span class="text-xs tabular-nums text-dimmed">{{ form.fields.length }} / {{ LEAD_FORM_LIMITS.fields }}</span>
            </div>
            <div v-for="(field, i) in form.fields" :key="field.id" class="rounded-xl border border-default p-4">
              <div class="flex items-center gap-1">
                <UIcon :name="FIELD_ICONS[field.type]" class="size-4 text-muted" />
                <span class="mr-auto ml-1.5 text-xs font-medium text-muted">{{ $t(`projectTools.forms.types.${field.type}`) }}<span v-if="field.type !== 'email' && field.type !== 'name'" class="font-mono"> · {{ field.key }}</span></span>
                <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="i === 0" :aria-label="$t('projectTools.forms.moveUp')" @click="move(i, -1)" />
                <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" square :disabled="i === form.fields.length - 1" :aria-label="$t('projectTools.forms.moveDown')" @click="move(i, 1)" />
                <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :disabled="field.type === 'email'" :aria-label="$t('projectTools.forms.removeField')" @click="form.fields.splice(i, 1)" />
              </div>
              <div class="mt-3 grid gap-3 sm:grid-cols-2">
                <UFormField :label="$t('projectTools.forms.label')">
                  <UInput v-model="field.label" :maxlength="LEAD_FORM_LIMITS.label" :placeholder="LEAD_FIELD_LABELS[field.type]" class="w-full" @update:model-value="followKey(field)" />
                </UFormField>
                <UFormField v-if="field.type !== 'checkbox' && field.type !== 'select'" :label="$t('projectTools.forms.placeholder')">
                  <UInput v-model="field.placeholder" :maxlength="LEAD_FORM_LIMITS.placeholder" class="w-full" />
                </UFormField>
                <UFormField v-if="field.type !== 'email' && field.type !== 'name'" :label="$t('projectTools.forms.fieldKey')" :help="$t('projectTools.forms.fieldKeyHint')" :error="ATTRIBUTE_KEY_RE.test(field.key) ? undefined : $t('projectTools.forms.fieldKeyInvalid')">
                  <UInput v-model="field.key" class="w-full font-mono" @update:model-value="keyEdited.add(field.id)" />
                </UFormField>
                <UFormField v-if="field.type === 'select'" :label="$t('projectTools.forms.options')" :hint="$t('projectTools.forms.optionsHint')" class="sm:col-span-2">
                  <UInputTags v-model="field.options" :max="LEAD_FORM_LIMITS.options" :placeholder="$t('projectTools.forms.addOption')" class="w-full" />
                </UFormField>
              </div>
              <USwitch v-if="field.type !== 'email'" v-model="field.required" :label="field.type === 'checkbox' ? $t('projectTools.forms.mustTick') : $t('projectTools.forms.required')" size="sm" class="mt-3" />
            </div>
            <UDropdownMenu :items="addItems">
              <UButton icon="i-lucide-plus" :label="$t('projectTools.forms.addField')" color="neutral" variant="soft" size="sm" :disabled="form.fields.length >= LEAD_FORM_LIMITS.fields" />
            </UDropdownMenu>
          </section>

          <section class="space-y-3 rounded-xl border border-default p-4">
            <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.forms.words') }}</h3>
            <UFormField :label="$t('projectTools.forms.content.title')">
              <UInput v-model="form.content.title" :maxlength="LEAD_FORM_LIMITS.title" class="w-full font-medium" />
            </UFormField>
            <UFormField :label="$t('projectTools.forms.content.description')">
              <UTextarea v-model="form.content.description" :maxlength="LEAD_FORM_LIMITS.description" autoresize :rows="2" :maxrows="6" class="w-full" />
            </UFormField>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField :label="$t('projectTools.forms.content.buttonLabel')">
                <UInput v-model="form.content.buttonLabel" :maxlength="LEAD_FORM_LIMITS.button" class="w-full" />
              </UFormField>
              <UFormField :label="$t('projectTools.forms.content.successTitle')">
                <UInput v-model="form.content.successTitle" :maxlength="LEAD_FORM_LIMITS.title" class="w-full" />
              </UFormField>
            </div>
            <UFormField :label="$t('projectTools.forms.content.successMessage')">
              <UInput v-model="form.content.successMessage" :maxlength="LEAD_FORM_LIMITS.message" class="w-full" />
            </UFormField>
            <UFormField v-if="form.settings.doubleOptIn" :label="$t('projectTools.forms.content.confirmMessage')" :hint="$t('projectTools.forms.content.confirmMessageHint')">
              <UInput v-model="form.content.confirmMessage" :maxlength="LEAD_FORM_LIMITS.message" class="w-full" />
            </UFormField>
            <UFormField :label="$t('projectTools.forms.content.footnote')" :hint="$t('projectTools.shared.optional')">
              <UInput v-model="form.content.footnote" :maxlength="LEAD_FORM_LIMITS.message" :placeholder="$t('projectTools.forms.content.footnotePlaceholder')" class="w-full" />
            </UFormField>
          </section>

          <section class="rounded-xl border border-default p-4">
            <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.forms.look') }}</h3>
            <div class="mt-3 grid gap-4 sm:grid-cols-3">
              <UFormField v-for="colour in colourFields" :key="colour.key" :label="colour.label" :hint="form.style[colour.key] ? undefined : colour.empty">
                <div class="flex items-center gap-2">
                  <input type="color" :value="form.style[colour.key] || colour.fallback" class="h-8 w-10 shrink-0 cursor-pointer rounded border border-default bg-transparent" :aria-label="colour.label" @input="form.style[colour.key] = ($event.target as HTMLInputElement).value">
                  <UInput v-model="form.style[colour.key]" :placeholder="colour.fallback" class="w-full font-mono" />
                  <UButton v-if="form.style[colour.key]" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.forms.reset')" @click="form.style[colour.key] = ''" />
                </div>
              </UFormField>
            </div>
            <div class="mt-4 grid gap-4 sm:grid-cols-3">
              <UFormField :label="$t('projectTools.forms.layout')">
                <USelect v-model="form.style.layout" :items="layoutItems" value-key="value" class="w-full" />
              </UFormField>
              <UFormField :label="$t('projectTools.forms.radius')" :hint="`${form.style.radius}px`">
                <input v-model.number="form.style.radius" type="range" min="0" :max="LEAD_FORM_LIMITS.radius" step="1" class="mt-2 w-full accent-primary-600">
              </UFormField>
              <UFormField :label="$t('projectTools.forms.font')">
                <USelect v-model="form.style.font" :items="fontItems" value-key="value" class="w-full" />
              </UFormField>
            </div>
          </section>

          <section class="space-y-4 rounded-xl border border-default p-4">
            <div>
              <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.forms.after') }}</h3>
              <p class="mt-1 text-xs text-muted">{{ $t('projectTools.forms.afterHint') }}</p>
            </div>
            <USwitch v-model="form.settings.doubleOptIn" :label="$t('projectTools.forms.doubleOptIn')" :description="$t('projectTools.forms.doubleOptInHint')" />
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField v-if="form.settings.doubleOptIn" :label="$t('projectTools.forms.confirmTemplate')" :help="$t('projectTools.forms.confirmTemplateHint')">
                <OptionalSelect v-model="form.settings.confirmTemplate" :items="templateItems" :none-label="$t('projectTools.forms.builtInConfirm')" class="w-full" />
              </UFormField>
              <UFormField :label="$t('projectTools.forms.welcomeTemplate')" :help="$t('projectTools.forms.welcomeTemplateHint')">
                <OptionalSelect v-model="form.settings.welcomeTemplate" :items="templateItems" :none-label="$t('projectTools.forms.noWelcome')" class="w-full" />
              </UFormField>
              <UFormField :label="$t('projectTools.forms.sequence')" :help="$t('projectTools.forms.sequenceHint')">
                <OptionalSelect v-model="form.settings.sequence" :items="sequenceItems" :none-label="$t('projectTools.forms.noSequence')" class="w-full" />
              </UFormField>
              <UFormField :label="$t('projectTools.forms.tags')" :help="$t('projectTools.forms.tagsHint')">
                <UInputTags v-model="form.settings.tags" :max="LEAD_FORM_LIMITS.tags" :placeholder="$t('projectTools.forms.addTag')" class="w-full" />
              </UFormField>
              <UFormField :label="$t('projectTools.forms.redirectUrl')" :help="$t('projectTools.forms.redirectUrlHint')" class="sm:col-span-2">
                <UInput v-model="form.settings.redirectUrl" placeholder="https://" class="w-full font-mono" />
              </UFormField>
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton icon="i-lucide-mail-plus" :label="$t('projectTools.forms.newTemplate')" size="xs" color="neutral" variant="ghost" :to="`/projects/${id}/email`" />
              <UButton icon="i-lucide-workflow" :label="$t('projectTools.forms.manageSequences')" size="xs" color="neutral" variant="ghost" :to="`/projects/${id}/campaigns?view=sequences`" />
            </div>
          </section>

          <section class="rounded-xl border border-default p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.forms.install') }}</h3>
              <div class="inline-flex rounded-lg bg-elevated p-0.5" role="tablist">
                <button v-for="tab in installTabs" :key="tab.value" type="button" role="tab" :aria-selected="installTab === tab.value" class="h-7 rounded-md px-2.5 text-xs font-medium transition-colors" :class="installTab === tab.value ? 'bg-default text-highlighted shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-default'" @click="installTab = tab.value">{{ tab.label }}</button>
              </div>
            </div>
            <p class="mt-2 text-[13px] text-muted">{{ $t(`projectTools.forms.installHints.${installTab}`) }}</p>
            <p v-if="dirty" class="mt-1 text-xs text-warning">{{ $t('projectTools.forms.saveFirst') }}</p>
            <CodeBlock :code="snippet" :lang="installTab === 'api' ? 'bash' : installTab === 'swift' ? 'js' : 'html'" class="mt-3" />
            <div class="mt-2 flex flex-wrap gap-2">
              <UButton icon="i-lucide-copy" :label="$t('projectTools.forms.copy')" size="xs" color="neutral" variant="soft" @click="copy(snippet)" />
              <UButton v-if="installTab === 'link'" icon="i-lucide-external-link" :label="$t('projectTools.forms.openPage')" size="xs" color="neutral" variant="ghost" :to="pageUrl" target="_blank" />
              <UButton icon="i-lucide-book-open" :label="$t('projectTools.forms.readGuide')" size="xs" color="neutral" variant="ghost" :to="installTab === 'swift' ? '/docs/forms#plug-and-play-swift' : '/docs/forms'" target="_blank" />
            </div>
          </section>

          <section class="space-y-3 rounded-xl border border-default p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.forms.leads') }}</h3>
              <span class="text-xs tabular-nums text-muted">{{ $t('projectTools.forms.leadCount', stats.leads) }} · {{ $t('projectTools.forms.confirmedCount', { count: stats.confirmed.toLocaleString() }) }}</span>
            </div>
            <p class="text-xs text-muted">{{ $t('projectTools.forms.leadsHint') }}</p>
            <p v-if="!leads.length" class="text-xs text-dimmed">{{ $t('projectTools.forms.noLeads') }}</p>
            <ul v-else class="divide-y divide-default rounded-lg border border-default">
              <li v-for="c in leads" :key="c.id" class="flex items-center gap-2 px-3 py-2 text-[13px]">
                <span class="min-w-0 flex-1 truncate">{{ c.name || c.email }}<span v-if="c.name" class="text-muted"> · {{ c.email }}</span></span>
                <UBadge :label="$t(`contacts.subscription.${c.subscription}.label`)" :color="SUBSCRIPTION_STATUS[c.subscription].color" variant="subtle" size="sm" />
                <span class="w-14 text-right text-xs text-muted">{{ logTime(c.createdAt || '') }}</span>
              </li>
            </ul>
            <div class="flex flex-wrap gap-2">
              <UButton v-if="segmentId" icon="i-lucide-users" :label="$t('projectTools.forms.showAll')" size="xs" color="neutral" variant="soft" :to="`/projects/${id}/contacts?segment=${segmentId}`" />
              <UButton v-if="segmentId" icon="i-lucide-megaphone" :label="$t('projectTools.forms.emailThem')" size="xs" color="neutral" variant="ghost" :to="`/projects/${id}/campaigns`" />
            </div>
          </section>
        </div>

        <aside class="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <div class="flex items-center gap-1">
            <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.forms.preview') }}</h3>
            <div class="inline-flex rounded-lg bg-elevated p-0.5">
              <button v-for="state in (['form', 'success'] as const)" :key="state" type="button" class="h-6 rounded-md px-2 text-xs font-medium" :class="previewState === state ? 'bg-default text-highlighted shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted'" @click="previewState = state">{{ $t(`projectTools.forms.previewStates.${state}`) }}</button>
            </div>
            <UButton :icon="previewTheme === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.forms.toggleTheme')" @click="previewTheme = previewTheme === 'dark' ? 'light' : 'dark'" />
          </div>
          <div class="rounded-2xl p-6 transition-colors" :class="previewTheme === 'dark' ? 'bg-stone-950' : 'bg-stone-100'">
            <div ref="previewEl" class="w-full" />
          </div>
          <p class="text-xs text-dimmed">{{ $t('projectTools.forms.previewHint') }}</p>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One lead form: its fields, its words and look (with a live preview drawn by
 * the same forms.js sites load), what happens after someone signs up, how to
 * put it on a site or in an app, and the people it brought in.
 */
import { ATTRIBUTE_KEY_RE, type Contact } from '#shared/contacts'
import type { Sequence } from '#shared/marketing'
import { LEAD_FIELD_LABELS, LEAD_FIELD_TYPES, LEAD_FORM_FONTS, LEAD_FORM_KEY, LEAD_FORM_LIMITS, fieldKeyFrom, newFieldId, type LeadFieldType, type LeadForm, type LeadFormField } from '#shared/leadForms'
import type { EmailTemplate } from '~~/server/utils/emails'
import { SUBSCRIPTION_STATUS } from '~/utils/contactStatus'
import { logTime } from '~/utils/emailStatus'

definePageMeta({ middleware: 'agent' })

type Editable = Pick<LeadForm, 'name' | 'key' | 'active' | 'fields' | 'content' | 'style' | 'settings'>

const FIELD_ICONS: Record<LeadFieldType, string> = {
  email: 'i-lucide-at-sign', name: 'i-lucide-user', text: 'i-lucide-type', textarea: 'i-lucide-align-left', number: 'i-lucide-hash',
  url: 'i-lucide-link', phone: 'i-lucide-phone', select: 'i-lucide-list', checkbox: 'i-lucide-square-check'
}

const { api, projects, loadProjects } = useAgent()
const { t } = useI18n()
const toast = useToast()
const appUrl = useAppUrl()
const route = useRoute()
const id = String(route.params.id)
const formId = String(route.params.formId)
const project = computed(() => projects.value.find(p => p.id === id) || null)

const saved = ref<LeadForm | null>(null)
const form = ref<Editable>({ name: '', key: '', active: true, fields: [], content: { title: '', description: '', buttonLabel: '', successTitle: '', successMessage: '', confirmMessage: '', footnote: '' }, style: { accent: '', background: '', text: '', radius: 12, font: 'system', layout: 'stacked' }, settings: { doubleOptIn: true, confirmTemplate: '', welcomeTemplate: '', sequence: '', tags: [], redirectUrl: '' } })
const snapshotText = ref('')
const loading = ref(true)
const error = ref('')
const busy = ref('')
const templates = ref<EmailTemplate[]>([])
const sequences = ref<Sequence[]>([])
const leads = ref<Contact[]>([])
// Fields whose key the operator typed: those no longer follow the label.
const keyEdited = reactive(new Set<string>())

const editable = (f: LeadForm): Editable => JSON.parse(JSON.stringify({ name: f.name, key: f.key, active: f.active, fields: f.fields, content: f.content, style: f.style, settings: f.settings }))
const snapshot = (f: Editable) => JSON.stringify(f)
const dirty = computed(() => !!saved.value && snapshot(form.value) !== snapshotText.value)
const keyValid = computed(() => LEAD_FORM_KEY.test(form.value.key.trim()))

function fill(next: LeadForm) {
  saved.value = next
  form.value = editable(next)
  snapshotText.value = snapshot(form.value)
  keyEdited.clear()
  for (const f of next.fields) keyEdited.add(f.id)
}

async function load() {
  try {
    fill((await api<{ form: LeadForm }>(`/admin/lead-forms/${formId}`)).form)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.forms.loadError')
  } finally {
    loading.value = false
  }
}

function loadLeads() {
  api<{ contacts: Contact[] }>('/contacts', { query: { project: id, leadForm: formId, limit: 10 } }).then((r) => { leads.value = r.contacts }).catch(() => {})
}

async function save(quiet = false) {
  if (!keyValid.value) { error.value = t('projectTools.forms.keyInvalid'); return false }
  busy.value = 'save'
  error.value = ''
  try {
    fill((await api<{ form: LeadForm }>(`/admin/lead-forms/${formId}`, { method: 'PATCH', body: { ...form.value, key: form.value.key.trim() } })).form)
    if (!quiet) toast.add({ title: t('projectTools.forms.saved'), icon: 'i-lucide-check', color: 'success' })
    return true
  } catch (e: any) {
    error.value = e?.message || t('projectTools.forms.saveError')
    return false
  } finally {
    busy.value = ''
  }
}

async function remove() {
  if (!saved.value || !confirm(t('projectTools.forms.deleteConfirm', { name: saved.value.name }))) return
  try {
    await api(`/admin/lead-forms/${formId}`, { method: 'DELETE' })
    await navigateTo(`/projects/${id}/forms`)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.forms.saveError')
  }
}

const stats = computed(() => saved.value?.stats || { leads: 0, confirmed: 0 })
const segmentId = computed(() => saved.value?.segment || '')
const pageUrl = computed(() => `${appUrl.value}${saved.value?.pagePath || ''}`)
const menu = computed(() => [[
  { label: t('projectTools.forms.openPage'), icon: 'i-lucide-external-link', onSelect: () => window.open(pageUrl.value, '_blank') },
  { label: t('projectTools.forms.openJson'), icon: 'i-lucide-braces', onSelect: () => window.open(`${appUrl.value}${saved.value?.path}`, '_blank') }
], [
  { label: t('projectTools.forms.deleteForm'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: remove }
]])

// ---- fields ----
function move(index: number, by: number) {
  const fields = form.value.fields
  const [field] = fields.splice(index, 1)
  fields.splice(index + by, 0, field!)
}

/** A new field's key follows its label until the operator types one. */
function followKey(field: LeadFormField) {
  if (field.type === 'email' || field.type === 'name' || keyEdited.has(field.id)) return
  field.key = uniqueKey(fieldKeyFrom(field.label || LEAD_FIELD_LABELS[field.type]), field.id)
}

function uniqueKey(base: string, except = '') {
  const taken = new Set(form.value.fields.filter(f => f.id !== except).map(f => f.key))
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base.slice(0, 36)}_${n}`
  return key
}

function addField(type: LeadFieldType) {
  const label = LEAD_FIELD_LABELS[type]
  form.value.fields.push({ id: newFieldId(), key: type === 'name' ? 'name' : uniqueKey(fieldKeyFrom(label)), type, label, placeholder: '', required: false, options: type === 'select' ? [t('projectTools.forms.optionA'), t('projectTools.forms.optionB')] : [] })
}

const addItems = computed(() => [LEAD_FIELD_TYPES.filter(type => type !== 'email' && (type !== 'name' || !form.value.fields.some(f => f.type === 'name'))).map(type => ({
  label: t(`projectTools.forms.types.${type}`), icon: FIELD_ICONS[type], onSelect: () => addField(type)
}))])

// ---- look ----
const projectAccent = computed(() => project.value?.theme?.accent || '#4f46e5')
const colourFields = computed(() => [
  { key: 'accent' as const, label: t('projectTools.forms.accent'), empty: t('projectTools.forms.projectAccent'), fallback: projectAccent.value },
  { key: 'background' as const, label: t('projectTools.forms.background'), empty: t('projectTools.forms.noBackground'), fallback: previewTheme.value === 'dark' ? '#18181b' : '#ffffff' },
  { key: 'text' as const, label: t('projectTools.forms.text'), empty: t('projectTools.forms.followsTheme'), fallback: previewTheme.value === 'dark' ? '#f4f4f5' : '#18181b' }
])
const fontItems = computed(() => LEAD_FORM_FONTS.map(value => ({ value, label: t(`projectTools.onboarding.fonts.${value}`) })))
const layoutItems = computed(() => [{ value: 'stacked', label: t('projectTools.forms.layouts.stacked') }, { value: 'inline', label: t('projectTools.forms.layouts.inline') }])

// ---- after sign-up ----
const templateItems = computed(() => templates.value.map(tpl => ({ label: tpl.master?.name || tpl.name, value: tpl.key || tpl.id })))
const sequenceItems = computed(() => sequences.value.map(s => ({ label: s.status === 'active' ? s.name : `${s.name} (${t(`projectTools.forms.sequenceStatus.${s.status}`)})`, value: s.id })))

// ---- install ----
type InstallTab = 'script' | 'html' | 'link' | 'swift' | 'api'
const installTab = ref<InstallTab>('script')
const installTabs = computed(() => [
  { value: 'script' as const, label: t('projectTools.forms.installTabs.script') },
  { value: 'html' as const, label: 'HTML' },
  { value: 'link' as const, label: t('projectTools.forms.installTabs.link') },
  { value: 'swift' as const, label: 'Swift' },
  { value: 'api' as const, label: 'API' }
])
const INPUT_TYPES: Partial<Record<LeadFieldType, string>> = { email: 'email', number: 'number', url: 'url', phone: 'tel' }
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const snippet = computed(() => {
  const pk = project.value?.publicKey || 'pk_…'
  const key = form.value.key.trim() || 'waitlist'
  const post = `${appUrl.value}/v1/forms/${pk}/${key}`
  if (installTab.value === 'html') {
    const inputs = form.value.fields.map((f) => {
      const req = f.required ? ' required' : ''
      const ph = f.placeholder || f.label
      if (f.type === 'checkbox') return `  <label><input type="checkbox" name="${f.key}"${req}> ${escape(f.label)}</label>`
      if (f.type === 'textarea') return `  <textarea name="${f.key}" placeholder="${escape(ph)}"${req}></textarea>`
      if (f.type === 'select') return `  <select name="${f.key}"${req}>\n    <option value="">${escape(f.label)}</option>\n${f.options.map(o => `    <option>${escape(o)}</option>`).join('\n')}\n  </select>`
      return `  <input type="${INPUT_TYPES[f.type] || 'text'}" name="${f.key}" placeholder="${escape(ph)}"${req}>`
    })
    return `<form action="${post}" method="post">\n${inputs.join('\n')}\n  <!-- Leave this empty: bots fill it in. -->\n  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-10000px">\n  <button type="submit">${escape(form.value.content.buttonLabel)}</button>\n</form>`
  }
  if (installTab.value === 'link') return `<a href="${appUrl.value}/f/${pk}/${key}">${escape(form.value.content.buttonLabel)}</a>\n\n<!-- or framed in your page -->\n<iframe src="${appUrl.value}/f/${pk}/${key}" title="${escape(form.value.content.title || form.value.name)}" style="width:100%;max-width:480px;height:520px;border:0"></iframe>`
  if (installTab.value === 'swift') return `// Add HelpBitesLeadForm.swift from the guide, then:\nHelpBitesLeadForm(host: URL(string: "${appUrl.value}")!, projectKey: "${pk}", form: "${key}")`
  if (installTab.value === 'api') {
    const sample: Record<string, unknown> = {}
    for (const f of form.value.fields) sample[f.key] = f.type === 'email' ? 'ada@example.com' : f.type === 'name' ? 'Ada Lovelace' : f.type === 'checkbox' ? true : f.type === 'number' ? 3 : f.type === 'select' ? (f.options[0] || '') : f.type === 'url' ? 'https://example.com' : '…'
    return `curl -s ${post} \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(sample)}'`
  }
  return `<script src="${appUrl.value}/forms.js" data-project="${pk}" data-form="${key}" defer><\/script>`
})

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('projectTools.forms.copied'), icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {}
}

// ---- preview: the real forms.js draws the working copy ----
const previewEl = ref<HTMLElement | null>(null)
const previewState = ref<'form' | 'success'>('form')
const previewTheme = ref<'light' | 'dark'>(import.meta.client && document.documentElement.classList.contains('dark') ? 'dark' : 'light')

type Queue = { push: (command: unknown[]) => void }
function formsQueue(): Queue {
  const w = window as unknown as { HelpBitesForms?: Queue | unknown[] }
  w.HelpBitesForms ||= []
  if (!document.querySelector('script[data-hb-forms-preview]')) {
    const script = document.createElement('script')
    script.src = '/forms.js'
    script.dataset.hbFormsPreview = ''
    document.head.appendChild(script)
  }
  return w.HelpBitesForms as Queue
}

function drawPreview() {
  if (!previewEl.value || !saved.value) return
  const f = form.value
  formsQueue().push(['preview', {
    target: previewEl.value,
    theme: previewTheme.value,
    state: previewState.value,
    form: { key: f.key, name: f.name, fields: f.fields, content: f.content, style: { ...f.style, accent: f.style.accent || projectAccent.value }, doubleOptIn: f.settings.doubleOptIn, project: { name: project.value?.name || '', logoUrl: '' } }
  }])
}

watch([form, previewState, previewTheme, previewEl, projectAccent], drawPreview, { deep: true, flush: 'post' })

onMounted(async () => {
  if (!project.value) loadProjects().catch(() => {})
  await load()
  loadLeads()
  api<{ templates: EmailTemplate[] }>('/admin/emails', { query: { project: id } }).then((r) => { templates.value = r.templates }).catch(() => {})
  api<{ sequences: Sequence[] }>('/sequences', { query: { project: id } }).then((r) => { sequences.value = r.sequences }).catch(() => {})
})
</script>
