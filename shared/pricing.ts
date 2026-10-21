import { DEFAULT_CONTENT_LOCALE, matchLocale, normalizeLocale } from './locales'
import { fromMinor } from './stripe'
import { safeHttpUrl } from './support'

// Pricing tables: the plans a site or an app shows, as cards, rows, a mobile
// paywall, a comparison table or one spotlight plan. The copy (names, badges,
// feature lists, buttons) is written in HelpBites; the prices can be Stripe's,
// read live from the project's Stripe account, so a price changed in Stripe
// shows everywhere without a publish. A plan's button goes to Stripe Checkout,
// a Stripe Payment Link or any URL. Apps read the published version from
// GET /v1/pricing/{pk}/{key} (docs/PRICING.md). Shared by the server, the
// panel (its live preview builds the public shape here) and the embeds'
// contract; the native app ports the limits by hand
// (tests/pricingNativeParity.test.ts).

export const PRICING_LIMITS = {
  tables: 50, plans: 6, features: 40, name: 80, title: 120, subtitle: 300, description: 240, badge: 30, feature: 120, hint: 200,
  cell: 40, label: 40, note: 80, custom: 40, footnote: 400, url: 500, product: 120, radius: 32, trialDays: 730, amount: 1_000_000
} as const
/** A table's or a plan's key, the name an app asks for it by: lowercase letters, digits and dashes. */
export const PRICING_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/
/** Languages a table can be translated into, besides the one it is written in. */
export const PRICING_MAX_LOCALES = 20
export const PRICING_TEMPLATES = ['tiers', 'rows', 'paywall', 'matrix', 'spotlight'] as const
/** The price slots of a plan, in the order a toggle lists them. */
export const PRICING_INTERVALS = ['week', 'month', 'year', 'once'] as const
/** The slots a subscription bills in; the toggle offers those a table has. */
export const PRICING_RECURRING = ['week', 'month', 'year'] as const
export const PRICING_ACTIONS = ['checkout', 'payment_link', 'url', 'none'] as const
export const PRICING_FONTS = ['system', 'rounded', 'serif', 'mono'] as const
export const PRICING_DENSITIES = ['compact', 'comfortable', 'spacious'] as const
export const PRICING_SURFACES = ['flat', 'outline', 'shadow'] as const
export const PRICING_HIGHLIGHTS = ['border', 'fill', 'raise'] as const
export const PRICING_YEARLY_AS = ['total', 'monthly'] as const

export type PricingTemplate = (typeof PRICING_TEMPLATES)[number]
export type PricingInterval = (typeof PRICING_INTERVALS)[number]
export type PricingActionType = (typeof PRICING_ACTIONS)[number]
export type PricingFont = (typeof PRICING_FONTS)[number]
export type PricingDensity = (typeof PRICING_DENSITIES)[number]
export type PricingSurface = (typeof PRICING_SURFACES)[number]
export type PricingHighlight = (typeof PRICING_HIGHLIGHTS)[number]

/** One price slot of a plan. Stripe wins: a hand-written amount shows only when Stripe has no price for the slot. */
export type PricingPriceRef = {
  /** `price_…`: this Stripe price. '' with the plan's `stripeProduct` set: the product's active price for the slot. */
  stripePrice: string
  /** Written by hand in the currency's units (19.99, in the table's `options.currency`), or null for none. */
  amount: number | null
  /** The written price in other currencies, by lowercase code: { eur: 17.99 }. A visitor who asks for one gets it. */
  amounts: Record<string, number>
  /** The App Store product id of this plan and slot, handed to an app that sells through StoreKit. */
  appStoreProduct: string
}

/** A row of the feature list: a feature, or a heading the comparison table groups rows under. */
export type PricingFeature = { id: string, kind: 'feature' | 'heading', text: string, hint: string }

/** A plan's value for a feature: included (true), not (false), or included with a value ("10", "Unlimited", "Priority"). */
export type PricingCell = boolean | string

export type PricingAction = {
  type: PricingActionType
  /** The button's words; '' uses the client's own (Get started, Start free trial, Contact us). */
  label: string
  /** `url` only. `{plan}` and `{interval}` are replaced with the plan's key and the chosen slot. */
  url: string
}

export type PricingPlan = {
  id: string
  /** Apps refer to the plan by it (the visitor's current plan, the select callback). */
  key: string
  /** '' uses the Stripe product's name. */
  name: string
  /** '' uses the Stripe product's description. */
  description: string
  /** "Most popular". */
  badge: string
  highlighted: boolean
  /** `prod_…`, or ''. */
  stripeProduct: string
  prices: Record<PricingInterval, PricingPriceRef>
  /** Shown in place of a price when the plan has none: "Custom", "Let's talk". */
  customPrice: string
  /** Under the price: "per seat". '' uses Stripe's unit label, then the interval. */
  priceNote: string
  /** A free trial: shown, and given to Stripe Checkout. 0 for none. */
  trialDays: number
  action: PricingAction
  /** By feature id; a feature not listed is not included. */
  features: Record<string, PricingCell>
}

export type PricingContent = {
  title: string
  subtitle: string
  /** Small print under the plans: taxes, "cancel anytime". */
  footnote: string
  /** The toggle's words; '' uses the client's own (Weekly, Monthly, Yearly, Save {percent}%). */
  weeklyLabel: string
  monthlyLabel: string
  yearlyLabel: string
  /** `{percent}` is replaced with the best saving a year gives. */
  savingsLabel: string
  /** Links a paywall shows under its button (the App Store asks for both). */
  termsUrl: string
  privacyUrl: string
}

export type PricingStyle = {
  /** '#rrggbb', or '' for the project's accent. */
  accent: string
  /** '' follows the host's light or dark theme. */
  background: string
  text: string
  radius: number
  font: PricingFont
  density: PricingDensity
  /** How a card is drawn: no edge, a hairline, or a shadow. */
  surface: PricingSurface
  /** How the highlighted plan stands out: an accent border, an accent fill, or raised above the others. */
  highlight: PricingHighlight
}

export type PricingOptions = {
  /** The slot the toggle starts on. */
  defaultInterval: 'week' | 'month' | 'year'
  /** A yearly price as its total ("$120 / year") or as a month ("$10 / month, billed yearly"). */
  yearlyAs: (typeof PRICING_YEARLY_AS)[number]
  /** Each plan lists what it adds to the one before ("Everything in Starter, plus"). */
  cumulative: boolean
  /** Cards also list what a plan leaves out, crossed off. */
  showExcluded: boolean
  /** On the yearly view, the monthly price for a year is shown struck through beside the yearly one. */
  compare: boolean
  /** Three letters: hand-written prices are in it, and a Stripe price with several currencies uses it. */
  currency: string
}

/**
 * An A/B test run from a table (the control): visitors are split by weight between it and
 * other tables of the project (the variants), each a table of its own the operator edits and
 * publishes as usual. A visitor keeps the table they were given for the whole run.
 */
export type PricingExperiment = {
  status: 'off' | 'running' | 'ended'
  /** Each run gets a new one: it seeds who sees what, and keys its numbers. */
  runId: string
  /** The control's share; the variants' are their own `weight`. */
  weight: number
  variants: { table: string, weight: number }[]
  startedAt: string | null
  endedAt: string | null
}

export type PricingCheckout = {
  /** Where Stripe Checkout sends people after paying, and when they go back. '' uses the page they came from. */
  successUrl: string
  cancelUrl: string
  allowPromotionCodes: boolean
}

/** One language of a table, by the flat keys of pricingTexts ("plans/pl_1/name"; Mongo keeps no dots in keys). A key left out falls back to the original. */
export type PricingTranslation = Record<string, string>
export type PricingTranslations = Record<string, PricingTranslation>

/** Everything a version is made of: the working copy, and what publishing freezes. */
export type PricingSnapshot = {
  name: string
  template: PricingTemplate
  plans: PricingPlan[]
  features: PricingFeature[]
  content: PricingContent
  style: PricingStyle
  options: PricingOptions
  checkout: PricingCheckout
  locale: string
  translations: PricingTranslations
}

// ---- Stripe, as HelpBites reads it ----------------------------------------------------

/** An active Stripe price. `amount` is in the currency's smallest unit, like Stripe's. */
export type StripeCatalogPrice = {
  id: string
  product: string
  currency: string
  amount: number
  type: 'recurring' | 'one_time'
  /** Recurring only: day, week, month or year. */
  interval: string
  intervalCount: number
  nickname: string
  lookupKey: string
  /** Seconds. */
  created: number
  /** Other currencies the price is sold in, in their smallest unit. */
  currencyOptions: Record<string, number>
}
export type StripeCatalogProduct = { id: string, name: string, description: string, defaultPrice: string, unitLabel: string, features: string[] }
export type StripeCatalogLink = { id: string, url: string, prices: string[], trialDays: number }
/** The project's active products, prices and payment links (server/utils/pricing.ts keeps a copy for a few minutes). */
export type StripeCatalog = { products: StripeCatalogProduct[], prices: StripeCatalogPrice[], links: StripeCatalogLink[], fetchedAt: string }

// ---- what apps receive ---------------------------------------------------------------

export type PublicPricingPrice = {
  interval: PricingInterval
  /** In the currency's units: 19.99. */
  amount: number
  currency: string
  /** Billed every this many months or years (3 for quarterly); 1 for one-time prices. */
  intervalCount: number
  /** A yearly price divided by twelve; null otherwise. */
  monthly: number | null
  trialDays: number
  /** Where the button goes for this price: HelpBites' checkout link, the Payment Link or your URL; null for no button. */
  href: string | null
  source: 'stripe' | 'manual'
  stripePrice: string
  appStoreProduct: string
}

/** A line of a plan's card: the feature's words and, for a value, the value ("10" projects). */
export type PublicPricingLine = { id: string, text: string, hint: string, value: string, included: boolean }

export type PublicPricingPlan = {
  id: string
  key: string
  name: string
  description: string
  badge: string
  highlighted: boolean
  customPrice: string
  priceNote: string
  /** Stripe's unit label ("seat"), '' without one. */
  unitLabel: string
  prices: Partial<Record<PricingInterval, PublicPricingPrice>>
  /** Percent a year saves against twelve months of the monthly price; 0 unless the plan has both. */
  savings: number
  /** `href` is a `url` action's link for a plan with no price ("Contact us"); a price's own `href` wins. */
  action: { type: PricingActionType, label: string, href: string | null }
  trialDays: number
  /** The card's list: with `cumulative`, only what this plan adds to `includes`. */
  lines: PublicPricingLine[]
  /** With `cumulative`, the plan before it ("Everything in Starter, plus"); '' otherwise. */
  includes: string
  /** Every feature's value, for the comparison table. Headings are left out. */
  cells: Record<string, PricingCell>
}

export type PublicPricingTable = {
  key: string
  name: string
  /** The language of this copy: the one asked for when the table has it, else its own. */
  locale: string
  /** Every language the table has (its own first). */
  locales: string[]
  version: number
  publishedAt: string | null
  project: { name: string, logoUrl: string }
  template: PricingTemplate
  style: PricingStyle
  options: Omit<PricingOptions, 'currency'>
  content: PricingContent
  /** The slots some plan has a price for, in order; a toggle shows when it has two that bill again. */
  intervals: PricingInterval[]
  /** The currency the prices are in (the one asked for when every price has it, else the table's). */
  currency: string
  /** Every currency every price can be shown in, for a switcher; empty unless there are two or more. */
  currencies: string[]
  /** With an A/B test running: the test's table (`key` is the one shown) and its run; null otherwise. Send both back with events and checkout. */
  experiment: { table: string, run: string } | null
  /** The best saving of any plan, for the toggle's badge. */
  savings: number
  features: PricingFeature[]
  plans: PublicPricingPlan[]
}

// ---- defaults ------------------------------------------------------------------------

export const DEFAULT_PRICING_CONTENT: PricingContent = { title: '', subtitle: '', footnote: '', weeklyLabel: '', monthlyLabel: '', yearlyLabel: '', savingsLabel: '', termsUrl: '', privacyUrl: '' }
export const DEFAULT_PRICING_STYLE: PricingStyle = { accent: '', background: '', text: '', radius: 16, font: 'system', density: 'comfortable', surface: 'outline', highlight: 'border' }
export const DEFAULT_PRICING_OPTIONS: PricingOptions = { defaultInterval: 'year', yearlyAs: 'total', cumulative: false, showExcluded: false, compare: false, currency: 'usd' }
export const DEFAULT_PRICING_CHECKOUT: PricingCheckout = { successUrl: '', cancelUrl: '', allowPromotionCodes: false }
export const DEFAULT_PRICING_EXPERIMENT: PricingExperiment = { status: 'off', runId: '', weight: 50, variants: [], startedAt: null, endedAt: null }
/** Variants a test can have besides the control. */
export const PRICING_MAX_VARIANTS = 3

const HEX = /^#[0-9a-f]{6}$/i
const ID = /^[\w-]{1,40}$/

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

let counter = 0
function newId(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
export const newPlanId = () => newId('pl')
export const newFeatureId = () => newId('ft')

/** A key from a name: "Pro plan" → "pro-plan". */
export function pricingKeyFrom(name: string, fallback = 'pricing'): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || fallback
}

export const emptyPrice = (amount: number | null = null): PricingPriceRef => ({ stripePrice: '', amount, amounts: {}, appStoreProduct: '' })

export function blankPlan(name = '', key = ''): PricingPlan {
  return {
    id: newPlanId(), key: key || pricingKeyFrom(name, 'plan'), name, description: '', badge: '', highlighted: false, stripeProduct: '',
    prices: { week: emptyPrice(), month: emptyPrice(), year: emptyPrice(), once: emptyPrice() }, customPrice: '', priceNote: '', trialDays: 0,
    action: { type: 'checkout', label: '', url: '' }, features: {}
  }
}

function feature(text: string, kind: PricingFeature['kind'] = 'feature'): PricingFeature {
  return { id: newFeatureId(), kind, text, hint: '' }
}

/** Plans and features to start from, so the editor never opens empty. They fit the template chosen. */
export function starterPricing(template: PricingTemplate): Pick<PricingSnapshot, 'plans' | 'features' | 'content'> {
  if (template === 'paywall' || template === 'spotlight') {
    const lines = template === 'paywall'
      ? ['Everything unlocked', 'Sync across your devices', 'New features first', 'Support an indie developer']
      : ['Every feature, forever', 'All future updates', 'Use it on every device', 'Priority email support']
    const features = lines.map(text => feature(text))
    const plan = blankPlan(template === 'paywall' ? 'Pro' : 'Lifetime')
    plan.highlighted = true
    if (template === 'paywall') {
      plan.prices.month.amount = 4.99
      plan.prices.year.amount = 39.99
      plan.trialDays = 7
    } else plan.prices.once.amount = 99
    for (const f of features) plan.features[f.id] = true
    return { plans: [plan], features, content: { ...DEFAULT_PRICING_CONTENT, title: template === 'paywall' ? 'Unlock everything' : 'One price, yours forever' } }
  }
  const [projects, members, support, priority, sso] = [feature('Projects'), feature('Team members'), feature('Email support'), feature('Priority support'), feature('Single sign-on')]
  const features = template === 'matrix' ? [feature('Usage', 'heading'), projects!, members!, feature('Support', 'heading'), support!, priority!, sso!] : [projects!, members!, support!, priority!, sso!]
  const starter = blankPlan('Starter')
  starter.description = 'For trying it out on your own.'
  starter.prices.month.amount = 0
  starter.features = { [projects!.id]: '1', [members!.id]: '1', [support!.id]: true }
  const pro = blankPlan('Pro')
  pro.description = 'For a product people pay for.'
  pro.badge = 'Most popular'
  pro.highlighted = true
  pro.prices.month.amount = 12
  pro.prices.year.amount = 120
  pro.features = { [projects!.id]: '10', [members!.id]: '5', [support!.id]: true, [priority!.id]: true }
  const team = blankPlan('Team')
  team.description = 'For a growing team.'
  team.prices.month.amount = 29
  team.prices.year.amount = 290
  team.features = { [projects!.id]: 'Unlimited', [members!.id]: 'Unlimited', [support!.id]: true, [priority!.id]: true, [sso!.id]: true }
  return { plans: [starter, pro, team], features, content: { ...DEFAULT_PRICING_CONTENT, title: 'Simple pricing', subtitle: 'Start free. Upgrade when you need more.' } }
}

// ---- validation ----------------------------------------------------------------------

function text(raw: Record<string, unknown>, key: string, max: number, errors: string[], label: string): string {
  const value = raw[key]
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') { errors.push(`${label} must be text`); return '' }
  const trimmed = value.trim()
  if (trimmed.length > max) errors.push(`${label} is up to ${max} characters`)
  return trimmed.slice(0, max)
}

function url(raw: Record<string, unknown>, key: string, errors: string[], label: string): string {
  const value = raw[key]
  if (value === undefined || value === null || value === '') return ''
  const safe = safeHttpUrl(value)
  if (!safe || safe.length > PRICING_LIMITS.url) { errors.push(`${label} must be an http(s) URL`); return '' }
  return safe
}

function amountOf(value: unknown, errors: string[], label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > PRICING_LIMITS.amount) { errors.push(`${label} is a price from 0 to ${PRICING_LIMITS.amount}, or null`); return null }
  return Math.round(n * 100) / 100
}

function priceRef(value: unknown, errors: string[], label: string): PricingPriceRef {
  const raw = record(value)
  const stripePrice = typeof raw.stripePrice === 'string' ? raw.stripePrice.trim() : ''
  if (stripePrice && !/^price_[A-Za-z0-9]{4,}$/.test(stripePrice)) errors.push(`${label}.stripePrice must be a Stripe price id (price_…) or empty`)
  const appStoreProduct = text(raw, 'appStoreProduct', PRICING_LIMITS.product, errors, `${label}.appStoreProduct`)
  if (appStoreProduct && !/^[\w.-]+$/.test(appStoreProduct)) errors.push(`${label}.appStoreProduct is an App Store product id such as com.acme.pro.yearly`)
  const amounts: Record<string, number> = {}
  for (const [code, value] of Object.entries(record(raw.amounts))) {
    const currency = code.trim().toLowerCase()
    if (!/^[a-z]{3}$/.test(currency)) { errors.push(`${label}.amounts: "${code.slice(0, 8)}" is not a three-letter currency code`); continue }
    const amount = amountOf(value, errors, `${label}.amounts.${currency}`)
    if (amount !== null) amounts[currency] = amount
  }
  return { stripePrice: /^price_[A-Za-z0-9]{4,}$/.test(stripePrice) ? stripePrice : '', amount: amountOf(raw.amount, errors, `${label}.amount`), amounts, appStoreProduct }
}

function cellOf(value: unknown, errors: string[], label: string): PricingCell | undefined {
  if (value === true || value === false) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > PRICING_LIMITS.cell) errors.push(`${label} is up to ${PRICING_LIMITS.cell} characters`)
    return trimmed ? trimmed.slice(0, PRICING_LIMITS.cell) : false
  }
  if (value === null || value === undefined) return undefined
  errors.push(`${label} is true, false or a short text`)
  return undefined
}

/** The full list of feature rows. A row without an id gets one; ids stay unique. */
export function validatePricingFeatures(value: unknown): { features: PricingFeature[], errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(value)) return { features: [], errors: ['features must be a list'] }
  if (value.length > PRICING_LIMITS.features) errors.push(`A table has at most ${PRICING_LIMITS.features} feature rows`)
  const seen = new Set<string>()
  const features = value.slice(0, PRICING_LIMITS.features).map((item, index) => {
    const raw = record(item)
    const n = index + 1
    let id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : ''
    if (!id || seen.has(id)) id = newFeatureId()
    seen.add(id)
    const kind = raw.kind === 'heading' ? 'heading' : 'feature'
    if (raw.kind !== undefined && raw.kind !== 'heading' && raw.kind !== 'feature') errors.push(`Feature ${n}: kind is feature or heading`)
    const row: PricingFeature = { id, kind, text: text(raw, 'text', PRICING_LIMITS.feature, errors, `Feature ${n}: text`), hint: kind === 'heading' ? '' : text(raw, 'hint', PRICING_LIMITS.hint, errors, `Feature ${n}: hint`) }
    if (!row.text) errors.push(`Feature ${n} has no text`)
    return row
  })
  return { features, errors }
}

/** The full list of plans, in order. `featureIds` are the table's rows: a plan's values for anything else are dropped. */
export function validatePricingPlans(value: unknown, featureIds: string[]): { plans: PricingPlan[], errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(value)) return { plans: [], errors: ['plans must be a list'] }
  if (value.length > PRICING_LIMITS.plans) errors.push(`A table has at most ${PRICING_LIMITS.plans} plans`)
  const ids = new Set<string>()
  const keys = new Set<string>()
  const rows = new Set(featureIds)
  const plans = value.slice(0, PRICING_LIMITS.plans).map((item, index) => {
    const raw = record(item)
    const n = index + 1
    const label = `Plan ${n}`
    let id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : ''
    if (!id || ids.has(id)) id = newPlanId()
    ids.add(id)
    const name = text(raw, 'name', PRICING_LIMITS.name, errors, `${label}: name`)
    let key = typeof raw.key === 'string' ? raw.key.trim().toLowerCase() : ''
    if (key && !PRICING_KEY.test(key)) { errors.push(`${label}: key is 1 to 40 lowercase letters, digits and dashes`); key = '' }
    if (!key) key = pricingKeyFrom(name, `plan-${n}`)
    if (keys.has(key)) {
      if (typeof raw.key === 'string' && raw.key.trim()) errors.push(`${label}: another plan already uses the key "${key}"`)
      let m = 2
      while (keys.has(`${key.slice(0, 36)}-${m}`)) m++
      key = `${key.slice(0, 36)}-${m}`
    }
    keys.add(key)
    const stripeProduct = typeof raw.stripeProduct === 'string' ? raw.stripeProduct.trim() : ''
    if (stripeProduct && !/^prod_[A-Za-z0-9]{4,}$/.test(stripeProduct)) errors.push(`${label}: stripeProduct must be a Stripe product id (prod_…) or empty`)
    const pricesIn = record(raw.prices)
    const prices = Object.fromEntries(PRICING_INTERVALS.map(slot => [slot, priceRef(pricesIn[slot], errors, `${label}: prices.${slot}`)])) as Record<PricingInterval, PricingPriceRef>
    const trial = raw.trialDays === undefined || raw.trialDays === null ? 0 : Number(raw.trialDays)
    if (!Number.isInteger(trial) || trial < 0 || trial > PRICING_LIMITS.trialDays) errors.push(`${label}: trialDays is a whole number from 0 to ${PRICING_LIMITS.trialDays}`)
    const actionIn = record(raw.action)
    const type = actionIn.type === undefined ? 'checkout' : actionIn.type as PricingActionType
    if (!PRICING_ACTIONS.includes(type)) errors.push(`${label}: action.type is one of ${PRICING_ACTIONS.join(', ')}`)
    const action: PricingAction = {
      type: PRICING_ACTIONS.includes(type) ? type : 'checkout',
      label: text(actionIn, 'label', PRICING_LIMITS.label, errors, `${label}: action.label`),
      url: ''
    }
    if (action.type === 'url') {
      // `{plan}` and `{interval}` survive URL parsing as %7B…%7D; they are put back so the client can fill them.
      const raw = typeof actionIn.url === 'string' ? actionIn.url.trim() : ''
      action.url = safeHttpUrl(raw).replace(/%7Bplan%7D/gi, '{plan}').replace(/%7Binterval%7D/gi, '{interval}')
      if (!action.url || action.url.length > PRICING_LIMITS.url) errors.push(`${label}: action.url must be an http(s) URL`)
    }
    const features: Record<string, PricingCell> = {}
    for (const [fid, v] of Object.entries(record(raw.features))) {
      if (!rows.has(fid)) continue
      const cell = cellOf(v, errors, `${label}: features.${fid}`)
      if (cell !== undefined && cell !== false) features[fid] = cell
    }
    const plan: PricingPlan = {
      id, key, name, stripeProduct: /^prod_[A-Za-z0-9]{4,}$/.test(stripeProduct) ? stripeProduct : '',
      description: text(raw, 'description', PRICING_LIMITS.description, errors, `${label}: description`),
      badge: text(raw, 'badge', PRICING_LIMITS.badge, errors, `${label}: badge`),
      highlighted: raw.highlighted === true,
      prices,
      customPrice: text(raw, 'customPrice', PRICING_LIMITS.custom, errors, `${label}: customPrice`),
      priceNote: text(raw, 'priceNote', PRICING_LIMITS.note, errors, `${label}: priceNote`),
      trialDays: Number.isInteger(trial) && trial >= 0 && trial <= PRICING_LIMITS.trialDays ? trial : 0,
      action, features
    }
    if (!plan.name && !plan.stripeProduct) errors.push(`${label} needs a name or a Stripe product`)
    return plan
  })
  return { plans, errors }
}

export function validatePricingContent(value: unknown, base: PricingContent = DEFAULT_PRICING_CONTENT): { content: PricingContent, errors: string[] } {
  const errors: string[] = []
  const raw = record(value)
  const content = { ...base }
  const limits: Record<string, number> = { title: PRICING_LIMITS.title, subtitle: PRICING_LIMITS.subtitle, footnote: PRICING_LIMITS.footnote, weeklyLabel: PRICING_LIMITS.label, monthlyLabel: PRICING_LIMITS.label, yearlyLabel: PRICING_LIMITS.label, savingsLabel: PRICING_LIMITS.label }
  for (const [key, max] of Object.entries(limits)) if (raw[key] !== undefined) (content as Record<string, string>)[key] = text(raw, key, max, errors, `content.${key}`)
  for (const key of ['termsUrl', 'privacyUrl'] as const) if (raw[key] !== undefined) content[key] = url(raw, key, errors, `content.${key}`)
  return { content, errors }
}

function oneOf<T extends string>(raw: Record<string, unknown>, key: string, allowed: readonly T[], errors: string[], label: string): T | undefined {
  if (raw[key] === undefined) return undefined
  if (!allowed.includes(raw[key] as T)) { errors.push(`${label} is one of ${allowed.join(', ')}`); return undefined }
  return raw[key] as T
}

/** A (partial) style on top of `base`: only the keys sent change. */
export function validatePricingStyle(value: unknown, base: PricingStyle = DEFAULT_PRICING_STYLE): { style: PricingStyle, errors: string[] } {
  const errors: string[] = []
  const raw = record(value)
  const style = { ...base }
  for (const key of ['accent', 'background', 'text'] as const) {
    if (raw[key] === undefined) continue
    const colour = typeof raw[key] === 'string' ? (raw[key] as string).trim() : null
    if (colour === null || (colour && !HEX.test(colour))) errors.push(`style.${key} must be a #rrggbb colour or empty`)
    else style[key] = colour.toLowerCase()
  }
  if (raw.radius !== undefined) {
    const radius = Number(raw.radius)
    if (!Number.isInteger(radius) || radius < 0 || radius > PRICING_LIMITS.radius) errors.push(`style.radius is a whole number from 0 to ${PRICING_LIMITS.radius}`)
    else style.radius = radius
  }
  style.font = oneOf(raw, 'font', PRICING_FONTS, errors, 'style.font') ?? style.font
  style.density = oneOf(raw, 'density', PRICING_DENSITIES, errors, 'style.density') ?? style.density
  style.surface = oneOf(raw, 'surface', PRICING_SURFACES, errors, 'style.surface') ?? style.surface
  style.highlight = oneOf(raw, 'highlight', PRICING_HIGHLIGHTS, errors, 'style.highlight') ?? style.highlight
  return { style, errors }
}

export function validatePricingOptions(value: unknown, base: PricingOptions = DEFAULT_PRICING_OPTIONS): { options: PricingOptions, errors: string[] } {
  const errors: string[] = []
  const raw = record(value)
  const options = { ...base }
  options.defaultInterval = oneOf(raw, 'defaultInterval', PRICING_RECURRING, errors, 'options.defaultInterval') ?? options.defaultInterval
  options.yearlyAs = oneOf(raw, 'yearlyAs', PRICING_YEARLY_AS, errors, 'options.yearlyAs') ?? options.yearlyAs
  for (const key of ['cumulative', 'showExcluded', 'compare'] as const) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'boolean') errors.push(`options.${key} must be true or false`)
    else options[key] = raw[key] as boolean
  }
  if (raw.currency !== undefined) {
    const currency = typeof raw.currency === 'string' ? raw.currency.trim().toLowerCase() : ''
    if (!/^[a-z]{3}$/.test(currency)) errors.push('options.currency is a three-letter currency code such as usd or eur')
    else options.currency = currency
  }
  return { options, errors }
}

export function validatePricingCheckout(value: unknown, base: PricingCheckout = DEFAULT_PRICING_CHECKOUT): { checkout: PricingCheckout, errors: string[] } {
  const errors: string[] = []
  const raw = record(value)
  const checkout = { ...base }
  for (const key of ['successUrl', 'cancelUrl'] as const) if (raw[key] !== undefined) checkout[key] = url(raw, key, errors, `checkout.${key}`)
  if (raw.allowPromotionCodes !== undefined) {
    if (typeof raw.allowPromotionCodes !== 'boolean') errors.push('checkout.allowPromotionCodes must be true or false')
    else checkout.allowPromotionCodes = raw.allowPromotionCodes
  }
  return { checkout, errors }
}

export const normalizePricingContent = (value: unknown) => validatePricingContent(value).content
export const normalizePricingStyle = (value: unknown) => validatePricingStyle(value).style
export const normalizePricingOptions = (value: unknown) => validatePricingOptions(value).options
export const normalizePricingCheckout = (value: unknown) => validatePricingCheckout(value).checkout
export const pricingTemplateOf = (value: unknown): PricingTemplate => PRICING_TEMPLATES.includes(value as PricingTemplate) ? value as PricingTemplate : 'tiers'
export const pricingLocaleOf = (value: unknown): string => normalizeLocale(value) || DEFAULT_CONTENT_LOCALE

/** Saved feature rows as they are, without re-checking (they were checked on write). */
export function pricingFeaturesOf(value: unknown): PricingFeature[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const f = record(item)
    return { id: String(f.id || ''), kind: f.kind === 'heading' ? 'heading' : 'feature', text: String(f.text || ''), hint: String(f.hint || '') }
  })
}

/** Saved plans as they are, without re-checking (they were checked on write). */
export function pricingPlansOf(value: unknown): PricingPlan[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const p = record(item)
    const prices = record(p.prices)
    const action = record(p.action)
    const features: Record<string, PricingCell> = {}
    for (const [id, v] of Object.entries(record(p.features))) if (v === true || (typeof v === 'string' && v)) features[id] = v
    return {
      id: String(p.id || ''), key: String(p.key || ''), name: String(p.name || ''), description: String(p.description || ''), badge: String(p.badge || ''),
      highlighted: p.highlighted === true, stripeProduct: String(p.stripeProduct || ''),
      prices: Object.fromEntries(PRICING_INTERVALS.map((slot) => {
        const ref = record(prices[slot])
        const amounts = Object.fromEntries(Object.entries(record(ref.amounts)).filter(([, v]) => typeof v === 'number')) as Record<string, number>
        return [slot, { stripePrice: String(ref.stripePrice || ''), amount: typeof ref.amount === 'number' ? ref.amount : null, amounts, appStoreProduct: String(ref.appStoreProduct || '') }]
      })) as Record<PricingInterval, PricingPriceRef>,
      customPrice: String(p.customPrice || ''), priceNote: String(p.priceNote || ''), trialDays: Number(p.trialDays) || 0,
      action: { type: PRICING_ACTIONS.includes(action.type as PricingActionType) ? action.type as PricingActionType : 'checkout', label: String(action.label || ''), url: String(action.url || '') },
      features
    }
  })
}

// ---- translations --------------------------------------------------------------------

const CONTENT_TEXT = { title: PRICING_LIMITS.title, subtitle: PRICING_LIMITS.subtitle, footnote: PRICING_LIMITS.footnote, weeklyLabel: PRICING_LIMITS.label, monthlyLabel: PRICING_LIMITS.label, yearlyLabel: PRICING_LIMITS.label, savingsLabel: PRICING_LIMITS.label } as const
const PLAN_TEXT = { name: PRICING_LIMITS.name, description: PRICING_LIMITS.description, badge: PRICING_LIMITS.badge, customPrice: PRICING_LIMITS.custom, priceNote: PRICING_LIMITS.note } as const

/**
 * Every string of a table a translator works on, by a flat key, with its limit: `name`,
 * `content/<field>`, `features/<id>/text|hint`, `plans/<id>/<field>`, `plans/<id>/action`
 * (the button) and `plans/<id>/cells/<featureId>` (a value such as "Unlimited"). Empty ones are left out.
 */
export function pricingTextLimits(table: Pick<PricingSnapshot, 'name' | 'content' | 'features' | 'plans'>): Record<string, { text: string, max: number }> {
  const out: Record<string, { text: string, max: number }> = {}
  const add = (key: string, value: string, max: number) => { if (value.trim()) out[key] = { text: value, max } }
  add('name', table.name, PRICING_LIMITS.name)
  for (const [key, max] of Object.entries(CONTENT_TEXT)) add(`content/${key}`, table.content[key as keyof typeof CONTENT_TEXT], max)
  for (const f of table.features) {
    add(`features/${f.id}/text`, f.text, PRICING_LIMITS.feature)
    add(`features/${f.id}/hint`, f.hint, PRICING_LIMITS.hint)
  }
  for (const p of table.plans) {
    for (const [key, max] of Object.entries(PLAN_TEXT)) add(`plans/${p.id}/${key}`, p[key as keyof typeof PLAN_TEXT], max)
    add(`plans/${p.id}/action`, p.action.label, PRICING_LIMITS.label)
    for (const [fid, cell] of Object.entries(p.features)) if (typeof cell === 'string') add(`plans/${p.id}/cells/${fid}`, cell, PRICING_LIMITS.cell)
  }
  return out
}

export function pricingTexts(table: Pick<PricingSnapshot, 'name' | 'content' | 'features' | 'plans'>): Record<string, string> {
  return Object.fromEntries(Object.entries(pricingTextLimits(table)).map(([key, entry]) => [key, entry.text]))
}

/**
 * Translations as sent by an operator, on top of `base`: a language that is present replaces
 * that language, `null` removes it. Keys the table has no text for are dropped.
 */
export function validatePricingTranslations(value: unknown, table: Pick<PricingSnapshot, 'name' | 'content' | 'features' | 'plans'>, source: string, base: PricingTranslations = {}): { translations: PricingTranslations, errors: string[] } {
  const errors: string[] = []
  const out: PricingTranslations = { ...base }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { translations: out, errors: ['translations must be an object keyed by language'] }
  const limits = pricingTextLimits(table)
  for (const [rawTag, raw] of Object.entries(value as Record<string, unknown>)) {
    const tag = normalizeLocale(rawTag)
    if (!tag) { errors.push(`"${rawTag.slice(0, 20)}" is not a language tag`); continue }
    if (tag.toLowerCase() === source.toLowerCase()) { errors.push(`${tag} is the table's own language`); continue }
    if (raw === null) { delete out[tag]; continue }
    const translation: PricingTranslation = {}
    for (const [key, word] of Object.entries(record(raw))) {
      const limit = limits[key]
      if (!limit) continue
      const clean = text({ word }, 'word', limit.max, errors, `${tag}: ${key}`)
      if (clean) translation[key] = clean
    }
    out[tag] = translation
  }
  if (Object.keys(out).length > PRICING_MAX_LOCALES) errors.push(`A table has at most ${PRICING_MAX_LOCALES} translations`)
  return { translations: out, errors }
}

/** Saved translations as they are, without re-checking (they were checked on write). */
export function pricingTranslationsOf(value: unknown): PricingTranslations {
  const out: PricingTranslations = {}
  for (const [tag, raw] of Object.entries(record(value))) {
    const words: PricingTranslation = {}
    for (const [key, word] of Object.entries(record(raw))) if (typeof word === 'string' && word) words[key] = word
    out[tag] = words
  }
  return out
}

/** A table's words in one language: each translated string replaces the original, anything missing stays as written. */
export function localizePricing<T extends Pick<PricingSnapshot, 'name' | 'content' | 'features' | 'plans'>>(table: T, translation: PricingTranslation | undefined): T {
  if (!translation || !Object.keys(translation).length) return table
  const w = (key: string, original: string) => translation[key] || original
  return {
    ...table,
    name: w('name', table.name),
    content: { ...table.content, ...Object.fromEntries(Object.keys(CONTENT_TEXT).map(key => [key, w(`content/${key}`, table.content[key as keyof typeof CONTENT_TEXT])])) },
    features: table.features.map(f => ({ ...f, text: w(`features/${f.id}/text`, f.text), hint: w(`features/${f.id}/hint`, f.hint) })),
    plans: table.plans.map(p => ({
      ...p,
      ...Object.fromEntries(Object.keys(PLAN_TEXT).map(key => [key, w(`plans/${p.id}/${key}`, p[key as keyof typeof PLAN_TEXT])])),
      action: { ...p.action, label: w(`plans/${p.id}/action`, p.action.label) },
      features: Object.fromEntries(Object.entries(p.features).map(([fid, cell]) => [fid, typeof cell === 'string' ? w(`plans/${p.id}/cells/${fid}`, cell) : cell]))
    }))
  }
}

// ---- prices --------------------------------------------------------------------------

/** The slot a Stripe price fills: monthly, yearly or one-time. Weekly and daily prices fill none. */
export function slotOfPrice(price: Pick<StripeCatalogPrice, 'type' | 'interval'>): PricingInterval | null {
  if (price.type === 'one_time') return 'once'
  return price.interval === 'week' || price.interval === 'month' || price.interval === 'year' ? price.interval : null
}

/**
 * The Stripe price behind a slot: the one named (while it is active), else the product's
 * default price when it fits, else its newest price for the slot in the first of `currencies`
 * it sells in, else its newest.
 */
export function stripePriceFor(plan: Pick<PricingPlan, 'stripeProduct' | 'prices'>, slot: PricingInterval, catalog: StripeCatalog | null, currencies: string | string[]): StripeCatalogPrice | null {
  if (!catalog) return null
  const named = plan.prices[slot].stripePrice
  if (named) {
    const found = catalog.prices.find(p => p.id === named)
    if (found) return found
  }
  if (!plan.stripeProduct) return null
  const fits = catalog.prices.filter(p => p.product === plan.stripeProduct && slotOfPrice(p) === slot && (p.type === 'one_time' || p.intervalCount === 1))
  if (!fits.length) return null
  const product = catalog.products.find(p => p.id === plan.stripeProduct)
  const preferred = fits.find(p => p.id === product?.defaultPrice)
  if (preferred) return preferred
  const newest = [...fits].sort((a, b) => b.created - a.created)
  for (const currency of [currencies].flat().filter(Boolean)) {
    const found = newest.find(p => p.currency === currency || currency in p.currencyOptions)
    if (found) return found
  }
  return newest[0]!
}

/** A Stripe price's amount in `currency` when it is sold in it, else in its own; in the currency's units. */
function amountIn(price: StripeCatalogPrice, currency: string): { amount: number, currency: string } {
  if (currency && price.currency !== currency && typeof price.currencyOptions[currency] === 'number') return { amount: fromMinor(price.currencyOptions[currency]!, currency), currency }
  return { amount: fromMinor(price.amount, price.currency), currency: price.currency }
}

const roundTo = (value: number, currency: string) => (fromMinor(100, currency) === 100 ? Math.round(value) : Math.round(value * 100) / 100)

/** Percent a year saves against twelve months, 0 when it saves nothing or the prices cannot be compared. */
export function pricingSavings(month: Pick<PublicPricingPrice, 'amount' | 'currency' | 'intervalCount'> | undefined, year: Pick<PublicPricingPrice, 'amount' | 'currency' | 'intervalCount'> | undefined): number {
  if (!month || !year || month.currency !== year.currency || month.intervalCount !== 1 || year.intervalCount !== 1 || month.amount <= 0) return 0
  const percent = Math.floor((1 - year.amount / (month.amount * 12)) * 100)
  return percent > 0 ? percent : 0
}

/**
 * Where a plan's button goes for one price. `checkoutUrl` is HelpBites' checkout link for the table
 * ('' for none); `query` is added to it (the A/B test the visitor is in).
 */
function hrefFor(plan: PricingPlan, slot: PricingInterval, price: { source: 'stripe' | 'manual', stripePrice: string }, catalog: StripeCatalog | null, checkoutUrl: string, query = ''): { href: string | null, trialDays: number | null } {
  const { action } = plan
  if (action.type === 'none') return { href: null, trialDays: null }
  if (action.type === 'url') return { href: action.url.replace(/\{plan\}/g, encodeURIComponent(plan.key)).replace(/\{interval\}/g, slot) || null, trialDays: null }
  if (price.source !== 'stripe') return { href: null, trialDays: null }
  if (action.type === 'payment_link') {
    const link = catalog?.links.find(l => l.prices.includes(price.stripePrice))
    // A Payment Link carries its own trial, set in Stripe.
    return { href: link?.url || null, trialDays: link ? link.trialDays : null }
  }
  return { href: checkoutUrl ? `${checkoutUrl}?plan=${encodeURIComponent(plan.key)}&interval=${slot}${query}` : null, trialDays: null }
}

/** The currencies one slot of a plan can be shown in: its Stripe price's own and other currencies, or the written ones. */
function slotCurrencies(plan: PricingPlan, slot: PricingInterval, catalog: StripeCatalog | null, currency: string): string[] {
  const stripe = stripePriceFor(plan, slot, catalog, [currency])
  if (stripe) return [stripe.currency, ...Object.keys(stripe.currencyOptions)]
  const ref = plan.prices[slot]
  return ref.amount === null ? [] : [currency, ...Object.keys(ref.amounts)]
}

/** A plan's prices by slot: Stripe's where it has one, the hand-written amount otherwise. */
export function resolvePlanPrices(plan: PricingPlan, catalog: StripeCatalog | null, options: { currency: string, wanted?: string, checkoutUrl?: string, query?: string }): Partial<Record<PricingInterval, PublicPricingPrice>> {
  const out: Partial<Record<PricingInterval, PublicPricingPrice>> = {}
  const wanted = (options.wanted || '').toLowerCase()
  for (const slot of PRICING_INTERVALS) {
    const ref = plan.prices[slot]
    const stripe = stripePriceFor(plan, slot, catalog, [wanted, options.currency])
    let base: Omit<PublicPricingPrice, 'href' | 'trialDays' | 'monthly'>
    if (stripe) {
      const { amount, currency } = amountIn(stripe, wanted)
      base = { interval: slot, amount, currency, intervalCount: stripe.type === 'one_time' ? 1 : stripe.intervalCount, source: 'stripe', stripePrice: stripe.id, appStoreProduct: ref.appStoreProduct }
    } else if (ref.amount !== null) {
      // A written price in the currency asked for, when one was written; else the table's.
      const other = wanted && wanted !== options.currency && typeof ref.amounts[wanted] === 'number'
      base = { interval: slot, amount: other ? ref.amounts[wanted]! : ref.amount, currency: other ? wanted : options.currency, intervalCount: 1, source: 'manual', stripePrice: '', appStoreProduct: ref.appStoreProduct }
    } else continue
    const link = hrefFor(plan, slot, base, catalog, options.checkoutUrl || '', options.query)
    out[slot] = {
      ...base,
      monthly: slot === 'year' ? roundTo(base.amount / (12 * base.intervalCount), base.currency) : null,
      // One-time prices have no trial.
      trialDays: slot === 'once' ? 0 : link.trialDays ?? plan.trialDays,
      href: link.href
    }
  }
  return out
}

const filled = (cell: PricingCell | undefined) => cell === true || (typeof cell === 'string' && cell !== '')

/** A plan's card list: every included row (and the excluded ones when asked), or, cumulative, what it adds to `previous`. */
export function planLines(plan: Pick<PricingPlan, 'features'>, features: PricingFeature[], options: Pick<PricingOptions, 'cumulative' | 'showExcluded'>, previous?: Pick<PricingPlan, 'features'>): PublicPricingLine[] {
  const lines: PublicPricingLine[] = []
  for (const f of features) {
    if (f.kind === 'heading') continue
    const cell = plan.features[f.id]
    const line = { id: f.id, text: f.text, hint: f.hint, value: typeof cell === 'string' ? cell : '', included: filled(cell) }
    if (options.cumulative && previous) {
      if (line.included && previous.features[f.id] !== cell) lines.push(line)
    } else if (line.included || options.showExcluded) lines.push(line)
  }
  return lines
}

/**
 * What apps receive for a snapshot: the copy in the first of `wanted.locales` the table has,
 * with prices from `catalog` (null: hand-written prices only). `checkoutUrl` is the table's
 * checkout link ('' in the panel's preview, so its buttons go nowhere).
 */
export function buildPublicPricing(input: {
  key: string
  version: number
  publishedAt: string | null
  project: { name: string, logoUrl: string, accent: string }
  snapshot: PricingSnapshot
  catalog: StripeCatalog | null
  wanted?: { locales?: unknown[], currency?: string }
  checkoutUrl?: string
  /** The A/B test this copy was picked for: checkout links carry it, so conversions count for it. */
  experiment?: { table: string, run: string } | null
}): PublicPricingTable {
  const { snapshot, catalog } = input
  // A language added but not yet written has nothing to show: it is not offered.
  const locales = [snapshot.locale, ...Object.entries(snapshot.translations).filter(([, t]) => Object.keys(t).length).map(([tag]) => tag)]
  const locale = matchLocale(input.wanted?.locales || [], locales) || snapshot.locale
  const words = localizePricing(snapshot, snapshot.translations[locale])
  const own = snapshot.options.currency
  // A currency is offered only when every price has it, so a table never mixes two.
  const sets = words.plans.flatMap(plan => PRICING_INTERVALS.map(slot => slotCurrencies(plan, slot, catalog, own)).filter(list => list.length))
  const currencies = sets.length ? [...new Set(sets[0])].filter(code => sets.every(list => list.includes(code))).sort((a, b) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b))) : []
  const asked = String(input.wanted?.currency || '').toLowerCase()
  const wanted = currencies.includes(asked) ? asked : ''
  const query = input.experiment ? `&exp=${encodeURIComponent(input.experiment.table)}&run=${encodeURIComponent(input.experiment.run)}` : ''
  const products = new Map((catalog?.products || []).map(p => [p.id, p]))
  const plans: PublicPricingPlan[] = words.plans.map((plan, index) => {
    const product = plan.stripeProduct ? products.get(plan.stripeProduct) : undefined
    const prices = resolvePlanPrices(plan, catalog, { currency: own, wanted, checkoutUrl: input.checkoutUrl, query })
    const previous = index > 0 ? words.plans[index - 1] : undefined
    const previousName = previous ? (previous.name || (previous.stripeProduct && products.get(previous.stripeProduct)?.name) || '') : ''
    return {
      id: plan.id,
      key: plan.key,
      name: plan.name || product?.name || '',
      description: plan.description || product?.description || '',
      badge: plan.badge,
      highlighted: plan.highlighted,
      customPrice: plan.customPrice,
      priceNote: plan.priceNote,
      unitLabel: product?.unitLabel || '',
      prices,
      savings: pricingSavings(prices.month, prices.year),
      action: { type: plan.action.type, label: plan.action.label, href: plan.action.type === 'url' ? plan.action.url.replace(/\{plan\}/g, encodeURIComponent(plan.key)).replace(/\{interval\}/g, '') || null : null },
      trialDays: plan.trialDays,
      lines: planLines(plan, words.features, snapshot.options, previous),
      includes: snapshot.options.cumulative && previous ? previousName : '',
      cells: Object.fromEntries(words.features.filter(f => f.kind === 'feature').map(f => [f.id, plan.features[f.id] ?? false]))
    }
  })
  const { currency: _currency, ...options } = snapshot.options
  return {
    key: input.key,
    name: words.name,
    locale,
    locales,
    version: input.version,
    publishedAt: input.publishedAt,
    project: { name: input.project.name, logoUrl: input.project.logoUrl },
    template: snapshot.template,
    style: { ...snapshot.style, accent: snapshot.style.accent || input.project.accent },
    options,
    content: words.content,
    intervals: PRICING_INTERVALS.filter(slot => plans.some(p => p.prices[slot])),
    currency: wanted || plans.flatMap(p => Object.values(p.prices)).find(Boolean)?.currency || own,
    currencies: currencies.length > 1 ? currencies : [],
    savings: Math.max(0, ...plans.map(p => p.savings)),
    experiment: input.experiment || null,
    features: words.features,
    plans
  }
}

// ---- A/B tests -----------------------------------------------------------------------

/** A test's settings as sent by an operator, on top of `base`. The variants are other tables' keys, never the control's own. */
export function validatePricingExperiment(value: unknown, controlKey: string, base: PricingExperiment = DEFAULT_PRICING_EXPERIMENT): { experiment: PricingExperiment, errors: string[] } {
  const errors: string[] = []
  const raw = record(value)
  const experiment = { ...base, variants: [...base.variants] }
  const weight = (v: unknown, label: string) => {
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0 || n > 100) { errors.push(`${label} is a whole number from 0 to 100`); return null }
    return n
  }
  if (raw.weight !== undefined) experiment.weight = weight(raw.weight, 'experiment.weight') ?? experiment.weight
  if (raw.variants !== undefined) {
    if (!Array.isArray(raw.variants)) errors.push('experiment.variants must be a list')
    else {
      if (raw.variants.length > PRICING_MAX_VARIANTS) errors.push(`A test has at most ${PRICING_MAX_VARIANTS} variants`)
      const seen = new Set<string>()
      experiment.variants = raw.variants.slice(0, PRICING_MAX_VARIANTS).flatMap((item, i) => {
        const v = record(item)
        const table = typeof v.table === 'string' ? v.table.trim().toLowerCase() : ''
        if (!PRICING_KEY.test(table)) { errors.push(`Variant ${i + 1}: table is the key of another pricing table`); return [] }
        if (table === controlKey) { errors.push(`Variant ${i + 1}: a table cannot be its own variant`); return [] }
        if (seen.has(table)) { errors.push(`Variant ${i + 1}: "${table}" is already a variant`); return [] }
        seen.add(table)
        return [{ table, weight: weight(v.weight ?? 50, `Variant ${i + 1}: weight`) ?? 50 }]
      })
    }
  }
  if (experiment.weight + experiment.variants.reduce((sum, v) => sum + v.weight, 0) <= 0) errors.push('At least one table needs a weight above 0')
  return { experiment, errors }
}

export function pricingExperimentOf(value: unknown): PricingExperiment {
  const raw = record(value)
  const status = raw.status === 'running' || raw.status === 'ended' ? raw.status : 'off'
  return {
    status,
    runId: String(raw.runId || ''),
    weight: typeof raw.weight === 'number' ? raw.weight : DEFAULT_PRICING_EXPERIMENT.weight,
    variants: Array.isArray(raw.variants) ? raw.variants.map(v => ({ table: String(record(v).table || ''), weight: Number(record(v).weight) || 0 })).filter(v => v.table) : [],
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    endedAt: typeof raw.endedAt === 'string' ? raw.endedAt : null
  }
}

/** FNV-1a: a quick, stable 32-bit hash, the same in every client. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/**
 * The table a visitor sees while a test runs: the same one every time for the same visitor and
 * run, split by weight. Without a visitor id the split is random per request. `available` are
 * the variants that are published right now; one that is not gets no visitors.
 */
export function pickPricingArm(experiment: PricingExperiment, controlKey: string, visitor: string, available: string[], random = Math.random): string {
  const arms = [{ table: controlKey, weight: experiment.weight }, ...experiment.variants.filter(v => available.includes(v.table))].filter(a => a.weight > 0)
  const total = arms.reduce((sum, a) => sum + a.weight, 0)
  if (!total) return controlKey
  const point = visitor ? (fnv1a(`${experiment.runId}:${visitor}`) % 10_000) / 10_000 * total : random() * total
  let at = 0
  for (const arm of arms) {
    at += arm.weight
    if (point < at) return arm.table
  }
  return arms.at(-1)!.table
}

// ---- numbers -------------------------------------------------------------------------

/** What a table did over a stretch of days: its funnel, by plan, and its revenue by currency (smallest unit). */
export type PricingFunnel = {
  views: number
  visitors: number
  clicks: number
  checkouts: number
  conversions: number
  revenue: Record<string, number>
  plans: Record<string, { clicks: number, checkouts: number, conversions: number }>
}

export const emptyFunnel = (): PricingFunnel => ({ views: 0, visitors: 0, clicks: 0, checkouts: 0, conversions: 0, revenue: {}, plans: {} })

/** Adds `b` into `a`. */
export function addFunnel(a: PricingFunnel, b: Partial<PricingFunnel>): PricingFunnel {
  for (const key of ['views', 'visitors', 'clicks', 'checkouts', 'conversions'] as const) a[key] += Number(b[key]) || 0
  for (const [currency, amount] of Object.entries(b.revenue || {})) a.revenue[currency] = (a.revenue[currency] || 0) + (Number(amount) || 0)
  for (const [plan, counts] of Object.entries(b.plans || {})) {
    const into = (a.plans[plan] ||= { clicks: 0, checkouts: 0, conversions: 0 })
    into.clicks += Number(counts?.clicks) || 0
    into.checkouts += Number(counts?.checkouts) || 0
    into.conversions += Number(counts?.conversions) || 0
  }
  return a
}

/** The standard normal distribution's cumulative probability (Zelen and Severo's approximation, good to 1e-7). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp(-z * z / 2)
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z > 0 ? 1 - p : p
}

/**
 * A variant against the control: its conversion rate (conversions per visitor), the lift over the
 * control's, and how sure a two-proportion z-test is that the two differ (0 to 1). `enough` is
 * false until both have 100 visitors and 5 conversions between them, when a verdict means little.
 */
export function compareConversion(control: Pick<PricingFunnel, 'visitors' | 'conversions'>, variant: Pick<PricingFunnel, 'visitors' | 'conversions'>): { rate: number, lift: number | null, confidence: number, enough: boolean } {
  const rate = variant.visitors ? variant.conversions / variant.visitors : 0
  const base = control.visitors ? control.conversions / control.visitors : 0
  const lift = base > 0 ? (rate - base) / base : null
  const enough = control.visitors >= 100 && variant.visitors >= 100 && control.conversions + variant.conversions >= 5
  const pooled = control.visitors + variant.visitors ? (control.conversions + variant.conversions) / (control.visitors + variant.visitors) : 0
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(1, control.visitors) + 1 / Math.max(1, variant.visitors)))
  const z = se > 0 ? (rate - base) / se : 0
  return { rate, lift, confidence: se > 0 ? Math.max(0, 2 * normalCdf(Math.abs(z)) - 1) : 0, enough }
}

/** The Stripe entries a snapshot uses, kept with each published version so it still shows prices while Stripe cannot be reached. */
export function catalogSubset(snapshot: Pick<PricingSnapshot, 'plans'>, catalog: StripeCatalog | null): StripeCatalog | null {
  if (!catalog) return null
  const products = new Set(snapshot.plans.map(p => p.stripeProduct).filter(Boolean))
  const named = new Set(snapshot.plans.flatMap(p => PRICING_INTERVALS.map(slot => p.prices[slot].stripePrice)).filter(Boolean))
  const prices = catalog.prices.filter(p => products.has(p.product) || named.has(p.id))
  const ids = new Set(prices.map(p => p.id))
  return {
    products: catalog.products.filter(p => products.has(p.id) || prices.some(price => price.product === p.id)),
    prices,
    links: catalog.links.filter(l => l.prices.some(id => ids.has(id))),
    fetchedAt: catalog.fetchedAt
  }
}
