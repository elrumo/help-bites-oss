<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="flow?.name || $t('projectTools.onboarding.flow')" :crumbs="[{ label: $t('sections.onboarding'), to: `/projects/${id}/onboarding` }]">
      <template #actions>
        <UBadge v-if="flow?.status === 'published' && (dirty || flow.changed)" :label="$t('projectTools.onboarding.notLive')" color="warning" variant="soft" size="sm" class="hidden sm:inline-flex" />
        <UButton v-if="dirty" :label="$t('projectTools.shared.save')" size="sm" color="neutral" variant="soft" :loading="busy === 'save'" @click="save()" />
        <UButton v-if="flow" :label="publishLabel" size="sm" :disabled="flow.status === 'published' && !dirty && !flow.changed" :loading="busy === 'publish'" @click="publish" />
        <UDropdownMenu v-if="flow" :items="menu">
          <UButton icon="i-lucide-ellipsis" size="sm" color="neutral" variant="ghost" square :aria-label="$t('projectTools.shared.more')" />
        </UDropdownMenu>
      </template>
    </PageHeader>

    <div v-if="loading" class="mx-auto w-full max-w-6xl space-y-3 px-6 py-8"><USkeleton v-for="n in 4" :key="n" class="h-24 w-full" /></div>
    <p v-else-if="!flow" class="px-6 py-8 text-[13px] text-error">{{ error || $t('projectTools.onboarding.notFound') }}</p>

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div class="min-w-0 space-y-5">
          <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

          <section class="grid gap-4 rounded-xl border border-default p-4 sm:grid-cols-2">
            <UFormField :label="$t('projectTools.onboarding.name')">
              <UInput v-if="!lang" v-model="form.name" :maxlength="ONBOARDING_LIMITS.name" class="w-full" />
              <UInput v-else :model-value="form.translations[lang]?.name || ''" :placeholder="form.name" :maxlength="ONBOARDING_LIMITS.name" class="w-full" @update:model-value="setName($event)" />
            </UFormField>
            <UFormField v-if="!lang" :label="$t('projectTools.onboarding.key')" :hint="$t('projectTools.onboarding.keyHint')" :error="keyValid ? undefined : $t('projectTools.onboarding.keyInvalid')">
              <UInput v-model="form.key" class="w-full font-mono" />
            </UFormField>
          </section>

          <LanguageTabs
            :source="form.locale" :languages="languages" :active="lang" :busy="busy === 'translate'" :error="translateError"
            @update:source="setSource" @select="lang = $event" @add="addLanguage" @remove="removeLanguage" @translate="translate"
          />

          <div class="space-y-3">
            <div class="flex items-baseline justify-between">
              <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.onboarding.steps') }}</h3>
              <span class="text-xs tabular-nums text-dimmed">{{ form.steps.length }} / {{ ONBOARDING_LIMITS.steps }}</span>
            </div>
            <div v-for="(step, i) in form.steps" :key="step.id" class="rounded-xl border p-4 transition-colors" :class="previewStep === i ? 'border-accented' : 'border-default'" @focusin="previewStep = i">
              <div class="flex items-center gap-1">
                <button type="button" class="mr-auto text-xs font-medium text-muted hover:text-highlighted" @click="previewStep = i">{{ $t('projectTools.onboarding.stepN', { n: i + 1 }) }}</button>
                <template v-if="!lang">
                <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="i === 0" :aria-label="$t('projectTools.onboarding.moveUp')" @click="move(i, -1)" />
                <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" square :disabled="i === form.steps.length - 1" :aria-label="$t('projectTools.onboarding.moveDown')" @click="move(i, 1)" />
                <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :disabled="form.steps.length === 1" :aria-label="$t('projectTools.onboarding.removeStep')" @click="removeStep(i)" />
                </template>
              </div>
              <div v-if="lang" class="mt-2 space-y-3">
                <UFormField :label="$t('projectTools.onboarding.stepTitle')" :hint="`${word(step.id, 'title').length} / ${ONBOARDING_LIMITS.title}`">
                  <UInput :model-value="word(step.id, 'title')" :placeholder="step.title" :maxlength="ONBOARDING_LIMITS.title" class="w-full font-medium" @update:model-value="setWord(step.id, 'title', $event)" />
                </UFormField>
                <UFormField :label="$t('projectTools.onboarding.stepBody')" :hint="`${word(step.id, 'body').length} / ${ONBOARDING_LIMITS.body}`">
                  <UTextarea :model-value="word(step.id, 'body')" :placeholder="step.body" :maxlength="ONBOARDING_LIMITS.body" autoresize :rows="2" :maxrows="8" class="w-full" @update:model-value="setWord(step.id, 'body', $event)" />
                </UFormField>
                <div class="grid gap-3 sm:grid-cols-2">
                  <UFormField v-if="step.imageUrl" :label="$t('projectTools.onboarding.imageAlt')">
                    <UInput :model-value="word(step.id, 'imageAlt')" :placeholder="step.imageAlt" :maxlength="ONBOARDING_LIMITS.alt" class="w-full" @update:model-value="setWord(step.id, 'imageAlt', $event)" />
                  </UFormField>
                  <UFormField :label="$t('projectTools.onboarding.buttonLabel')">
                    <UInput :model-value="word(step.id, 'buttonLabel')" :placeholder="step.buttonLabel || (i === form.steps.length - 1 ? $t('projectTools.onboarding.getStarted') : $t('projectTools.onboarding.continue'))" :maxlength="ONBOARDING_LIMITS.label" class="w-full" @update:model-value="setWord(step.id, 'buttonLabel', $event)" />
                  </UFormField>
                </div>
              </div>
              <div v-else class="mt-2 space-y-3">
                <UFormField :label="$t('projectTools.onboarding.stepTitle')" :hint="`${step.title.length} / ${ONBOARDING_LIMITS.title}`">
                  <UInput v-model="step.title" :maxlength="ONBOARDING_LIMITS.title" class="w-full font-medium" />
                </UFormField>
                <UFormField :label="$t('projectTools.onboarding.stepBody')" :hint="`${step.body.length} / ${ONBOARDING_LIMITS.body}`">
                  <UTextarea v-model="step.body" :maxlength="ONBOARDING_LIMITS.body" autoresize :rows="2" :maxrows="8" class="w-full" />
                </UFormField>

                <div class="flex flex-wrap items-start gap-3">
                  <div class="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-default bg-muted">
                    <img v-if="step.imageUrl" :src="step.imageUrl" alt="" class="size-full object-contain">
                    <UIcon v-else name="i-lucide-image" class="size-5 text-dimmed" />
                  </div>
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="flex flex-wrap gap-1.5">
                      <UButton icon="i-lucide-upload" :label="$t('projectTools.onboarding.upload')" size="xs" color="neutral" variant="soft" :loading="uploading === step.id" @click="pickImage(step.id)" />
                      <UPopover v-if="kitImages.length" :content="{ align: 'start' }">
                        <UButton icon="i-lucide-swatch-book" :label="$t('projectTools.onboarding.fromBrandKit')" size="xs" color="neutral" variant="soft" />
                        <template #content="{ close }">
                          <div class="grid max-h-72 w-72 grid-cols-3 gap-2 overflow-y-auto p-2">
                            <button v-for="asset in kitImages" :key="asset.id" type="button" class="grid aspect-square place-items-center overflow-hidden rounded-md border border-default bg-muted p-1.5 hover:border-accented" :title="asset.name" @click="step.imageUrl = asset.url; step.imageAlt ||= asset.name; close()">
                              <img :src="asset.url" :alt="asset.name" class="max-h-full object-contain">
                            </button>
                          </div>
                        </template>
                      </UPopover>
                      <UButton v-if="step.imageUrl" icon="i-lucide-x" :label="$t('projectTools.onboarding.removeImage')" size="xs" color="neutral" variant="ghost" @click="step.imageUrl = ''; step.imageAlt = ''" />
                    </div>
                    <UInput v-model="step.imageUrl" placeholder="https://" size="sm" class="w-full font-mono" :aria-label="$t('projectTools.onboarding.imageUrl')" />
                  </div>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <UFormField v-if="step.imageUrl" :label="$t('projectTools.onboarding.imageAlt')" :hint="$t('projectTools.onboarding.imageAltHint')">
                    <UInput v-model="step.imageAlt" :maxlength="ONBOARDING_LIMITS.alt" class="w-full" />
                  </UFormField>
                  <UFormField :label="$t('projectTools.onboarding.buttonLabel')">
                    <UInput v-model="step.buttonLabel" :maxlength="ONBOARDING_LIMITS.label" :placeholder="i === form.steps.length - 1 ? $t('projectTools.onboarding.getStarted') : $t('projectTools.onboarding.continue')" class="w-full" />
                  </UFormField>
                  <UFormField v-if="pricingTables.length || step.pricingTable" :label="$t('projectTools.onboarding.pricingTable')" :help="pricingHelp(step.pricingTable)" class="sm:col-span-2">
                    <OptionalSelect v-model="step.pricingTable" :items="pricingItems" :none-label="$t('projectTools.onboarding.noPricingTable')" class="w-full" />
                  </UFormField>
                </div>
              </div>
            </div>
            <UButton v-if="!lang" icon="i-lucide-plus" :label="$t('projectTools.onboarding.addStep')" color="neutral" variant="soft" size="sm" :disabled="form.steps.length >= ONBOARDING_LIMITS.steps" @click="addStep" />
          </div>

          <section class="rounded-xl border border-default p-4">
            <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.onboarding.look') }}</h3>
            <div class="mt-3 grid gap-4 sm:grid-cols-3">
              <UFormField v-for="field in colourFields" :key="field.key" :label="field.label" :hint="form.style[field.key] ? undefined : field.empty">
                <div class="flex items-center gap-2">
                  <input type="color" :value="form.style[field.key] || field.fallback" class="h-8 w-10 shrink-0 cursor-pointer rounded border border-default bg-transparent" :aria-label="field.label" @input="form.style[field.key] = ($event.target as HTMLInputElement).value">
                  <UInput v-model="form.style[field.key]" :placeholder="field.fallback" class="w-full font-mono" />
                  <UButton v-if="form.style[field.key]" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.onboarding.reset')" @click="form.style[field.key] = ''" />
                </div>
              </UFormField>
            </div>
            <div class="mt-4 grid gap-4 sm:grid-cols-2">
              <UFormField :label="$t('projectTools.onboarding.radius')" :hint="`${form.style.radius}px`">
                <input v-model.number="form.style.radius" type="range" min="0" :max="ONBOARDING_LIMITS.radius" step="1" class="mt-2 w-full accent-primary-600">
              </UFormField>
              <UFormField :label="$t('projectTools.onboarding.font')">
                <USelect v-model="form.style.font" :items="fontItems" class="w-full" />
              </UFormField>
            </div>
          </section>

          <section class="rounded-xl border border-default p-4">
            <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.onboarding.behaviour') }}</h3>
            <div class="mt-3 grid gap-4 sm:grid-cols-2">
              <USwitch v-model="form.options.skippable" :label="$t('projectTools.onboarding.skippable')" :description="$t('projectTools.onboarding.skippableHint')" />
              <UFormField :label="$t('projectTools.onboarding.progress')">
                <USelect v-model="form.options.progress" :items="progressItems" class="w-full" />
              </UFormField>
            </div>
          </section>

          <section class="rounded-xl border border-default p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.onboarding.install') }}</h3>
              <div class="inline-flex rounded-lg bg-elevated p-0.5" role="tablist">
                <button v-for="tab in installTabs" :key="tab.value" type="button" role="tab" :aria-selected="installTab === tab.value" class="h-7 rounded-md px-2.5 text-xs font-medium transition-colors" :class="installTab === tab.value ? 'bg-default text-highlighted shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-default'" @click="installTab = tab.value">{{ tab.label }}</button>
              </div>
            </div>
            <p class="mt-2 text-[13px] text-muted">{{ installHint }}</p>
            <CodeBlock :code="snippet" :lang="installTab === 'web' ? 'html' : installTab === 'api' ? 'bash' : 'js'" class="mt-3" />
            <div class="mt-2 flex flex-wrap gap-2">
              <UButton icon="i-lucide-copy" :label="$t('projectTools.onboarding.copy')" size="xs" color="neutral" variant="soft" @click="copy(snippet)" />
              <UButton icon="i-lucide-book-open" :label="$t('projectTools.onboarding.readGuide')" size="xs" color="neutral" variant="ghost" :to="installTab === 'swift' ? '/docs/onboarding#plug-and-play-swift' : '/docs/onboarding'" target="_blank" />
            </div>
          </section>

          <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="upload">
        </div>

        <aside class="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <div class="flex items-center gap-1">
            <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.onboarding.preview') }}</h3>
            <UButton icon="i-lucide-chevron-left" size="xs" color="neutral" variant="ghost" square :disabled="previewStep === 0" :aria-label="$t('projectTools.onboarding.previousStep')" @click="previewStep--" />
            <span class="min-w-10 text-center text-xs tabular-nums text-muted">{{ previewStep + 1 }} / {{ form.steps.length }}</span>
            <UButton icon="i-lucide-chevron-right" size="xs" color="neutral" variant="ghost" square :disabled="previewStep >= form.steps.length - 1" :aria-label="$t('projectTools.onboarding.nextStep')" @click="previewStep++" />
            <UButton :icon="previewTheme === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.onboarding.toggleTheme')" @click="previewTheme = previewTheme === 'dark' ? 'light' : 'dark'" />
          </div>
          <div class="grid min-h-[520px] place-items-center rounded-2xl p-5 transition-colors" :class="previewTheme === 'dark' ? 'bg-stone-950' : 'bg-stone-200/70'">
            <div ref="previewEl" class="w-full" />
          </div>
          <p class="text-xs text-dimmed">{{ $t('projectTools.onboarding.previewHint') }}</p>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ONBOARDING_FONTS, ONBOARDING_KEY, ONBOARDING_LIMITS, ONBOARDING_PROGRESS, localizeOnboarding, newStepId, onboardingTexts, translationTexts, type OnboardingOptions, type OnboardingStep, type OnboardingStepText, type OnboardingStyle, type OnboardingTranslations } from '#shared/onboarding'
import type { PublicPricingTable } from '#shared/pricing'

definePageMeta({ middleware: 'agent' })

type Flow = { id: string, key: string, name: string, status: 'draft' | 'published', version: number, steps: OnboardingStep[], style: OnboardingStyle, options: OnboardingOptions, locale: string, translations: OnboardingTranslations, changed: boolean, published: any, path: string }
type Form = Pick<Flow, 'name' | 'key' | 'steps' | 'style' | 'options' | 'locale' | 'translations'>

const { api, projects, loadProjects } = useAgent()
const { t } = useI18n()
const toast = useToast()
const appUrl = useAppUrl()
const route = useRoute()
const id = String(route.params.id)
const flowId = String(route.params.flowId)
const project = computed(() => projects.value.find(p => p.id === id) || null)

const flow = ref<Flow | null>(null)
const form = ref<Form>({ name: '', key: '', steps: [], style: { accent: '', background: '', text: '', radius: 20, font: 'system' }, options: { skippable: true, progress: 'bar' }, locale: 'en', translations: {} })
const saved = ref('')
const loading = ref(true)
const error = ref('')
const busy = ref('')

const snapshot = (f: Form) => JSON.stringify({ name: f.name, key: f.key, steps: f.steps, style: f.style, options: f.options, locale: f.locale, translations: f.translations })
const dirty = computed(() => !!flow.value && snapshot(form.value) !== saved.value)
const keyValid = computed(() => ONBOARDING_KEY.test(form.value.key.trim()))
const publishLabel = computed(() => flow.value?.status !== 'published' ? t('projectTools.shared.publish') : dirty.value || flow.value.changed ? t('projectTools.onboarding.publishChanges') : t('projectTools.onboarding.published'))

function fill(next: Flow) {
  flow.value = next
  form.value = JSON.parse(JSON.stringify({ name: next.name, key: next.key, steps: next.steps, style: next.style, options: next.options, locale: next.locale || 'en', translations: next.translations || {} }))
  if (lang.value && !form.value.translations[lang.value]) lang.value = ''
  saved.value = snapshot(form.value)
  previewStep.value = Math.min(previewStep.value, Math.max(0, next.steps.length - 1))
}

async function load() {
  try {
    fill((await api<{ flow: Flow }>(`/admin/onboarding/flows/${flowId}`)).flow)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.onboarding.loadError')
  } finally {
    loading.value = false
  }
}

async function save(quiet = false) {
  if (!keyValid.value) { error.value = t('projectTools.onboarding.keyInvalid'); return false }
  busy.value = 'save'
  error.value = ''
  try {
    // A language is replaced when sent and removed when null, so the ones taken out are sent as null.
    const translations: Record<string, unknown> = { ...form.value.translations }
    for (const tag of Object.keys(flow.value?.translations || {})) if (!(tag in translations)) translations[tag] = null
    fill((await api<{ flow: Flow }>(`/admin/onboarding/flows/${flowId}`, { method: 'PATCH', body: { ...form.value, key: form.value.key.trim(), translations } })).flow)
    if (!quiet) toast.add({ title: t('projectTools.onboarding.saved'), icon: 'i-lucide-check', color: 'success' })
    return true
  } catch (e: any) {
    error.value = e?.message || t('projectTools.onboarding.saveError')
    return false
  } finally {
    busy.value = ''
  }
}

async function act(action: 'publish' | 'unpublish') {
  busy.value = action
  error.value = ''
  try {
    fill((await api<{ flow: Flow }>(`/admin/onboarding/flows/${flowId}/${action}`, { method: 'POST' })).flow)
    toast.add({ title: action === 'publish' ? t('projectTools.onboarding.publishedToast', { version: flow.value!.version }) : t('projectTools.onboarding.unpublishedToast'), icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    error.value = e?.message || t('projectTools.onboarding.saveError')
  } finally {
    busy.value = ''
  }
}

// Publishing saves first, so what you see is what goes out.
async function publish() {
  if (dirty.value && !(await save(true))) return
  await act('publish')
}

async function remove() {
  if (!flow.value || !confirm(t('projectTools.onboarding.deleteConfirm', { name: flow.value.name }))) return
  try {
    await api(`/admin/onboarding/flows/${flowId}`, { method: 'DELETE' })
    await navigateTo(`/projects/${id}/onboarding`)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.onboarding.saveError')
  }
}

function downloadOfflineCopy() {
  if (!flow.value?.published) return
  const blob = new Blob([JSON.stringify({ flow: flow.value.published }, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `onboarding-${flow.value.key}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

const menu = computed(() => [[
  { label: t('projectTools.onboarding.downloadOffline'), icon: 'i-lucide-download', disabled: !flow.value?.published, onSelect: downloadOfflineCopy },
  { label: t('projectTools.onboarding.openJson'), icon: 'i-lucide-braces', disabled: flow.value?.status !== 'published', onSelect: () => window.open(`${appUrl.value}${flow.value?.path}`, '_blank') }
], [
  ...(flow.value?.status === 'published' ? [{ label: t('projectTools.onboarding.unpublish'), icon: 'i-lucide-eye-off', onSelect: () => act('unpublish') }] : []),
  { label: t('projectTools.onboarding.deleteFlow'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: remove }
]])

// ---- languages ----
const lang = ref('')
const translateError = ref('')
const languages = computed(() => {
  const total = Object.keys(onboardingTexts(form.value.name, form.value.steps)).length
  return Object.entries(form.value.translations).map(([locale, tr]) => ({ locale, filled: Math.min(total, Object.keys(translationTexts(tr)).length), total }))
})

const word = (stepId: string, key: keyof OnboardingStepText) => form.value.translations[lang.value]?.steps[stepId]?.[key] ?? ''
function setWord(stepId: string, key: keyof OnboardingStepText, value: string) {
  const entry = (form.value.translations[lang.value] ||= { name: '', steps: {} })
  ;(entry.steps[stepId] ||= {})[key] = value
}
function setName(value: string) {
  ;(form.value.translations[lang.value] ||= { name: '', steps: {} }).name = value
}

function addLanguage(tag: string) {
  form.value.translations[tag] = { name: '', steps: {} }
  lang.value = tag
}

function removeLanguage(tag: string) {
  if (!confirm(t('translations.removeConfirm', { language: tag }))) return
  delete form.value.translations[tag]
  if (lang.value === tag) lang.value = ''
}

function setSource(tag: string) {
  form.value.locale = tag
  delete form.value.translations[tag]
  if (lang.value === tag) lang.value = ''
}

// The server translates the saved working copy, so unsaved edits are saved first.
async function translate(locales: string[], overwrite: boolean) {
  if (dirty.value && !(await save(true))) return
  busy.value = 'translate'
  translateError.value = ''
  try {
    fill((await api<{ flow: Flow }>(`/admin/onboarding/flows/${flowId}/translate`, { method: 'POST', body: { locales, overwrite } })).flow)
    toast.add({ title: t('translations.translated', { n: locales.length }), icon: 'i-lucide-sparkles', color: 'success' })
  } catch (e: any) {
    translateError.value = e?.message || t('translations.translateError')
  } finally {
    busy.value = ''
  }
}

// ---- steps ----
function move(index: number, by: number) {
  const steps = form.value.steps
  const [step] = steps.splice(index, 1)
  steps.splice(index + by, 0, step!)
  previewStep.value = index + by
}

function addStep() {
  form.value.steps.push({ id: newStepId(), title: '', body: '', imageUrl: '', imageAlt: '', buttonLabel: '', pricingTable: '' })
  previewStep.value = form.value.steps.length - 1
}

function removeStep(index: number) {
  form.value.steps.splice(index, 1)
  previewStep.value = Math.min(previewStep.value, form.value.steps.length - 1)
}

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref('')
let uploadFor = ''

function pickImage(stepId: string) {
  uploadFor = stepId
  fileInput.value?.click()
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const step = form.value.steps.find(s => s.id === uploadFor)
  if (!file || !step) return
  uploading.value = step.id
  error.value = ''
  try {
    const body = new FormData()
    body.append('project', id)
    body.append('file', file)
    step.imageUrl = (await api<{ url: string }>('/admin/onboarding/images', { method: 'POST', body })).url
  } catch (e: any) {
    error.value = e?.message || t('projectTools.onboarding.uploadError')
  } finally {
    uploading.value = ''
    input.value = ''
  }
}

const kitImages = ref<{ id: string, name: string, url: string }[]>([])

// ---- a pricing table on a step (a paywall at the end of the tour) ----
const pricingTables = ref<{ key: string, name: string, status: string, published: PublicPricingTable | null }[]>([])
const pricingItems = computed(() => pricingTables.value.map(table => ({ value: table.key, label: table.status === 'published' ? table.name : `${table.name} (${t('projectTools.onboarding.pricingDraft')})` })))
function pricingHelp(key: string) {
  const table = pricingTables.value.find(item => item.key === key)
  return key && table?.status !== 'published' ? t('projectTools.onboarding.pricingNotPublished') : t('projectTools.onboarding.pricingTableHint')
}

// ---- look ----
const projectAccent = computed(() => project.value?.theme?.accent || '#4f46e5')
const colourFields = computed(() => [
  { key: 'accent' as const, label: t('projectTools.onboarding.accent'), empty: t('projectTools.onboarding.projectAccent'), fallback: projectAccent.value },
  { key: 'background' as const, label: t('projectTools.onboarding.background'), empty: t('projectTools.onboarding.followsTheme'), fallback: previewTheme.value === 'dark' ? '#18181b' : '#ffffff' },
  { key: 'text' as const, label: t('projectTools.onboarding.text'), empty: t('projectTools.onboarding.followsTheme'), fallback: previewTheme.value === 'dark' ? '#f4f4f5' : '#18181b' }
])
const fontItems = computed(() => ONBOARDING_FONTS.map(value => ({ value, label: t(`projectTools.onboarding.fonts.${value}`) })))
const progressItems = computed(() => ONBOARDING_PROGRESS.map(value => ({ value, label: t(`projectTools.onboarding.progressKinds.${value}`) })))

// ---- install ----
const installTab = ref<'web' | 'swift' | 'api'>('web')
const installTabs = computed(() => [{ value: 'web' as const, label: t('projectTools.onboarding.web') }, { value: 'swift' as const, label: 'Swift' }, { value: 'api' as const, label: 'API' }])
const installHint = computed(() => t(`projectTools.onboarding.installHints.${installTab.value}`))
const snippet = computed(() => {
  const pk = project.value?.publicKey || 'pk_…'
  const key = form.value.key || 'welcome'
  if (installTab.value === 'swift') return `// Add HelpBitesOnboarding.swift from the guide, then:\nContentView()\n  .helpBitesOnboarding(host: URL(string: "${appUrl.value}")!, projectKey: "${pk}", flow: "${key}")`
  if (installTab.value === 'api') return `curl -s ${appUrl.value}/v1/onboarding/${pk}/${key}`
  return `<script src="${appUrl.value}/onboarding.js" data-project="${pk}" data-flow="${key}" defer><\/script>`
})

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('projectTools.onboarding.copied'), icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {}
}

// ---- preview: the real onboarding.js draws the working copy ----
const previewEl = ref<HTMLElement | null>(null)
const previewStep = ref(0)
const previewTheme = ref<'light' | 'dark'>(import.meta.client && document.documentElement.classList.contains('dark') ? 'dark' : 'light')

type Queue = { push: (command: unknown[]) => void }
function onboardingQueue(): Queue {
  const w = window as unknown as { HelpBitesOnboarding?: Queue | unknown[] }
  w.HelpBitesOnboarding ||= []
  if (!document.querySelector('script[data-hb-onboarding-preview]')) {
    const script = document.createElement('script')
    script.src = '/onboarding.js'
    script.dataset.hbOnboardingPreview = ''
    document.head.appendChild(script)
  }
  return w.HelpBitesOnboarding as Queue
}

function drawPreview() {
  if (!previewEl.value || !flow.value) return
  const style = { ...form.value.style, accent: form.value.style.accent || projectAccent.value }
  onboardingQueue().push(['preview', {
    target: previewEl.value,
    step: previewStep.value,
    theme: previewTheme.value,
    flow: { key: form.value.key, locale: lang.value || form.value.locale, version: flow.value.version, style, options: form.value.options, ...withPricing(localizeOnboarding(form.value.name, form.value.steps, lang.value ? form.value.translations[lang.value] : undefined)) }
  }])
}

/** Steps with their pricing table as apps get it now (its published version). */
function withPricing<T extends { steps: OnboardingStep[] }>(copy: T): T {
  return { ...copy, steps: copy.steps.map(step => (step.pricingTable ? { ...step, pricing: pricingTables.value.find(table => table.key === step.pricingTable)?.published || null } : step)) }
}

watch([form, lang, previewStep, previewTheme, previewEl, projectAccent, pricingTables], drawPreview, { deep: true, flush: 'post' })

onMounted(async () => {
  if (!project.value) loadProjects().catch(() => {})
  await load()
  api<{ tables: { key: string, name: string, status: string, published: PublicPricingTable | null }[] }>('/admin/pricing-tables', { query: { project: id } })
    .then(({ tables }) => { pricingTables.value = tables })
    .catch(() => {})
  api<{ assets: { id: string, name: string, url: string, mime: string }[] }>('/admin/brand', { query: { project: id } })
    .then(({ assets }) => { kitImages.value = assets.filter(a => a.mime.startsWith('image/') && a.mime !== 'image/x-icon') })
    .catch(() => {})
})
</script>
