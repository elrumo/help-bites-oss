import { createError, getHeader, getQuery, getRequestURL, getRouterParam, setResponseHeader, type H3Event } from 'h3'
import { normalizeEmail } from '#shared/contacts'
import { normalizeLocale, parseAcceptLanguage } from '#shared/locales'
import { styleCss } from '#shared/projectStyle'
import { safeHttpUrl } from '#shared/support'
import {
  DEFAULT_PRICING_CHECKOUT, DEFAULT_PRICING_EXPERIMENT, DEFAULT_PRICING_OPTIONS, DEFAULT_PRICING_STYLE, PRICING_INTERVALS, PRICING_KEY, PRICING_LIMITS, PRICING_TEMPLATES,
  pickPricingArm, pricingExperimentOf, validatePricingExperiment,
  buildPublicPricing, catalogSubset, pricingLook, normalizePricingCheckout, normalizePricingContent, normalizePricingOptions, normalizePricingStyle,
  pricingFeaturesOf, pricingKeyFrom, pricingLocaleOf, pricingPlansOf, pricingTemplateOf, pricingTextLimits, pricingTexts, pricingTranslationsOf, starterPricing,
  stripePriceFor, validatePricingCheckout, validatePricingContent, validatePricingFeatures, validatePricingOptions, validatePricingPlans, validatePricingStyle,
  validatePricingTranslations,
  type PricingInterval, type PricingPlan, type PricingSnapshot, type PricingTemplate, type PricingTranslations, type PublicPricingTable, type StripeCatalog,
  type StripeCatalogLink, type StripeCatalogPrice, type StripeCatalogProduct
} from '#shared/pricing'
import { poweredByHtml, type PoweredBy } from './branding'
import { lookOf } from './projects'
import { escapeHtml } from './messageEmail'
import { countPricing } from './pricingStats'
import { findStripeAccount, pricingCatalogKey, stripeGet, stripeListAll } from './stripe'
import { readTargetLocales, translateMissing } from './translate'

// Pricing tables: the store behind /v1/admin/pricing-tables, the public read,
// and Stripe Checkout. A table keeps a working copy and, once published, a
// frozen `published` copy with a version number, like an onboarding flow. The
// copy is HelpBites'; prices are Stripe's, read from the project's Stripe key
// (the Revenue tab's) and kept in Redis for a few minutes, so a price changed
// in Stripe shows without a publish. Each published version also keeps the
// Stripe entries it used, which is what shows while Stripe cannot be reached.
// The one write to Stripe is a Checkout Session, made when someone presses a
// plan's button, and only with a key that has that right.

const STRIPE_API = 'https://api.stripe.com/v1'
const CATALOG_FRESH_MS = 5 * 60_000
const CATALOG_KEEP_SECONDS = 7 * 86_400
// After a failed read, wait this long before asking Stripe again.
const CATALOG_RETRY_MS = 60_000
// Stripe locales Checkout speaks (docs.stripe.com/api/checkout/sessions/create#locale).
const CHECKOUT_LOCALES = ['bg', 'cs', 'da', 'de', 'el', 'en', 'en-GB', 'es', 'es-419', 'et', 'fi', 'fil', 'fr', 'fr-CA', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'mt', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'vi', 'zh', 'zh-HK', 'zh-TW']

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

// ---- the Stripe catalog ----------------------------------------------------------------

function productOf(raw: any): StripeCatalogProduct {
  return {
    id: String(raw.id), name: String(raw.name || ''), description: String(raw.description || ''),
    defaultPrice: typeof raw.default_price === 'string' ? raw.default_price : String(raw.default_price?.id || ''),
    unitLabel: String(raw.unit_label || ''),
    features: Array.isArray(raw.marketing_features) ? raw.marketing_features.map((f: any) => String(f?.name || '')).filter(Boolean) : []
  }
}

/** A price with a fixed amount; tiered, metered and pay-what-you-want prices have none and are left out. */
function priceOf(raw: any): StripeCatalogPrice | null {
  if (typeof raw.unit_amount !== 'number' || raw.recurring?.usage_type === 'metered') return null
  const options: Record<string, number> = {}
  for (const [currency, option] of Object.entries((raw.currency_options || {}) as Record<string, any>)) if (typeof option?.unit_amount === 'number') options[currency.toLowerCase()] = option.unit_amount
  return {
    id: String(raw.id), product: typeof raw.product === 'string' ? raw.product : String(raw.product?.id || ''), currency: String(raw.currency || '').toLowerCase(),
    amount: raw.unit_amount, type: raw.type === 'one_time' ? 'one_time' : 'recurring', interval: String(raw.recurring?.interval || ''),
    intervalCount: Number(raw.recurring?.interval_count) || 1, nickname: String(raw.nickname || ''), lookupKey: String(raw.lookup_key || ''),
    created: Number(raw.created) || 0, currencyOptions: options
  }
}

function linkOf(raw: any, items: any[] | null): StripeCatalogLink {
  return {
    id: String(raw.id), url: String(raw.url || ''),
    prices: (items || raw.line_items?.data || []).map((item: any) => String(item?.price?.id || '')).filter(Boolean),
    trialDays: Number(raw.subscription_data?.trial_period_days) || 0
  }
}

/** The account's active products, prices and payment links. A key that cannot read payment links still gives the rest. */
export async function fetchStripeCatalog(key: string): Promise<{ catalog: StripeCatalog, paymentLinks: boolean }> {
  const [products, prices, links] = await Promise.all([
    stripeListAll(key, '/products', { active: 'true' }, 500),
    stripeListAll(key, '/prices', { active: 'true', 'expand[]': 'data.currency_options' }, 1000),
    stripeListAll(key, '/payment_links', { active: 'true', 'expand[]': 'data.line_items' }, 200).catch(() => null)
  ])
  const linked: StripeCatalogLink[] = []
  for (const raw of links || []) {
    // A link whose line items did not come expanded is asked for them on its own.
    const items = raw.line_items?.data ? null : await stripeGet(key, `/payment_links/${encodeURIComponent(raw.id)}/line_items`, { limit: '10' }).then(r => r.data || []).catch(() => [])
    linked.push(linkOf(raw, items))
  }
  return {
    catalog: { products: products.map(productOf), prices: prices.map(priceOf).filter((p): p is StripeCatalogPrice => !!p), links: linked.filter(l => l.url), fetchedAt: new Date().toISOString() },
    paymentLinks: links !== null
  }
}

type CachedCatalog = { catalog: StripeCatalog | null, paymentLinks: boolean, error: string, savedAt: number }
const catalogKey = pricingCatalogKey

async function readCachedCatalog(projectId: string): Promise<CachedCatalog | null> {
  try {
    const raw = await useRedis().get(catalogKey(projectId))
    return raw ? JSON.parse(raw) as CachedCatalog : null
  } catch {
    return null
  }
}

async function refreshCatalog(project: ParseObject, account: ParseObject, previous: CachedCatalog | null): Promise<CachedCatalog> {
  let next: CachedCatalog
  try {
    const { catalog, paymentLinks } = await fetchStripeCatalog(readCredential(String(account.get('secretSealed') || '')))
    next = { catalog, paymentLinks, error: '', savedAt: Date.now() }
  } catch (error) {
    // Keep showing what we had; ask again in a minute rather than on every read.
    const message = String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Stripe could not be read').slice(0, 300)
    next = { catalog: previous?.catalog || null, paymentLinks: previous?.paymentLinks || false, error: message, savedAt: Date.now() - CATALOG_FRESH_MS + CATALOG_RETRY_MS }
  }
  await useRedis().set(catalogKey(project.id || ''), JSON.stringify(next), 'EX', CATALOG_KEEP_SECONDS).catch(() => {})
  return next
}

/**
 * The project's Stripe catalog: a copy younger than a few minutes as it is; an older one is
 * returned at once and refreshed behind it (or, with `wait`, refreshed first). Null without Stripe.
 */
export async function projectCatalog(project: ParseObject, options: { refresh?: boolean, wait?: boolean } = {}): Promise<CachedCatalog & { connected: boolean }> {
  const account = await findStripeAccount(project)
  if (!account) return { connected: false, catalog: null, paymentLinks: false, error: '', savedAt: 0 }
  const cached = await readCachedCatalog(project.id || '')
  if (cached && !options.refresh && Date.now() - cached.savedAt < CATALOG_FRESH_MS) return { ...cached, connected: true }
  const refresh = () => runExclusive(`sb:pricing:catalog-lock:${project.id}`, 90, () => refreshCatalog(project, account, cached), { failOpen: true })
  if (cached && !options.refresh && !options.wait) {
    void refresh().catch(error => console.warn('[pricing] catalog refresh failed:', (error as Error).message))
    return { ...cached, connected: true }
  }
  const result = await refresh()
  if (result.ran) return { ...result.value, connected: true }
  // Someone else is refreshing it: use what they leave, or what there was.
  return { ...((await readCachedCatalog(project.id || '')) || cached || { catalog: null, paymentLinks: false, error: '', savedAt: 0 }), connected: true }
}

// ---- the store -------------------------------------------------------------------------

/** The project an operator names with `?project=` (or `project` in a JSON body). */
export async function pricingProject(ctx: MemberContext, event: H3Event, body?: Record<string, unknown>): Promise<ParseObject> {
  const named = String(getQuery(event).project || body?.project || '')
  if (!named) badRequest('Pass ?project=<projectId>')
  return await requireProject(ctx, named)
}

export async function getPricingTable(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('PricingTable').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Pricing table not found' })
  }
}

export async function scopedPricingTable(ctx: MemberContext, event: H3Event): Promise<{ project: ParseObject, row: ParseObject }> {
  const row = await scoped.pricingTable(ctx, getRouterParam(event, 'id') || '')
  return { row, project: await requireProject(ctx, pointerId(row.get('project'))) }
}

export async function listPricingTables(project: ParseObject): Promise<ParseObject[]> {
  return await new (useParse()).Query('PricingTable').equalTo('project', project).ascending('createdAt').limit(PRICING_LIMITS.tables).find(MASTER)
}

export async function findPricingTableByKey(project: ParseObject, key: string): Promise<ParseObject | null> {
  return await new (useParse()).Query('PricingTable').equalTo('project', project).equalTo('key', key).first(MASTER) || null
}

function readKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!PRICING_KEY.test(key)) badRequest('key is 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit')
  return key
}

async function assertKeyFree(project: ParseObject, key: string, exceptId?: string): Promise<void> {
  const taken = await findPricingTableByKey(project, key)
  if (taken && taken.id !== exceptId) throw createError({ statusCode: 409, statusMessage: `Another pricing table already uses the key "${key}"` })
}

function snapshotOf(raw: Record<string, unknown>): PricingSnapshot {
  return {
    name: String(raw.name || ''),
    template: pricingTemplateOf(raw.template),
    plans: pricingPlansOf(raw.plans),
    features: pricingFeaturesOf(raw.features),
    content: normalizePricingContent(raw.content),
    style: normalizePricingStyle(raw.style),
    options: normalizePricingOptions(raw.options),
    checkout: normalizePricingCheckout(raw.checkout),
    locale: pricingLocaleOf(raw.locale),
    translations: pricingTranslationsOf(raw.translations)
  }
}

const KEYS = ['name', 'template', 'plans', 'features', 'content', 'style', 'options', 'checkout', 'locale', 'translations'] as const
/** A table's working copy, as saved. */
export const pricingWorkingCopy = (row: ParseObject) => snapshotOf(Object.fromEntries(KEYS.map(key => [key, row.get(key)])))

/** What apps get now: the snapshot of the last publish, and the Stripe entries it used then. */
function publishedOf(row: ParseObject): { snapshot: PricingSnapshot, stripe: StripeCatalog | null } | null {
  const raw = row.get('published') as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object' || !raw.snapshot) return null
  return { snapshot: snapshotOf(raw.snapshot as Record<string, unknown>), stripe: (raw.stripe as StripeCatalog | null) || null }
}

/** The project's accent (its style's, else the Brand kit's) and logo fill what a table leaves to them. */
function projectBrand(project: ParseObject) {
  return {
    name: String(project.get('name') || ''),
    accent: lookOf(project).accent,
    logoUrl: [String(project.get('iconUrl') || ''), String(project.get('brandLogoUrl') || '')].find(url => /^https?:\/\//.test(url)) || ''
  }
}

/** Where links in answers point: APP_URL, or the address the request came to. */
function baseUrl(event?: H3Event): string {
  const set = String(process.env.APP_URL || '').trim().replace(/\/+$/, '')
  if (set || !event) return set
  return getRequestURL(event).origin
}

const checkoutPath = (project: ParseObject, key: string) => `/v1/pricing/${String(project.get('publicKey') || '')}/${key}/checkout`

/** A table as apps would see it, from a snapshot. `checkoutUrl` '' leaves the checkout buttons without a link (previews). */
export function pricingTableFor(project: ParseObject, row: ParseObject, snapshot: PricingSnapshot, catalog: StripeCatalog | null, extra: { wanted?: { locales?: unknown[], currency?: string }, checkoutUrl?: string, experiment?: { table: string, run: string } | null } = {}): PublicPricingTable {
  return buildPublicPricing({
    key: String(row.get('key') || ''),
    version: typeof row.get('version') === 'number' ? row.get('version') as number : 0,
    publishedAt: iso(row.get('publishedAt')),
    project: projectBrand(project),
    look: pricingLook(lookOf(project).kit, lookOf(project).projectStyle, snapshot.style),
    snapshot,
    catalog,
    ...extra
  })
}

/** Problems an operator should fix before publishing: buttons that go nowhere, prices Stripe no longer has. Plans with the same problem are named together. */
export function pricingWarnings(snapshot: PricingSnapshot, catalog: CachedCatalog & { connected: boolean }): string[] {
  const out: string[] = []
  const byProblem = new Map<string, string[]>()
  const note = (problem: string, plan: string) => byProblem.set(problem, [...(byProblem.get(problem) || []), plan])
  const usesStripe = snapshot.plans.some(p => p.stripeProduct || PRICING_INTERVALS.some(slot => p.prices[slot].stripePrice))
  if (usesStripe && !catalog.connected) out.push('Plans are linked to Stripe, but Stripe is not connected to this project: connect it under Revenue.')
  if (catalog.connected && catalog.error) out.push(`Stripe could not be read: ${catalog.error}`)
  snapshot.plans.forEach((plan, i) => {
    const name = plan.name || plan.key || `Plan ${i + 1}`
    if (catalog.catalog) {
      if (plan.stripeProduct && !catalog.catalog.products.some(p => p.id === plan.stripeProduct)) out.push(`${name}: Stripe has no active product ${plan.stripeProduct}.`)
      for (const slot of PRICING_INTERVALS) {
        const id = plan.prices[slot].stripePrice
        if (id && !catalog.catalog.prices.some(p => p.id === id)) out.push(`${name}: the ${slot} price ${id} is archived or gone in Stripe${plan.stripeProduct ? '; the product\'s current price is used' : ''}.`)
      }
    }
    const prices = PRICING_INTERVALS.map(slot => ({ slot, stripe: stripePriceFor(plan, slot, catalog.catalog, snapshot.options.currency), manual: plan.prices[slot].amount }))
    const priced = prices.filter(p => p.stripe || p.manual !== null)
    if (!priced.length && !plan.customPrice) note('no price: link it to Stripe, write one, or set a label for no price.', name)
    // A free plan with nothing to buy needs no checkout.
    if (plan.action.type === 'checkout' && priced.some(p => !p.stripe && p.manual !== 0)) note('Stripe Checkout needs a Stripe price, so a written price gets no button link. Link the plan to Stripe, or set its button to a link of yours.', name)
    if (plan.action.type === 'payment_link' && catalog.catalog && priced.some(p => p.stripe && !catalog.catalog!.links.some(l => l.prices.includes(p.stripe!.id)))) {
      note('no active Stripe Payment Link sells its price; create one in Stripe.', name)
    }
  })
  const list = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  for (const [problem, names] of byProblem) out.push(`${list(names)}: ${problem}`)
  return out
}

export async function serializePricingTable(project: ParseObject, row: ParseObject, catalog: CachedCatalog & { connected: boolean }, event?: H3Event) {
  const content = pricingWorkingCopy(row)
  const published = publishedOf(row)
  const status = row.get('status') === 'published' && published ? 'published' : 'draft'
  const key = String(row.get('key') || '')
  const pk = String(project.get('publicKey') || '')
  const error = row.get('checkoutError') as { message?: string, at?: string } | undefined
  const { name, ...rest } = content
  return {
    id: row.id || '',
    key,
    name,
    status,
    version: typeof row.get('version') === 'number' ? row.get('version') as number : 0,
    ...rest,
    /** The working copy differs from what apps get. */
    changed: status === 'published' && JSON.stringify(content) !== JSON.stringify(published!.snapshot),
    /** What apps get now, in the table's own language, or null while it is a draft. */
    published: status === 'published' ? pricingTableFor(project, row, published!.snapshot, catalog.catalog || published!.stripe, { checkoutUrl: `${baseUrl(event)}${checkoutPath(project, key)}` }) : null,
    publishedAt: iso(row.get('publishedAt')),
    warnings: pricingWarnings(content, catalog),
    /** Every string a translation can replace, by its flat key, in the table's own language. */
    texts: pricingTexts(content),
    /** The last time Stripe refused to start a checkout, until one works again. */
    checkoutError: error?.message ? { message: String(error.message), at: String(error.at || '') } : null,
    /** The A/B test this table runs, with other tables as its variants. */
    experiment: pricingExperimentOf(row.get('experiment')),
    path: `/v1/pricing/${pk}/${key}`,
    pagePath: `/pricing/${pk}/${key}`,
    updatedAt: iso(row.updatedAt)
  }
}

/** Applies a create or PATCH body onto `row`; only the keys present change. Nothing is saved. */
async function applyInput(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const errors: string[] = []
  const current = pricingWorkingCopy(row)
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > PRICING_LIMITS.name) errors.push(`name is 1 to ${PRICING_LIMITS.name} characters`)
    else current.name = name
  }
  if (body.key !== undefined) {
    const key = readKey(body.key)
    await assertKeyFree(project, key, row.id)
    row.set('key', key)
  }
  if (body.template !== undefined) {
    if (!PRICING_TEMPLATES.includes(body.template as PricingTemplate)) errors.push(`template is one of ${PRICING_TEMPLATES.join(', ')}`)
    else current.template = body.template as PricingTemplate
  }
  if (body.features !== undefined) {
    const result = validatePricingFeatures(body.features)
    errors.push(...result.errors)
    current.features = result.features
  }
  const rows = current.features.map(f => f.id)
  if (body.plans !== undefined) {
    const result = validatePricingPlans(body.plans, rows)
    errors.push(...result.errors)
    current.plans = result.plans
  } else if (body.features !== undefined) {
    // Values for rows that are gone go with them.
    const keep = new Set(rows)
    current.plans = current.plans.map(p => ({ ...p, features: Object.fromEntries(Object.entries(p.features).filter(([id]) => keep.has(id))) }))
  }
  if (body.content !== undefined) {
    const result = validatePricingContent(body.content, current.content)
    errors.push(...result.errors)
    current.content = result.content
  }
  if (body.style !== undefined) {
    const result = validatePricingStyle(body.style, current.style)
    errors.push(...result.errors)
    current.style = result.style
  }
  if (body.options !== undefined) {
    const result = validatePricingOptions(body.options, current.options)
    errors.push(...result.errors)
    current.options = result.options
  }
  if (body.checkout !== undefined) {
    const result = validatePricingCheckout(body.checkout, current.checkout)
    errors.push(...result.errors)
    current.checkout = result.checkout
  }
  if (body.locale !== undefined) {
    const locale = normalizeLocale(body.locale)
    if (!locale) errors.push('locale must be a language tag such as "en" or "pt-BR"')
    else current.locale = locale
  }
  if (body.experiment !== undefined) {
    const was = pricingExperimentOf(row.get('experiment'))
    if (was.status === 'running') throw createError({ statusCode: 409, statusMessage: 'Stop the A/B test before changing its variants or weights: a change halfway through skews the result' })
    const result = validatePricingExperiment(body.experiment, String(body.key ?? row.get('key') ?? ''), was)
    errors.push(...result.errors)
    for (const variant of result.experiment.variants) if (!(await findPricingTableByKey(project, variant.table))) errors.push(`The project has no pricing table "${variant.table}" to test`)
    if (!result.errors.length) row.set('experiment', result.experiment)
  }
  let translations: PricingTranslations = current.translations
  if (body.translations !== undefined) {
    const result = validatePricingTranslations(body.translations, current, current.locale, current.translations)
    errors.push(...result.errors)
    translations = result.translations
  }
  if (errors.length) badRequest(errors.join('; '))
  // A translated string whose original is gone, or the table's own language, goes too.
  const limits = pricingTextLimits(current)
  current.translations = Object.fromEntries(Object.entries(translations)
    .filter(([tag]) => tag.toLowerCase() !== current.locale.toLowerCase())
    .map(([tag, words]) => [tag, Object.fromEntries(Object.entries(words).filter(([key]) => limits[key]))]))
  for (const key of KEYS) row.set(key, current[key])
}

export async function createPricingTable(project: ParseObject, body: Record<string, unknown>): Promise<ParseObject> {
  if ((await listPricingTables(project)).length >= PRICING_LIMITS.tables) badRequest(`A project has at most ${PRICING_LIMITS.tables} pricing tables`)
  const template = PRICING_TEMPLATES.includes(body.template as PricingTemplate) ? body.template as PricingTemplate : 'tiers'
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, PRICING_LIMITS.name) : 'Pricing'
  const row = new (useParse().Object.extend('PricingTable'))() as ParseObject
  const starter = starterPricing(template)
  row.set('project', project)
  row.set('status', 'draft')
  row.set('version', 0)
  row.set('name', name)
  row.set('template', template)
  // Starter rows unless the body brings its own; plans sent without features keep no values.
  row.set('features', body.features === undefined && body.plans === undefined ? starter.features : [])
  row.set('plans', body.plans === undefined ? starter.plans : [])
  row.set('content', starter.content)
  row.set('style', DEFAULT_PRICING_STYLE)
  row.set('options', DEFAULT_PRICING_OPTIONS)
  row.set('checkout', DEFAULT_PRICING_CHECKOUT)
  row.set('locale', 'en')
  row.set('translations', {})
  // A key derived from the name gets a number until it is free; one sent explicitly must be free.
  if (body.key === undefined) {
    const base = pricingKeyFrom(name)
    let key = base
    for (let n = 2; await findPricingTableByKey(project, key); n++) key = `${base.slice(0, 36)}-${n}`
    row.set('key', key)
  }
  await applyInput(project, row, { ...body, name: undefined, template: undefined })
  await row.save(null, MASTER)
  return row
}

export async function updatePricingTable(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  await applyInput(project, row, body)
  await row.save(null, MASTER)
}

/** A draft as it would look, without saving it: a PATCH body applied to a copy of the working copy. */
export async function previewPricingTable(project: ParseObject, row: ParseObject, body: Record<string, unknown>, catalog: StripeCatalog | null): Promise<PublicPricingTable> {
  const copy = row.clone() as ParseObject
  await applyInput(project, copy, { ...body, key: undefined })
  const locale = normalizeLocale(body.previewLocale)
  return pricingTableFor(project, row, pricingWorkingCopy(copy), catalog, { wanted: { locales: locale ? [locale] : [], currency: typeof body.previewCurrency === 'string' ? body.previewCurrency : '' } })
}

/**
 * Machine-translates the working copy into each language (saved as a translation the operator can edit).
 * Strings already translated are kept unless `overwrite`. Nothing reaches apps until the next publish.
 */
export async function translatePricingTable(ctx: MemberContext, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const content = pricingWorkingCopy(row)
  const source = pricingTexts(content)
  if (!Object.keys(source).length) badRequest('The table has no text to translate')
  const next = { ...content.translations }
  for (const to of readTargetLocales(body.locales, content.locale)) {
    next[to] = await translateMissing(ctx, source, content.translations[to] || {}, { from: content.locale, to, context: 'pricing', overwrite: body.overwrite === true })
  }
  row.set('translations', next)
  await row.save(null, MASTER)
}

export async function publishPricingTable(project: ParseObject, row: ParseObject): Promise<void> {
  const snapshot = pricingWorkingCopy(row)
  if (!snapshot.plans.length) badRequest('A table with no plans cannot be published')
  // Ask Stripe now, so the copy kept with this version is current.
  const catalog = await projectCatalog(project, { wait: true }).catch(() => null)
  row.set('published', { snapshot, stripe: catalogSubset(snapshot, catalog?.catalog || null) })
  row.set('version', (typeof row.get('version') === 'number' ? row.get('version') as number : 0) + 1)
  row.set('status', 'published')
  row.set('publishedAt', new Date())
  await row.save(null, MASTER)
}

/** Apps get a 404; the published copy is kept for the next publish to replace. */
export async function unpublishPricingTable(row: ParseObject): Promise<void> {
  row.set('status', 'draft')
  await row.save(null, MASTER)
}

// ---- public reads ----------------------------------------------------------------------

/**
 * A published table of the project with this public key: by its key, or with no key the
 * project's first (so an embed works with nothing but the public key). Anything else is a 404.
 */
export async function findPublishedPricingTable(pk: string, key: string): Promise<{ project: ParseObject, row: ParseObject, published: { snapshot: PricingSnapshot, stripe: StripeCatalog | null } }> {
  const project = await findProjectByPublicKey(pk)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  const wanted = key.trim().toLowerCase()
  const row = !wanted
    ? await new (useParse()).Query('PricingTable').equalTo('project', project).equalTo('status', 'published').ascending('createdAt').first(MASTER)
    : PRICING_KEY.test(wanted) ? await findPricingTableByKey(project, wanted) : null
  const published = row && row.get('status') === 'published' ? publishedOf(row) : null
  if (!row || !published) throw createError({ statusCode: 404, statusMessage: 'Pricing table not found' })
  return { project, row, published }
}

/** A published table in the reader's language (`?locale=`, then Accept-Language) and currency (`?currency=`). */
/** An id a client keeps for one visitor (pricing.js and the Swift snippet make one): letters, digits, - and _. */
export const readVisitor = (value: unknown) => (typeof value === 'string' && /^[\w-]{6,64}$/.test(value) ? value : '')

type Published = { snapshot: PricingSnapshot, stripe: StripeCatalog | null }

/**
 * The table a visitor sees: while the table runs an A/B test, the control or one of its published
 * variants, picked for the visitor and kept for the run; otherwise the table itself.
 */
export async function pricingArm(project: ParseObject, row: ParseObject, published: Published, visitor: string): Promise<{ row: ParseObject, published: Published, experiment: { table: string, run: string } | null }> {
  const experiment = pricingExperimentOf(row.get('experiment'))
  if (experiment.status !== 'running' || !experiment.variants.length) return { row, published, experiment: null }
  const controlKey = String(row.get('key') || '')
  const variants = await Promise.all(experiment.variants.map(v => findPricingTableByKey(project, v.table)))
  const live = new Map(variants.flatMap(v => (v && v.get('status') === 'published' && publishedOf(v) ? [[String(v.get('key')), v] as const] : [])))
  const picked = pickPricingArm(experiment, controlKey, visitor, [...live.keys()])
  const arm = live.get(picked)
  const tag = { table: controlKey, run: experiment.runId }
  return arm ? { row: arm, published: publishedOf(arm)!, experiment: tag } : { row, published, experiment: tag }
}

/** A published table in the reader's language (`?locale=`, then Accept-Language) and currency (`?currency=`), A/B tests applied for `?visitor=`. */
export async function publicPricingTable(event: H3Event): Promise<PublicPricingTable> {
  await rateLimit(`sb:rl:pricingread:${clientIp(event) || 'ip'}`, LIMITS.pricingReadsPerIp.limit, LIMITS.pricingReadsPerIp.window)
  const found = await findPublishedPricingTable(getRouterParam(event, 'pk') || '', getRouterParam(event, 'key') || '')
  setResponseHeader(event, 'Vary', 'Accept-Language')
  const q = getQuery(event)
  const arm = await pricingArm(found.project, found.row, found.published, readVisitor(q.visitor))
  return await pricingTableForApps(event, found.project, arm.row, arm.published, [q.locale, ...parseAcceptLanguage(getHeader(event, 'accept-language'))], { currency: String(q.currency || ''), experiment: arm.experiment })
}

/** The published table with Stripe's current prices (the copy kept at publish while Stripe cannot be read). */
export async function pricingTableForApps(event: H3Event | undefined, project: ParseObject, row: ParseObject, published: Published, locales: unknown[], options: { currency?: string, experiment?: { table: string, run: string } | null } = {}): Promise<PublicPricingTable> {
  const live = await projectCatalog(project).catch(() => null)
  return pricingTableFor(project, row, published.snapshot, live?.catalog || published.stripe, {
    wanted: { locales, currency: String(options.currency || '').toLowerCase() },
    checkoutUrl: `${baseUrl(event)}${checkoutPath(project, String(row.get('key') || ''))}`,
    experiment: options.experiment || null
  })
}

/** A published table by key for another public answer (an onboarding step), or null when it is not published. A/B tests apply for `visitor`. */
export async function publishedPricingTableByKey(project: ParseObject, key: string, locales: unknown[], event?: H3Event, visitor = ''): Promise<PublicPricingTable | null> {
  const row = PRICING_KEY.test(key) ? await findPricingTableByKey(project, key) : null
  const published = row && row.get('status') === 'published' ? publishedOf(row) : null
  if (!row || !published) return null
  const arm = await pricingArm(project, row, published, visitor)
  return await pricingTableForApps(event, project, arm.row, arm.published, locales, { experiment: arm.experiment })
}

/**
 * The A/B test a request names (`exp` the test's table, `run` its run), when `shown` really is one of
 * its tables and the run is the current one; null otherwise. What it is counted under.
 */
export async function namedExperiment(project: ParseObject, shown: string, exp: unknown, run: unknown): Promise<{ table: string, run: string } | null> {
  const key = typeof exp === 'string' ? exp.trim().toLowerCase() : ''
  if (!key || !PRICING_KEY.test(key) || typeof run !== 'string' || !run) return null
  const control = key === shown ? null : await findPricingTableByKey(project, key)
  const experiment = pricingExperimentOf((control || (key === shown ? await findPricingTableByKey(project, key) : null))?.get('experiment'))
  if (experiment.runId !== run || experiment.status === 'off') return null
  return key === shown || experiment.variants.some(v => v.table === shown) ? { table: key, run } : null
}

// ---- A/B tests ------------------------------------------------------------------------

/** Starts a run: every variant must be a published table. A new run id reshuffles who sees what and starts the numbers from zero. */
export async function startPricingExperiment(project: ParseObject, row: ParseObject): Promise<void> {
  const experiment = pricingExperimentOf(row.get('experiment'))
  if (!experiment.variants.length) badRequest('Add a variant to test against first')
  if (row.get('status') !== 'published') badRequest('Publish this table first: it is the control')
  for (const variant of experiment.variants) {
    const table = await findPricingTableByKey(project, variant.table)
    if (!table || table.get('status') !== 'published') badRequest(`Publish the variant "${variant.table}" first`)
  }
  row.set('experiment', { ...experiment, status: 'running', runId: `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, startedAt: new Date().toISOString(), endedAt: null })
  await row.save(null, MASTER)
}

/**
 * Ends the run; its numbers are kept. With `adopt`, the variant's working copy (plans, features,
 * words, look) becomes this table's, to publish when ready: how a winner goes live under the key sites already use.
 */
export async function stopPricingExperiment(project: ParseObject, row: ParseObject, adopt?: unknown): Promise<void> {
  const experiment = pricingExperimentOf(row.get('experiment'))
  if (experiment.status !== 'running') badRequest('No A/B test is running')
  if (typeof adopt === 'string' && adopt) {
    if (!experiment.variants.some(v => v.table === adopt)) badRequest(`"${adopt}" is not a variant of this test`)
    const winner = await findPricingTableByKey(project, adopt)
    if (!winner) badRequest(`The project has no pricing table "${adopt}"`)
    for (const key of ['template', 'plans', 'features', 'content', 'style', 'options', 'checkout', 'translations'] as const) row.set(key, winner.get(key))
  }
  row.set('experiment', { ...experiment, status: 'ended', endedAt: new Date().toISOString() })
  await row.save(null, MASTER)
}

/** A new variant to test: a draft copy of this table's working copy, added to its test. */
export async function addPricingVariant(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<ParseObject> {
  const experiment = pricingExperimentOf(row.get('experiment'))
  if (experiment.status === 'running') throw createError({ statusCode: 409, statusMessage: 'Stop the A/B test before adding a variant' })
  if (experiment.variants.length >= 3) badRequest('A test has at most 3 variants')
  const copy = pricingWorkingCopy(row)
  const base = String(row.get('key') || 'pricing')
  const letter = 'bcd'[experiment.variants.length]!
  let key = typeof body.key === 'string' && body.key.trim() ? readKey(body.key) : `${base.slice(0, 36)}-${letter}`
  if (typeof body.key !== 'string') for (let n = 2; await findPricingTableByKey(project, key); n++) key = `${base.slice(0, 33)}-${letter}${n}`
  const variant = await createPricingTable(project, { ...copy, name: `${copy.name} · ${letter.toUpperCase()}`.slice(0, PRICING_LIMITS.name), key })
  row.set('experiment', { ...experiment, variants: [...experiment.variants, { table: key, weight: experiment.weight || 50 }] })
  await row.save(null, MASTER)
  return variant
}

// ---- checkout --------------------------------------------------------------------------

export type CheckoutInput = { plan: unknown, interval: unknown, email?: unknown, reference?: unknown, returnUrl?: unknown, locale?: unknown, currency?: unknown, experiment?: unknown, run?: unknown, visitor?: unknown }

/**
 * A Payment Link with the buyer's email and an id. Without an id of the developer's own, a visitor in
 * an A/B test gets `hbx__<test>__<table>__<run>`, which is how its purchase is counted for the test.
 */
export function paymentLinkFor(url: string, input: { email?: string, reference?: string, experiment?: { table: string, run: string } | null, shown: string }): string {
  const link = new URL(url)
  if (input.email) link.searchParams.set('prefilled_email', input.email)
  const reference = input.reference || (input.experiment ? `hbx__${input.experiment.table}__${input.shown}__${input.experiment.run}` : '')
  if (reference) link.searchParams.set('client_reference_id', reference)
  return link.toString()
}

/** `url` with `name=value` added to its query; `value` is put in as written (Stripe's {CHECKOUT_SESSION_ID} must stay literal). */
function withParam(url: string, name: string, value: string): string {
  const [head, hash = ''] = url.split('#')
  return `${head}${head!.includes('?') ? '&' : '?'}${name}=${value}${hash ? `#${hash}` : ''}`
}

/** A return address the client may name: http(s), on the project's allowed origins (any site while it lists none) or HelpBites itself. */
export function allowedReturnUrl(value: unknown, allowedOrigins: string[], own: string): string {
  const url = safeHttpUrl(value)
  if (!url || url.length > PRICING_LIMITS.url) return ''
  const origin = normalizeOrigin(new URL(url).origin)
  if (own && origin === normalizeOrigin(own)) return url
  return !allowedOrigins.length || allowedOrigins.map(normalizeOrigin).includes(origin) ? url : ''
}

function checkoutLocale(locale: string): string {
  return CHECKOUT_LOCALES.find(l => l.toLowerCase() === locale.toLowerCase()) || CHECKOUT_LOCALES.find(l => l === locale.split('-')[0]) || 'auto'
}

async function stripePost(key: string, path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000)
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = String(body?.error?.message || res.statusText).slice(0, 300)
    throw createError({ statusCode: 502, statusMessage: res.status === 403 || /permission/i.test(message) ? `The project's Stripe key may not create Checkout Sessions: give it "Checkout Sessions: Write" (${message})` : `Stripe answered ${res.status}: ${message}` })
  }
  return body
}

async function noteCheckoutError(row: ParseObject, message: string): Promise<void> {
  const current = row.get('checkoutError') as { message?: string } | undefined
  if ((current?.message || '') === message) return
  row.set('checkoutError', message ? { message, at: new Date().toISOString() } : null)
  await row.save(null, MASTER).catch(() => {})
}

/**
 * Where a plan's button goes for one slot of a published table. For a Stripe Checkout plan
 * that is a new Checkout Session (prefilled with `email` and tagged with `reference` when given),
 * else the plan's Payment Link or URL. When Stripe refuses the session, the plan's Payment Link
 * is used if there is one.
 */
export async function pricingCheckout(event: H3Event, input: CheckoutInput): Promise<string> {
  await rateLimit(`sb:rl:pricingcheckout:${clientIp(event) || 'ip'}`, LIMITS.pricingCheckoutsPerIp.limit, LIMITS.pricingCheckoutsPerIp.window)
  const pk = getRouterParam(event, 'pk') || ''
  const { project, row, published } = await findPublishedPricingTable(pk, getRouterParam(event, 'key') || '')
  const { snapshot } = published
  const wanted = String(input.plan || '').trim()
  const plan = snapshot.plans.find(p => p.key === wanted.toLowerCase() || p.id === wanted)
  if (!plan) badRequest('plan is the key of one of the table\'s plans')
  const slot = String(input.interval || '') as PricingInterval
  if (!PRICING_INTERVALS.includes(slot)) badRequest(`interval is one of ${PRICING_INTERVALS.join(', ')}`)
  const locale = normalizeLocale(input.locale) || snapshot.locale
  const currency = /^[a-z]{3}$/i.test(String(input.currency || '')) ? String(input.currency).toLowerCase() : ''
  const shown = String(row.get('key') || '')
  const experiment = await namedExperiment(project, shown, input.experiment, input.run)
  const table = await pricingTableForApps(event, project, row, published, [locale], { currency, experiment })
  const price = table.plans.find(p => p.id === plan.id)?.prices[slot]
  if (plan.action.type === 'none') badRequest('This plan has no button')
  // Someone pressed the button: counted whatever happens next, under the test that showed it.
  await countPricing(project.id || '', row.id || '', experiment?.run || '', { checkouts: 1 }, { plan: plan.key, visitor: readVisitor(input.visitor) })
  if (plan.action.type !== 'checkout') {
    const href = price?.href || table.plans.find(p => p.id === plan.id)?.action.href
    if (!href) badRequest('This plan has no link for that interval')
    return href
  }
  if (!price || price.source !== 'stripe') badRequest('This plan has no Stripe price for that interval')

  const account = await findStripeAccount(project)
  if (!account) throw createError({ statusCode: 409, statusMessage: 'Stripe is not connected to this project' })
  const base = baseUrl(event)
  const back = allowedReturnUrl(input.returnUrl, (project.get('allowedOrigins') as string[] | undefined) || [], base)
  const site = safeHttpUrl(project.get('siteUrl'))
  const hosted = `${base}/pricing/${pk}/${String(row.get('key') || '')}`
  // The operator's own addresses win; else the page the button was on, the project's site, or the hosted page.
  const successUrl = snapshot.checkout.successUrl || back || site || hosted
  const cancelUrl = snapshot.checkout.cancelUrl || back || site || hosted
  const email = normalizeEmail(input.email)
  const reference = typeof input.reference === 'string' && /^[\w-]{1,200}$/.test(input.reference) ? input.reference : ''
  const subscription = slot !== 'once'
  const params: Record<string, string> = {
    'mode': subscription ? 'subscription' : 'payment',
    'line_items[0][price]': price.stripePrice,
    'line_items[0][quantity]': '1',
    // The address the operator set is used as written; the others are told how it went.
    'success_url': snapshot.checkout.successUrl || withParam(successUrl, 'checkout', 'success&session_id={CHECKOUT_SESSION_ID}'),
    'cancel_url': snapshot.checkout.cancelUrl || withParam(cancelUrl, 'checkout', 'canceled'),
    'locale': checkoutLocale(table.locale),
    'metadata[helpbites_table]': shown,
    'metadata[helpbites_plan]': plan.key,
    // Read back when the purchase completes: the conversion counts for this table and test (server/utils/pricingStats.ts).
    'metadata[helpbites_interval]': slot,
    ...(experiment ? { 'metadata[helpbites_experiment]': experiment.table, 'metadata[helpbites_run]': experiment.run } : {})
  }
  // Shown in a currency the price also sells in: Checkout charges in that one.
  if (currency && price.currency === currency) params.currency = currency
  if (snapshot.checkout.allowPromotionCodes) params.allow_promotion_codes = 'true'
  if (email) params.customer_email = email
  if (reference) params.client_reference_id = reference
  if (subscription) {
    params['subscription_data[metadata][helpbites_table]'] = String(row.get('key') || '')
    params['subscription_data[metadata][helpbites_plan]'] = plan.key
    if (price.trialDays > 0) params['subscription_data[trial_period_days]'] = String(price.trialDays)
  }
  try {
    const session = await stripePost(readCredential(String(account.get('secretSealed') || '')), '/checkout/sessions', params)
    if (row.get('checkoutError')) await noteCheckoutError(row, '')
    if (!session?.url) throw createError({ statusCode: 502, statusMessage: 'Stripe answered without a checkout URL' })
    return String(session.url)
  } catch (error) {
    const message = String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Checkout failed')
    await noteCheckoutError(row, message)
    console.warn(`[pricing] checkout for ${row.id} failed:`, message)
    const catalog = (await projectCatalog(project).catch(() => null))?.catalog || published.stripe
    const link = catalog?.links.find(l => l.prices.includes(price.stripePrice))
    if (link) return paymentLinkFor(link.url, { email, reference, experiment, shown })
    throw error
  }
}


// ---- the hosted page -------------------------------------------------------------------

/** A money amount as the page's noscript list shows it. */
function money(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount)
  } catch {
    return `${amount} ${currency.toUpperCase()}`
  }
}

/**
 * The table on a page of its own at /pricing/<pk>/<key>: a link to share, a page to frame, and
 * where checkout comes back to when nothing else is set. pricing.js draws it; without
 * JavaScript, a plain list of the plans and their links shows instead.
 */
export function pricingPage(table: PublicPricingTable, pk: string, options: { checkout?: string, poweredBy?: PoweredBy | null } = {}): string {
  const accent = /^#[0-9a-f]{6}$/i.test(table.style.accent) ? table.style.accent : '#5e6ad2'
  const note = options.checkout === 'success'
    ? '<p class="note" role="status">Thank you! Your payment went through, and a receipt is on its way to your inbox.</p>'
    : options.checkout === 'canceled' ? '<p class="note" role="status">Checkout was canceled, and nothing was charged. Pick a plan whenever you are ready.</p>' : ''
  const plans = table.plans.map((plan) => {
    const prices = PRICING_INTERVALS.map(slot => plan.prices[slot]).filter(Boolean).map((price) => {
      const label = `${money(price!.amount, price!.currency, table.locale)}${price!.interval === 'once' ? '' : ` / ${price!.interval}`}`
      return price!.href ? `<a href="${escapeHtml(price!.href)}" rel="nofollow">${escapeHtml(label)}</a>` : escapeHtml(label)
    })
    const custom = !prices.length && plan.customPrice ? (plan.action.href ? `<a href="${escapeHtml(plan.action.href)}">${escapeHtml(plan.customPrice)}</a>` : escapeHtml(plan.customPrice)) : ''
    return `<li><strong>${escapeHtml(plan.name)}</strong>${plan.description ? ` · ${escapeHtml(plan.description)}` : ''}<br>${[...prices, custom].filter(Boolean).join(' · ')}</li>`
  }).join('')
  const title = table.content.title || table.name
  return `<!doctype html>
<html lang="${escapeHtml(table.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(table.project.name)}</title>
<style>
${table.look
    ? `${styleCss(table.look)}\nbody { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 var(--font); }`
    : `:root { color-scheme: light dark; --bg: #f6f6f7; --text: #18181b; --muted: #6b6b76; }
@media (prefers-color-scheme: dark) { :root { --bg: #111113; --text: #ededf0; --muted: #a0a0ab; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }`}
main { max-width: 1120px; margin: 0 auto; padding: 48px 16px 32px; }
.note { max-width: 640px; margin: 0 auto 32px; padding: 12px 16px; border-radius: 12px; background: color-mix(in srgb, ${accent} 14%, transparent); text-align: center; }
noscript ul { max-width: 640px; margin: 0 auto; padding: 0; list-style: none; }
noscript li { padding: 14px 0; border-top: 1px solid color-mix(in srgb, var(--text) 12%, transparent); }
noscript a { color: ${accent}; }
</style>
</head>
<body>
<main>
${note}
<div id="pricing"></div>
<noscript><h1>${escapeHtml(title)}</h1><ul>${plans}</ul></noscript>
${poweredByHtml(options.poweredBy)}
</main>
<script src="/pricing.js" data-project="${escapeHtml(pk)}" data-table="${escapeHtml(table.key)}" data-target="#pricing" data-theme="${table.look && table.look.scheme !== 'auto' ? table.look.scheme : 'system'}" data-locale="${escapeHtml(table.locale)}" defer></script>
</body>
</html>`
}
