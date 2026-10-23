<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="table?.name || $t('projectTools.pricing.table')" :crumbs="[{ label: $t('sections.pricing'), to: `/projects/${id}/pricing` }]">
      <template #actions>
        <UBadge v-if="table?.status === 'published' && (dirty || table.changed)" :label="$t('projectTools.pricing.notLive')" color="warning" variant="soft" size="sm" class="hidden sm:inline-flex" />
        <UButton v-if="dirty" :label="$t('projectTools.shared.save')" size="sm" color="neutral" variant="soft" :loading="busy === 'save'" @click="save()" />
        <UButton v-if="table" :label="publishLabel" size="sm" :disabled="table.status === 'published' && !dirty && !table.changed" :loading="busy === 'publish'" @click="publish" />
        <UDropdownMenu v-if="table" :items="menu">
          <UButton icon="i-lucide-ellipsis" size="sm" color="neutral" variant="ghost" square :aria-label="$t('projectTools.shared.more')" />
        </UDropdownMenu>
      </template>
    </PageHeader>

    <div v-if="loading" class="mx-auto w-full max-w-7xl space-y-3 px-6 py-8"><USkeleton v-for="n in 4" :key="n" class="h-24 w-full" /></div>
    <p v-else-if="!table" class="px-6 py-8 text-[13px] text-error">{{ error || $t('projectTools.pricing.notFound') }}</p>

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto grid max-w-7xl gap-8 px-6 py-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div class="min-w-0 space-y-5">
          <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

          <section class="grid gap-4 rounded-xl border border-default p-4 sm:grid-cols-2">
            <UFormField :label="$t('projectTools.pricing.name')">
              <UInput v-model="form.name" :maxlength="PRICING_LIMITS.name" class="w-full" />
            </UFormField>
            <UFormField :label="$t('projectTools.pricing.key')" :hint="$t('projectTools.pricing.keyHint')" :error="keyValid ? undefined : $t('projectTools.pricing.keyInvalid')">
              <UInput v-model="form.key" class="w-full font-mono" />
            </UFormField>
            <UFormField :label="$t('projectTools.pricing.template')" class="sm:col-span-2">
              <PricingTemplatePicker v-model="form.template" />
            </UFormField>
          </section>

          <section class="space-y-2 rounded-xl border border-default p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.stripe') }}</h3>
              <UButton v-if="stripe.connected" icon="i-lucide-refresh-cw" :label="$t('projectTools.pricing.refreshStripe')" size="xs" color="neutral" variant="ghost" :loading="busy === 'stripe'" @click="loadStripe(true)" />
              <UButton v-else :label="$t('projectTools.pricing.connectStripe')" size="xs" color="neutral" variant="soft" :to="`/projects/${id}/revenue`" />
            </div>
            <p class="text-xs text-muted">
              {{ stripe.connected ? $t('projectTools.pricing.stripeConnected', { products: stripe.catalog?.products.length || 0, prices: stripe.catalog?.prices.length || 0 }) : stripe.forbidden ? $t('projectTools.pricing.stripeAdminOnly') : $t('projectTools.pricing.stripeNotConnected') }}
            </p>
            <p v-if="stripe.connected && stripe.catalog && !stripe.paymentLinks" class="text-xs text-muted">{{ $t('projectTools.pricing.paymentLinksOff') }}</p>
            <p v-if="stripe.error" class="text-xs text-error">{{ stripe.error }}</p>
            <div v-if="table.warnings.length || table.checkoutError" class="mt-2 space-y-1 rounded-lg bg-warning/10 p-3">
              <p class="text-xs font-semibold text-highlighted">{{ $t('projectTools.pricing.warnings') }}</p>
              <p v-if="table.checkoutError" class="text-xs text-default">{{ $t('projectTools.pricing.checkoutError', { message: table.checkoutError.message }) }}</p>
              <p v-for="(warning, i) in table.warnings" :key="i" class="text-xs text-default">{{ warning }}</p>
              <p v-if="dirty" class="text-[11px] text-muted">{{ $t('projectTools.pricing.warningsAfterSave') }}</p>
            </div>
          </section>

          <LanguageTabs
            :source="form.locale" :languages="languages" :active="lang" :busy="busy === 'translate'" :error="translateError"
            @update:source="setSource" @select="lang = $event" @add="addLanguage" @remove="removeLanguage" @translate="translate"
          />

          <section v-if="lang" class="space-y-4 rounded-xl border border-default p-4">
            <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.translationList', { language: localeName(lang, locale) }) }}</h3>
            <div v-for="group in translationGroups" :key="group.label" class="space-y-2">
              <p class="text-xs font-medium text-muted">{{ group.label }}</p>
              <UFormField v-for="entry in group.entries" :key="entry.key" :label="entry.field" :hint="`${(form.translations[lang]?.[entry.key] || '').length} / ${entry.max}`">
                <UInput :model-value="form.translations[lang]?.[entry.key] || ''" :placeholder="entry.text" :maxlength="entry.max" class="w-full" @update:model-value="setWord(entry.key, String($event))" />
              </UFormField>
            </div>
          </section>

          <template v-else>
            <section class="space-y-3">
              <div class="flex items-center">
                <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.plans') }}</h3>
                <UButton icon="i-lucide-sparkles" :label="$t('projectTools.pricing.suggest')" size="xs" color="neutral" variant="ghost" class="mr-2" @click="suggestOpen = true" />
                <span class="text-xs tabular-nums text-dimmed">{{ form.plans.length }} / {{ PRICING_LIMITS.plans }}</span>
              </div>
              <PricingPlanEditor
                v-for="(plan, i) in form.plans" :key="plan.id" :plan="plan" :index="i" :count="form.plans.length" :stripe="stripe.catalog" :currency="form.options.currency" :start-open="opened.has(plan.id)"
                @move="movePlan(i, $event)" @remove="form.plans.splice(i, 1)" @import-features="importFeatures(plan, $event)"
              />
              <UButton icon="i-lucide-plus" :label="$t('projectTools.pricing.addPlan')" color="neutral" variant="soft" size="sm" :disabled="form.plans.length >= PRICING_LIMITS.plans" @click="addPlan" />
            </section>

            <PricingFeatures v-model:features="form.features" v-model:plans="form.plans" />

            <section class="space-y-3 rounded-xl border border-default p-4">
              <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.words') }}</h3>
              <UFormField :label="$t('projectTools.pricing.content.title')">
                <UInput v-model="form.content.title" :maxlength="PRICING_LIMITS.title" class="w-full font-medium" />
              </UFormField>
              <UFormField :label="$t('projectTools.pricing.content.subtitle')">
                <UTextarea v-model="form.content.subtitle" :maxlength="PRICING_LIMITS.subtitle" autoresize :rows="1" :maxrows="4" class="w-full" />
              </UFormField>
              <UFormField :label="$t('projectTools.pricing.content.footnote')" :hint="$t('projectTools.shared.optional')">
                <UTextarea v-model="form.content.footnote" :maxlength="PRICING_LIMITS.footnote" :placeholder="$t('projectTools.pricing.content.footnotePlaceholder')" autoresize :rows="1" :maxrows="4" class="w-full" />
              </UFormField>
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <UFormField :label="$t('projectTools.pricing.content.weeklyLabel')">
                  <UInput v-model="form.content.weeklyLabel" :maxlength="PRICING_LIMITS.label" :placeholder="$t('projectTools.pricing.slots.week')" class="w-full" />
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.content.monthlyLabel')">
                  <UInput v-model="form.content.monthlyLabel" :maxlength="PRICING_LIMITS.label" :placeholder="$t('projectTools.pricing.slots.month')" class="w-full" />
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.content.yearlyLabel')">
                  <UInput v-model="form.content.yearlyLabel" :maxlength="PRICING_LIMITS.label" :placeholder="$t('projectTools.pricing.slots.year')" class="w-full" />
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.content.savingsLabel')">
                  <UInput v-model="form.content.savingsLabel" :maxlength="PRICING_LIMITS.label" placeholder="Save {percent}%" class="w-full" />
                </UFormField>
              </div>
              <p class="text-xs text-dimmed">{{ $t('projectTools.pricing.content.labelsHint') }}</p>
              <div class="grid gap-3 sm:grid-cols-2">
                <UFormField :label="$t('projectTools.pricing.content.termsUrl')">
                  <UInput v-model="form.content.termsUrl" placeholder="https://" class="w-full font-mono" />
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.content.privacyUrl')">
                  <UInput v-model="form.content.privacyUrl" placeholder="https://" class="w-full font-mono" />
                </UFormField>
              </div>
            </section>

            <section class="rounded-xl border border-default p-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.look') }}</h3>
              <StyleProjectActions :project-id="id" :from="styleOffer" />
            </div>
              <p class="mt-1 text-xs text-muted">{{ $t('projectTools.pricing.lookNote') }}</p>
              <div class="mt-3 grid gap-4 sm:grid-cols-3">
                <UFormField v-for="field in colourFields" :key="field.key" :label="field.label" :hint="form.style[field.key] ? undefined : field.empty">
                  <div class="flex items-center gap-2">
                    <input type="color" :value="form.style[field.key] || field.fallback" class="h-8 w-10 shrink-0 cursor-pointer rounded border border-default bg-transparent" :aria-label="field.label" @input="form.style[field.key] = ($event.target as HTMLInputElement).value">
                    <UInput v-model="form.style[field.key]" :placeholder="field.fallback" class="w-full font-mono" />
                    <UButton v-if="form.style[field.key]" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.pricing.reset')" @click="form.style[field.key] = ''" />
                  </div>
                </UFormField>
              </div>
              <div class="mt-4 grid gap-4 sm:grid-cols-3">
                <UFormField :label="$t('projectTools.pricing.radius')" :hint="`${form.style.radius}px`">
                  <input v-model.number="form.style.radius" type="range" min="0" :max="PRICING_LIMITS.radius" step="1" class="mt-2 w-full accent-primary-600">
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.font')">
                  <USelect v-model="form.style.font" :items="choices(PRICING_FONTS, 'fonts')" value-key="value" class="w-full" />
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.density')">
                  <USelect v-model="form.style.density" :items="choices(PRICING_DENSITIES, 'densities')" value-key="value" class="w-full" />
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.surface')">
                  <USelect v-model="form.style.surface" :items="choices(PRICING_SURFACES, 'surfaces')" value-key="value" class="w-full" />
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.highlight')">
                  <USelect v-model="form.style.highlight" :items="choices(PRICING_HIGHLIGHTS, 'highlights')" value-key="value" class="w-full" />
                </UFormField>
              </div>
            </section>

            <section class="space-y-4 rounded-xl border border-default p-4">
              <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.behaviour') }}</h3>
              <div class="grid gap-4 sm:grid-cols-3">
                <UFormField :label="$t('projectTools.pricing.defaultInterval')">
                  <USelect v-model="form.options.defaultInterval" :items="PRICING_RECURRING.map(value => ({ value, label: $t(`projectTools.pricing.slots.${value}`) }))" value-key="value" class="w-full" />
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.yearlyAs')" :help="$t('projectTools.pricing.yearlyAsHint')">
                  <USelect v-model="form.options.yearlyAs" :items="choices(PRICING_YEARLY_AS, 'yearlyAsKinds')" value-key="value" class="w-full" />
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.currency')" :help="$t('projectTools.pricing.currencyHint')">
                  <UInput v-model="form.options.currency" maxlength="3" class="w-full font-mono uppercase" />
                </UFormField>
              </div>
              <div class="grid gap-3 sm:grid-cols-3">
                <USwitch v-model="form.options.cumulative" :label="$t('projectTools.pricing.cumulative')" :description="$t('projectTools.pricing.cumulativeHint')" />
                <USwitch v-model="form.options.showExcluded" :label="$t('projectTools.pricing.showExcluded')" :disabled="form.options.cumulative" />
                <USwitch v-model="form.options.compare" :label="$t('projectTools.pricing.compare')" />
              </div>
            </section>

            <section class="space-y-4 rounded-xl border border-default p-4">
              <div>
                <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.checkout') }}</h3>
                <p class="mt-1 text-xs text-muted">{{ $t('projectTools.pricing.checkoutHint') }}</p>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField :label="$t('projectTools.pricing.successUrl')" :help="$t('projectTools.pricing.urlFallback')">
                  <UInput v-model="form.checkout.successUrl" placeholder="https://" class="w-full font-mono" />
                </UFormField>
                <UFormField :label="$t('projectTools.pricing.cancelUrl')" :help="$t('projectTools.pricing.urlFallback')">
                  <UInput v-model="form.checkout.cancelUrl" placeholder="https://" class="w-full font-mono" />
                </UFormField>
              </div>
              <USwitch v-model="form.checkout.allowPromotionCodes" :label="$t('projectTools.pricing.promotionCodes')" />
            </section>
          </template>

          <section class="rounded-xl border border-default p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.install') }}</h3>
              <div class="inline-flex rounded-lg bg-elevated p-0.5" role="tablist">
                <button v-for="tab in installTabs" :key="tab.value" type="button" role="tab" :aria-selected="installTab === tab.value" class="h-7 rounded-md px-2.5 text-xs font-medium transition-colors" :class="installTab === tab.value ? 'bg-default text-highlighted shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-default'" @click="installTab = tab.value">{{ tab.label }}</button>
              </div>
            </div>
            <p class="mt-2 text-[13px] text-muted">{{ $t(`projectTools.pricing.installHints.${installTab}`) }}</p>
            <CodeBlock :code="snippet" :lang="installTab === 'web' ? 'html' : installTab === 'api' || installTab === 'link' ? 'bash' : 'js'" class="mt-3" />
            <div class="mt-2 flex flex-wrap gap-2">
              <UButton icon="i-lucide-copy" :label="$t('projectTools.pricing.copy')" size="xs" color="neutral" variant="soft" @click="copy(snippet)" />
              <UButton icon="i-lucide-book-open" :label="$t('projectTools.pricing.readGuide')" size="xs" color="neutral" variant="ghost" :to="installTab === 'swift' ? '/docs/pricing#plug-and-play-swift' : '/docs/pricing'" target="_blank" />
            </div>
          </section>

          <PricingResults :project-id="id" :table="table" :stripe-connected="stripe.connected" :working-copy-dirty="dirty" @update="table = $event" @adopted="fill($event)" />
        </div>

        <aside class="min-w-0 space-y-3 xl:sticky xl:top-6 xl:self-start">
          <div class="flex items-center gap-1">
            <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.preview') }}</h3>
            <div class="inline-flex rounded-lg bg-elevated p-0.5" role="tablist">
              <button v-for="size in ['desktop', 'phone'] as const" :key="size" type="button" role="tab" :aria-selected="previewSize === size" class="h-7 rounded-md px-2 text-xs font-medium transition-colors" :class="previewSize === size ? 'bg-default text-highlighted shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-default'" @click="previewSize = size">
                <UIcon :name="size === 'phone' ? 'i-lucide-smartphone' : 'i-lucide-monitor'" class="size-3.5 align-[-2px]" /> {{ $t(`projectTools.pricing.${size}`) }}
              </button>
            </div>
            <UButton :icon="previewTheme === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.pricing.toggleTheme')" @click="previewTheme = previewTheme === 'dark' ? 'light' : 'dark'" />
          </div>
          <div class="max-h-[calc(100vh-9rem)] overflow-auto rounded-2xl p-5 transition-colors" :class="previewTheme === 'dark' ? 'bg-stone-950' : 'bg-stone-200/70'">
            <div ref="previewEl" class="mx-auto transition-[max-width]" :style="{ maxWidth: previewSize === 'phone' ? '390px' : '100%' }" />
          </div>
          <p class="text-xs text-dimmed">{{ $t('projectTools.pricing.previewHint') }}</p>
        </aside>
      </div>
    </div>

    <PricingSuggest v-if="table" v-model:open="suggestOpen" :project-id="id" :table-id="tableId" :dark="previewTheme === 'dark'" :before-suggest="() => dirty ? save(true) : Promise.resolve(true)" @apply="applySuggestion" />
  </div>
</template>

<script setup lang="ts">
import { localeName } from '#shared/locales'
import { styleFrom } from '#shared/projectStyle'
import {
  PRICING_DENSITIES, PRICING_FONTS, PRICING_HIGHLIGHTS, PRICING_KEY, PRICING_LIMITS, PRICING_RECURRING, PRICING_SURFACES, PRICING_YEARLY_AS, blankPlan, buildPublicPricing, newFeatureId, pricingLook,
  pricingTextLimits, pricingTexts,
  type PricingCheckout, type PricingContent, type PricingExperiment, type PricingFeature, type PricingOptions, type PricingPlan, type PricingStyle, type PricingSnapshot, type PricingTemplate, type PricingTranslations,
  type PublicPricingTable, type StripeCatalog
} from '#shared/pricing'

definePageMeta({ middleware: 'agent' })

type Table = {
  id: string, key: string, name: string, status: 'draft' | 'published', version: number, template: PricingTemplate, plans: PricingPlan[], features: PricingFeature[],
  content: PricingContent, style: PricingStyle, options: PricingOptions, checkout: PricingCheckout, locale: string, translations: PricingTranslations,
  changed: boolean, published: PublicPricingTable | null, publishedAt: string | null, warnings: string[], checkoutError: { message: string, at: string } | null, path: string, pagePath: string,
  experiment: PricingExperiment
}
type Form = Pick<Table, 'name' | 'key' | 'template' | 'plans' | 'features' | 'content' | 'style' | 'options' | 'checkout' | 'locale' | 'translations'>

const { api, projects, loadProjects } = useAgent()
const { t, locale } = useI18n()
const toast = useToast()
const appUrl = useAppUrl()
const route = useRoute()
const id = String(route.params.id)
const tableId = String(route.params.tableId)
const project = computed(() => projects.value.find(p => p.id === id) || null)

const table = ref<Table | null>(null)
const form = ref<Form>({ name: '', key: '', template: 'tiers', plans: [], features: [], content: {} as PricingContent, style: {} as PricingStyle, options: {} as PricingOptions, checkout: {} as PricingCheckout, locale: 'en', translations: {} })
const saved = ref('')
const loading = ref(true)
const error = ref('')
const busy = ref('')
/** Plans whose editor starts open: the first, and the ones just added. */
const opened = reactive(new Set<string>())

const FIELDS = ['name', 'key', 'template', 'plans', 'features', 'content', 'style', 'options', 'checkout', 'locale', 'translations'] as const
const snapshot = (f: Form) => JSON.stringify(FIELDS.map(k => f[k]))
const dirty = computed(() => !!table.value && snapshot(form.value) !== saved.value)
const keyValid = computed(() => PRICING_KEY.test(form.value.key.trim()))
const publishLabel = computed(() => table.value?.status !== 'published' ? t('projectTools.shared.publish') : dirty.value || table.value.changed ? t('projectTools.pricing.publishChanges') : t('projectTools.pricing.published'))

function fill(next: Table) {
  table.value = next
  form.value = JSON.parse(JSON.stringify(Object.fromEntries(FIELDS.map(k => [k, next[k]]))))
  if (lang.value && !form.value.translations[lang.value]) lang.value = ''
  if (!opened.size && next.plans[0]) opened.add(next.plans[0].id)
  saved.value = snapshot(form.value)
}

async function load() {
  try {
    fill((await api<{ table: Table }>(`/admin/pricing-tables/${tableId}`)).table)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pricing.loadError')
  } finally {
    loading.value = false
  }
}

async function save(quiet = false) {
  if (!keyValid.value) { error.value = t('projectTools.pricing.keyInvalid'); return false }
  busy.value = 'save'
  error.value = ''
  try {
    // A language is replaced when sent and removed when null, so the ones taken out are sent as null.
    const translations: Record<string, unknown> = { ...form.value.translations }
    for (const tag of Object.keys(table.value?.translations || {})) if (!(tag in translations)) translations[tag] = null
    fill((await api<{ table: Table }>(`/admin/pricing-tables/${tableId}`, { method: 'PATCH', body: { ...form.value, key: form.value.key.trim(), translations } })).table)
    if (!quiet) toast.add({ title: t('projectTools.pricing.saved'), icon: 'i-lucide-check', color: 'success' })
    return true
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pricing.saveError')
    return false
  } finally {
    busy.value = ''
  }
}

const cdnPurge = ref<{ purged: number, error: string } | null>(null)

async function act(action: 'publish' | 'unpublish', force = false) {
  busy.value = action
  error.value = ''
  cdnPurge.value = null
  try {
    const res = await api<{ table: Table, cdn?: { purged: number, error: string } }>(`/admin/pricing-tables/${tableId}/${action}`, { method: 'POST', body: force ? { force } : undefined })
    fill(res.table)
    cdnPurge.value = res.cdn || null
    toast.add({ title: action === 'publish' ? t('projectTools.pricing.publishedToast', { version: table.value!.version }) : t('projectTools.pricing.unpublishedToast'), icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pricing.saveError')
  } finally {
    busy.value = ''
  }
}

// Publishing saves first, so what you see is what goes out.
async function publish() {
  if (dirty.value && !(await save(true))) return
  await act('publish')
}

// Saves, publishes again (even with nothing new), re-reads Stripe, then reloads the public JSON past this browser's cache.
async function pushLive() {
  if (dirty.value && !(await save(true))) return
  await act('publish', true)
  if (error.value) return
  const base = `${appUrl.value}${table.value?.path}`
  const tags = ['', ...Object.keys(form.value.translations)]
  await Promise.all(tags.map(tag => fetch(tag ? `${base}?locale=${encodeURIComponent(tag)}` : base, { cache: 'reload', credentials: 'omit' }).catch(() => {})))
  const cdn = cdnPurge.value
  toast.add({
    title: t('projectTools.pricing.pushedLive'),
    description: cdn?.purged && !cdn.error ? t('projectTools.pricing.pushedLiveCdn') : cdn?.error ? t('projectTools.pricing.pushedLiveCdnError', { error: cdn.error }) : t('projectTools.pricing.pushedLiveHint'),
    icon: 'i-lucide-zap',
    color: cdn?.error ? 'warning' : 'success'
  })
}

async function remove() {
  if (!table.value || !confirm(t('projectTools.pricing.deleteConfirm', { name: table.value.name }))) return
  try {
    await api(`/admin/pricing-tables/${tableId}`, { method: 'DELETE' })
    await navigateTo(`/projects/${id}/pricing`)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pricing.saveError')
  }
}

function downloadOfflineCopy() {
  if (!table.value?.published) return
  const blob = new Blob([JSON.stringify({ table: table.value.published }, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `pricing-${table.value.key}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

const menu = computed(() => [[
  { label: t('projectTools.pricing.pushLive'), icon: 'i-lucide-zap', disabled: table.value?.status !== 'published' || busy.value === 'publish', onSelect: pushLive },
  { label: t('projectTools.pricing.downloadOffline'), icon: 'i-lucide-download', disabled: !table.value?.published, onSelect: downloadOfflineCopy },
  { label: t('projectTools.pricing.openJson'), icon: 'i-lucide-braces', disabled: table.value?.status !== 'published', onSelect: () => window.open(`${appUrl.value}${table.value?.path}`, '_blank') },
  { label: t('projectTools.pricing.openPage'), icon: 'i-lucide-external-link', disabled: table.value?.status !== 'published', onSelect: () => window.open(`${appUrl.value}${table.value?.pagePath}`, '_blank') }
], [
  ...(table.value?.status === 'published' ? [{ label: t('projectTools.pricing.unpublish'), icon: 'i-lucide-eye-off', onSelect: () => act('unpublish') }] : []),
  { label: t('projectTools.pricing.deleteTable'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: remove }
]])

// ---- Stripe ----
const stripe = ref<{ connected: boolean, catalog: StripeCatalog | null, paymentLinks: boolean, error: string, forbidden?: boolean }>({ connected: false, catalog: null, paymentLinks: false, error: '' })

async function loadStripe(refresh = false) {
  if (refresh) busy.value = 'stripe'
  try {
    stripe.value = await api('/admin/stripe/catalog', { query: { project: id, ...(refresh ? { refresh: '1' } : {}) } })
    if (refresh) await load()
  } catch (e: any) {
    // Agents may edit copy but not read Stripe: the price pickers stay off for them.
    stripe.value = { connected: false, catalog: null, paymentLinks: false, error: e?.statusCode === 403 ? '' : e?.message || '', forbidden: e?.statusCode === 403 }
  } finally {
    if (refresh) busy.value = ''
  }
}

// ---- plans ----
function addPlan() {
  const plan = blankPlan('', `plan-${form.value.plans.length + 1}`)
  opened.add(plan.id)
  form.value.plans.push(plan)
}

function movePlan(index: number, by: number) {
  const [plan] = form.value.plans.splice(index, 1)
  form.value.plans.splice(index + by, 0, plan!)
}

/** Stripe's marketing features as rows the plan includes; a row with the same words is reused. */
function importFeatures(plan: PricingPlan, names: string[]) {
  for (const name of names) {
    let row = form.value.features.find(f => f.kind === 'feature' && f.text.trim().toLowerCase() === name.trim().toLowerCase())
    if (!row && form.value.features.length < PRICING_LIMITS.features) {
      row = { id: newFeatureId(), kind: 'feature', text: name.slice(0, PRICING_LIMITS.feature), hint: '' }
      form.value.features.push(row)
    }
    if (row) plan.features[row.id] ||= true
  }
}

// ---- AI suggestions: applied to the form, saved like any edit ----
const suggestOpen = ref(false)

function applySuggestion(draft: Pick<PricingSnapshot, 'content' | 'plans' | 'features'>) {
  const copy = JSON.parse(JSON.stringify(draft)) as typeof draft
  form.value.content = copy.content
  form.value.features = copy.features
  form.value.plans = copy.plans
  for (const plan of copy.plans) opened.add(plan.id)
  toast.add({ title: t('projectTools.pricing.suggestApplied'), icon: 'i-lucide-sparkles', color: 'success' })
}

// ---- languages ----
const lang = ref('')
const translateError = ref('')
const languages = computed(() => {
  const keys = Object.keys(pricingTexts(form.value))
  return Object.entries(form.value.translations).map(([tag, words]) => ({ locale: tag, filled: keys.filter(k => words[k]).length, total: keys.length }))
})

/** The table's strings in groups for the translation list: the words, each plan, the features. */
const translationGroups = computed(() => {
  const limits = pricingTextLimits(form.value)
  const featureText = (fid: string) => form.value.features.find(f => f.id === fid)?.text || ''
  const groups = new Map<string, { label: string, entries: { key: string, text: string, max: number, field: string }[] }>()
  for (const [key, entry] of Object.entries(limits)) {
    const [area, ownerId, field, cellId] = key.split('/')
    let label = t('projectTools.pricing.words')
    let name = key === 'name' ? t('projectTools.pricing.name') : t(`projectTools.pricing.content.${ownerId}`)
    if (area === 'features') {
      label = t('projectTools.pricing.features')
      name = field === 'hint' ? `${t('projectTools.pricing.hint')} · ${featureText(ownerId!)}` : t('projectTools.pricing.featureText')
    } else if (area === 'plans') {
      const plan = form.value.plans.find(p => p.id === ownerId)
      label = plan?.name || plan?.key || t('projectTools.pricing.plans')
      name = field === 'cells' ? featureText(cellId!) : field === 'action' ? t('projectTools.pricing.buttonLabel') : t(`projectTools.pricing.planFields.${field}`)
    }
    if (!groups.has(label)) groups.set(label, { label, entries: [] })
    groups.get(label)!.entries.push({ key, text: entry.text, max: entry.max, field: name })
  }
  return [...groups.values()]
})

function setWord(key: string, value: string) {
  const words = (form.value.translations[lang.value] ||= {})
  if (value) words[key] = value
  else delete words[key]
}

function addLanguage(tag: string) {
  form.value.translations[tag] = {}
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
    fill((await api<{ table: Table }>(`/admin/pricing-tables/${tableId}/translate`, { method: 'POST', body: { locales, overwrite } })).table)
    toast.add({ title: t('translations.translated', { n: locales.length }), icon: 'i-lucide-sparkles', color: 'success' })
  } catch (e: any) {
    translateError.value = e?.message || t('translations.translateError')
  } finally {
    busy.value = ''
  }
}

// ---- look ----
const styleOffer = computed(() => styleFrom(form.value.style))
const projectAccent = computed(() => project.value?.theme?.accent || '#5e6ad2')
const colourFields = computed(() => [
  { key: 'accent' as const, label: t('projectTools.pricing.accent'), empty: t('projectTools.pricing.projectAccent'), fallback: projectAccent.value },
  { key: 'background' as const, label: t('projectTools.pricing.background'), empty: t('projectTools.pricing.followsTheme'), fallback: previewTheme.value === 'dark' ? '#18181b' : '#ffffff' },
  { key: 'text' as const, label: t('projectTools.pricing.text'), empty: t('projectTools.pricing.followsTheme'), fallback: previewTheme.value === 'dark' ? '#f4f4f5' : '#18181b' }
])
const choices = (values: readonly string[], group: string) => values.map(value => ({ value, label: t(`projectTools.pricing.${group}.${value}`) }))

// ---- install ----
const installTab = ref<'web' | 'link' | 'swift' | 'api'>('web')
const installTabs = computed(() => [{ value: 'web' as const, label: t('projectTools.pricing.web') }, { value: 'link' as const, label: t('projectTools.pricing.link') }, { value: 'swift' as const, label: 'Swift' }, { value: 'api' as const, label: 'API' }])
const snippet = computed(() => {
  const pk = project.value?.publicKey || 'pk_…'
  const key = form.value.key || 'pricing'
  if (installTab.value === 'swift') return `// Add HelpBitesPricing.swift from the guide, then:\nHelpBitesPricingView(host: URL(string: "${appUrl.value}")!, projectKey: "${pk}", table: "${key}")`
  if (installTab.value === 'api') return `curl -s ${appUrl.value}/v1/pricing/${pk}/${key}`
  if (installTab.value === 'link') return `${appUrl.value}/pricing/${pk}/${key}`
  return `<script src="${appUrl.value}/pricing.js" data-project="${pk}" data-table="${key}" defer><\/script>`
})

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('projectTools.pricing.copied'), icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {}
}

// ---- preview: the real pricing.js draws the working copy, with Stripe's prices ----
const previewEl = ref<HTMLElement | null>(null)
const previewTheme = ref<'light' | 'dark'>(import.meta.client && document.documentElement.classList.contains('dark') ? 'dark' : 'light')
const previewSize = ref<'desktop' | 'phone'>('desktop')

const previewTable = computed(() => buildPublicPricing({
  key: form.value.key,
  version: table.value?.version || 0,
  publishedAt: null,
  project: { name: project.value?.name || '', logoUrl: project.value?.iconUrl || '', accent: projectAccent.value },
  look: project.value ? pricingLook(project.value.look.kit, project.value.style, form.value.style) : null,
  snapshot: { ...form.value, options: { ...form.value.options, currency: /^[a-z]{3}$/i.test(form.value.options.currency) ? form.value.options.currency.toLowerCase() : 'usd' } },
  catalog: stripe.value.catalog,
  wanted: { locales: [lang.value || form.value.locale] }
}))

/** A word edited in the preview goes to the field behind its text key, or to the open translation. */
function editWord(key: string, value: string) {
  if (lang.value) return setWord(key, value)
  const [area, id, field, cellId] = key.split('/')
  if (area === 'content') (form.value.content as Record<string, string>)[id!] = value
  else if (area === 'features') {
    const feature = form.value.features.find(f => f.id === id)
    if (feature) feature.text = value
  } else if (area === 'plans') {
    const plan = form.value.plans.find(p => p.id === id)
    if (!plan) return
    if (field === 'action') plan.action.label = value
    else (plan as unknown as Record<string, string>)[field!] = value
  }
}

function drawPreview() {
  if (!previewEl.value || !table.value) return
  pricingQueue().push(['preview', { target: previewEl.value, table: previewTable.value, theme: previewTheme.value, edit: editWord }])
}

watch([previewTable, previewTheme, previewEl, previewSize], drawPreview, { flush: 'post' })

onMounted(async () => {
  if (!project.value) loadProjects().catch(() => {})
  await Promise.all([load(), loadStripe()])
})
</script>
