import { createError } from 'h3'
import { normalizeEmail, type ContactInput } from '#shared/contacts'
import {
  PAYING_STATUSES, REVENUE_RANGES, STRIPE_ATTR, fromMinor, monthlyMinor, rollupAttributes,
  type RevenueRange, type RevenueReport, type StripeConnection, type StripeCustomerDto, type StripePaymentDto, type StripeSubscriptionDto, type StripeSubscriptionStatus
} from '#shared/stripe'
import { contactQuery, upsertContacts } from './contacts'
import { MASTER, iso, useParse, type ParseObject } from './parse'
import { runExclusive, useRedis } from './redis'
import { readCredential, storeCredential } from './secrets'
import { workspaceIsActive } from './tenancy'
import { projectWorkspaceId } from './usage'

// Stripe, read only. A restricted key (read access to Charges, Customers,
// Subscriptions and Products) is sealed on a StripeAccount row — one per
// project — and the worker copies the account's charges and subscriptions into
// StripePayment / StripeSubscription rows. Those feed the Revenue tab, the
// contact's billing section, and the `stripe_*` attributes written onto each
// customer's contact (shared/stripe.ts). Nothing here writes to Stripe; the one
// write HelpBites ever makes is a pricing table's Checkout Session
// (server/utils/pricing.ts), and only with a key the operator gave that right.
//
// A run walks charges newest first from the cursor, then re-reads every
// subscription, then refreshes the contacts of the customers it touched.
// Later runs only look at charges from the last REFRESH_DAYS, which is how
// refunds on recent charges are picked up; "Sync everything" starts over.

const API = 'https://api.stripe.com/v1'
const EVERY_MINUTES = 60
const REFRESH_DAYS = 35
const RUN_BUDGET_MS = 25_000
const DAY = 86_400

type Cursor = { since: number, after?: string, startedAt?: number }
type Customers = Map<string, { email: string, name: string }>

export async function stripeGet(key: string, path: string, params: Record<string, string> = {}): Promise<any> {
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: `Stripe answered ${res.status}: ${String(body?.error?.message || res.statusText).slice(0, 200)}` })
  return body
}

/** Every page of a Stripe list, newest first, starting after `after`. */
async function* pages(key: string, path: string, params: Record<string, string> = {}, after = ''): AsyncGenerator<any[]> {
  for (;;) {
    const body = await stripeGet(key, path, { ...params, limit: '100', ...(after ? { starting_after: after } : {}) })
    const data = (body.data || []) as any[]
    if (data.length) yield data
    if (!body.has_more || !data.length) return
    after = data.at(-1).id
  }
}

/** Every item of a Stripe list, up to `max`. */
export async function stripeListAll(key: string, path: string, params: Record<string, string> = {}, max = 1000): Promise<any[]> {
  const out: any[] = []
  for await (const page of pages(key, path, params)) {
    out.push(...page)
    if (out.length >= max) break
  }
  return out.slice(0, max)
}

function customerOf(raw: unknown): { id: string, email: string, name: string } {
  if (typeof raw === 'string') return { id: raw, email: '', name: '' }
  const c = (raw || {}) as { id?: string, email?: string, name?: string }
  return { id: String(c.id || ''), email: normalizeEmail(c.email), name: String(c.name || '') }
}

// ---- connecting ----------------------------------------------------------------

/** Where pricing tables keep the project's products and prices (server/utils/pricing.ts); a new key starts it over. */
export const pricingCatalogKey = (projectId: string) => `sb:pricing:catalog:${projectId}`

export function serializeStripeAccount(row: ParseObject | null): StripeConnection {
  const stats = (row?.get('stats') || {}) as Partial<StripeConnection['stats']>
  return {
    connected: Boolean(row),
    accountName: String(row?.get('accountName') || ''),
    currency: String(row?.get('currency') || ''),
    livemode: row?.get('livemode') === true,
    status: row?.get('status') || 'idle',
    lastRunAt: iso(row?.get('lastRunAt')),
    lastError: String(row?.get('lastError') || ''),
    stats: { payments: 0, subscriptions: 0, contacts: 0, ...stats }
  }
}

export async function findStripeAccount(project: ParseObject): Promise<ParseObject | null> {
  return (await new (useParse()).Query('StripeAccount').equalTo('project', project).first(MASTER)) || null
}

export async function requireStripeAccount(project: ParseObject): Promise<ParseObject> {
  const row = await findStripeAccount(project)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Stripe is not connected to this project' })
  return row
}

/** Checks the key can read what the sync needs, then stores it sealed (replacing any earlier key). */
export async function connectStripe(project: ParseObject, apiKey: unknown): Promise<ParseObject> {
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]{10,}$/.test(key)) throw createError({ statusCode: 400, statusMessage: 'Paste a Stripe restricted key (rk_live_… or rk_test_…) with read access' })
  const sealed = storeCredential(key)
  await stripeGet(key, '/charges', { limit: '1' })
  await stripeGet(key, '/subscriptions', { limit: '1', status: 'all' })
  // The account's name is nice to show; a key without access to it still works.
  const account = await stripeGet(key, '/account').catch(() => ({}))

  const row = (await findStripeAccount(project)) || new (useParse().Object.extend('StripeAccount'))() as ParseObject
  const replaced = !row.isNew()
  row.set('project', project)
  row.set('projectId', project.id)
  row.set('secretSealed', sealed)
  row.set('livemode', key.includes('_live_'))
  row.set('accountName', String(account?.settings?.dashboard?.display_name || account?.business_profile?.name || account?.email || ''))
  row.set('enabled', true)
  row.set('status', 'idle')
  row.set('lastError', '')
  row.set('nextRunAt', new Date())
  if (!replaced) { row.set('cursor', { since: 0 }); row.set('stats', {}) }
  await row.save(null, MASTER)
  await useRedis().del(pricingCatalogKey(project.id || '')).catch(() => {})
  return row
}

/** Forgets the key and everything synced from Stripe. Contacts keep their `stripe_*` attributes. */
export async function disconnectStripe(project: ParseObject): Promise<void> {
  const Parse = useParse()
  await (await findStripeAccount(project))?.destroy(MASTER)
  await useRedis().del(pricingCatalogKey(project.id || '')).catch(() => {})
  for (const className of ['StripePayment', 'StripeSubscription']) {
    for (;;) {
      const rows = await new Parse.Query(className).equalTo('projectId', project.id).limit(1000).find(MASTER)
      if (!rows.length) break
      await Parse.Object.destroyAll(rows, MASTER)
    }
  }
}

// ---- syncing -------------------------------------------------------------------

async function saveRows(className: string, projectId: string, items: (Record<string, unknown> & { stripeId: string })[]) {
  if (!items.length) return
  const Parse = useParse()
  const project = Parse.Object.extend('Project').createWithoutData(projectId)
  const existing = await new Parse.Query(className).equalTo('projectId', projectId).containedIn('stripeId', items.map(i => i.stripeId)).limit(items.length).find(MASTER)
  const byId = new Map(existing.map(row => [String(row.get('stripeId')), row]))
  const rows = items.map((item) => {
    const row = byId.get(item.stripeId) || new (Parse.Object.extend(className))() as ParseObject
    row.set({ ...item, project, projectId })
    return row
  })
  await Parse.Object.saveAll(rows, { ...MASTER, batchSize: 50 })
}

const monthOf = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 7)

export function chargeRow(charge: any) {
  const customer = customerOf(charge.customer)
  const succeeded = charge.status === 'succeeded'
  return {
    stripeId: String(charge.id),
    customerId: customer.id,
    email: customer.email || normalizeEmail(charge.billing_details?.email) || normalizeEmail(charge.receipt_email),
    status: String(charge.status || ''),
    currency: String(charge.currency || '').toLowerCase(),
    amount: Number(charge.amount) || 0,
    refunded: Number(charge.amount_refunded) || 0,
    // What stays: summed by the reports, so a refunded or failed charge adds nothing.
    net: succeeded ? Math.max(0, (Number(charge.amount) || 0) - (Number(charge.amount_refunded) || 0)) : 0,
    paidAtSec: Number(charge.created) || 0,
    month: monthOf(Number(charge.created) || 0),
    description: String(charge.description || '').slice(0, 200),
    receiptUrl: String(charge.receipt_url || ''),
    invoiceId: String(charge.invoice || '')
  }
}

export function subscriptionRow(sub: any, products: Map<string, string>) {
  const customer = customerOf(sub.customer)
  const items = (sub.items?.data || []) as any[]
  const price = items[0]?.price
  const product = typeof price?.product === 'string' ? price.product : price?.product?.id
  const status = String(sub.status || '')
  return {
    stripeId: String(sub.id),
    customerId: customer.id,
    email: customer.email,
    status,
    plan: (typeof price?.product === 'object' ? price.product.name : products.get(product)) || price?.nickname || 'Subscription',
    currency: String(sub.currency || price?.currency || '').toLowerCase(),
    amount: items.reduce((sum, item) => sum + (item.price?.unit_amount || 0) * (item.quantity ?? 1), 0),
    interval: String(price?.recurring?.interval || ''),
    intervalCount: Number(price?.recurring?.interval_count) || 1,
    // Counted once it pays: a trial or a lapsed subscription is not recurring revenue yet.
    mrr: PAYING_STATUSES.includes(status as StripeSubscriptionStatus) ? monthlyMinor(items) : 0,
    startedAtSec: Number(sub.start_date || sub.created) || 0,
    canceledAtSec: Number(sub.canceled_at) || 0,
    currentPeriodEndSec: Number(sub.current_period_end ?? items[0]?.current_period_end) || 0,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    // For MRR by month: its list price a month, paid from the end of any trial until the month it ended ('' while it runs).
    monthly: monthlyMinor(items),
    paidFromMonth: monthOf(Math.max(Number(sub.start_date || sub.created) || 0, Number(sub.trial_end) || 0)),
    endedMonth: sub.ended_at ? monthOf(Number(sub.ended_at)) : ''
  }
}

async function productNames(key: string): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  try {
    for await (const page of pages(key, '/products')) for (const p of page) names.set(p.id, String(p.name || ''))
  } catch { /* a key without Products access falls back to price nicknames */ }
  return names
}

const aggregate = (className: string, pipeline: Record<string, unknown>[]) =>
  new (useParse()).Query(className).aggregate(pipeline, MASTER) as Promise<Record<string, any>[]>

/** The currency with the most revenue: every total in the panel is in this one. */
async function primaryCurrency(projectId: string): Promise<string> {
  const rows = await aggregate('StripePayment', [{ $match: { projectId, status: 'succeeded' } }, { $group: { _id: '$currency', net: { $sum: '$net' } } }, { $sort: { net: -1 } }, { $limit: 1 }])
  return String(rows[0]?.objectId || '')
}

/** Writes each touched customer's totals onto their contact, creating contacts for paying customers nobody knew. */
async function linkCustomers(project: ParseObject, currency: string, customers: Customers): Promise<number> {
  const projectId = project.id || ''
  const ids = [...customers.keys()]
  const Parse = useParse()
  let linked = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const [totals, subs, known] = await Promise.all([
      aggregate('StripePayment', [{ $match: { projectId, status: 'succeeded', currency, customerId: { $in: chunk } } }, { $group: { _id: '$customerId', net: { $sum: '$net' }, count: { $sum: 1 }, last: { $max: '$paidAtSec' } } }]),
      new Parse.Query('StripeSubscription').equalTo('projectId', projectId).containedIn('customerId', chunk).limit(1000).find(MASTER),
      contactQuery(project, { [`attributes.${STRIPE_ATTR.customer}`]: { $in: chunk } }).limit(1000).find(MASTER)
    ])
    const totalOf = new Map(totals.map(t => [String(t.objectId), t]))
    const contactOf = new Map(known.map(c => [String((c.get('attributes') as Record<string, unknown>)[STRIPE_ATTR.customer]), c]))
    const inputs: ContactInput[] = []
    for (const id of chunk) {
      const customer = customers.get(id)!
      const contact = contactOf.get(id)
      const who: ContactInput = contact
        ? { externalId: String(contact.get('externalId') || '') || undefined, email: String(contact.get('email') || '') || undefined }
        : { email: customer.email || undefined, name: customer.name || undefined }
      if (!who.externalId && !who.email) continue
      const total = totalOf.get(id)
      const mine = subs.filter(s => s.get('customerId') === id).map(s => ({ status: String(s.get('status')), plan: String(s.get('plan')), mrr: s.get('currency') === currency ? Number(s.get('mrr')) || 0 : 0 }))
      inputs.push({ ...who, attributes: rollupAttributes(id, { net: Number(total?.net) || 0, count: Number(total?.count) || 0, lastAt: Number(total?.last) || null }, mine, currency) })
    }
    if (inputs.length) await upsertContacts(project, inputs, { via: 'stripe' })
    linked += inputs.length
  }
  return linked
}

/** One run for up to RUN_BUDGET_MS; the worker continues it on the next tick when there is more. */
export async function runStripeSync(accountId: string, options: { reset?: boolean, budgetMs?: number } = {}): Promise<{ ran: boolean }> {
  const result = await runExclusive(`sb:stripe:${accountId}`, 900, async () => {
    const row = await new (useParse()).Query('StripeAccount').include('project').get(accountId, MASTER)
    const project = row.get('project') as ParseObject
    const projectId = project.id || ''
    if (!(await workspaceIsActive(await projectWorkspaceId(project)))) {
      row.set('nextRunAt', new Date(Date.now() + 60 * 60_000))
      await row.save(null, MASTER)
      return
    }
    const stats = { payments: 0, subscriptions: 0, contacts: 0, ...(options.reset ? {} : row.get('stats') || {}) }
    let cursor: Cursor = options.reset ? { since: 0 } : { since: 0, ...(row.get('cursor') || {}) }
    const startedAt = cursor.startedAt ?? Math.floor(Date.now() / 1000)
    const deadline = Date.now() + (options.budgetMs ?? RUN_BUDGET_MS)
    const touched: Customers = new Map()
    const touch = (c: { id: string, email: string, name: string }) => { if (c.id) touched.set(c.id, { email: c.email, name: c.name }) }
    row.set('status', 'running')
    await row.save(null, MASTER)

    try {
      const key = readCredential(String(row.get('secretSealed') || ''))
      let done = true
      const params: Record<string, string> = { 'expand[]': 'data.customer', ...(cursor.since ? { 'created[gte]': String(cursor.since) } : {}) }
      for await (const page of pages(key, '/charges', params, cursor.after)) {
        await saveRows('StripePayment', projectId, page.map(chargeRow))
        stats.payments += page.length
        for (const charge of page) touch(customerOf(charge.customer))
        cursor = { ...cursor, startedAt, after: page.at(-1).id }
        row.set('cursor', cursor)
        row.set('stats', stats)
        await row.save(null, MASTER)
        if (Date.now() > deadline) { done = false; break }
      }
      if (done) {
        const products = await productNames(key)
        stats.subscriptions = 0
        for await (const page of pages(key, '/subscriptions', { status: 'all', 'expand[]': 'data.customer' })) {
          await saveRows('StripeSubscription', projectId, page.map(sub => subscriptionRow(sub, products)))
          stats.subscriptions += page.length
          for (const sub of page) touch(customerOf(sub.customer))
        }
        cursor = { since: Math.max(0, startedAt - REFRESH_DAYS * DAY) }
      }
      const currency = await primaryCurrency(projectId)
      if (currency) {
        row.set('currency', currency)
        stats.contacts += await linkCustomers(project, currency, touched)
      }
      row.set('cursor', cursor)
      row.set('stats', stats)
      row.set('status', 'idle')
      row.set('lastError', '')
      row.set('lastRunAt', new Date())
      row.set('nextRunAt', new Date(done ? Date.now() + EVERY_MINUTES * 60_000 : Date.now()))
    } catch (error) {
      row.set('status', 'error')
      row.set('lastError', String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Sync failed').slice(0, 500))
      row.set('lastRunAt', new Date())
      row.set('nextRunAt', new Date(Date.now() + EVERY_MINUTES * 60_000))
      console.warn(`[stripe] ${accountId} failed:`, row.get('lastError'))
    }
    await row.save(null, MASTER)
  })
  return { ran: result.ran }
}

/** Accounts whose turn it is, oldest first. */
export async function dueStripeAccounts(limit = 3): Promise<string[]> {
  const rows = await new (useParse()).Query('StripeAccount').notEqualTo('enabled', false).lessThanOrEqualTo('nextRunAt', new Date()).ascending('nextRunAt').limit(limit).select('objectId').find(MASTER)
  return rows.map(r => r.id || '')
}

// ---- reading -------------------------------------------------------------------

const seconds = (value: unknown) => (Number(value) > 0 ? new Date(Number(value) * 1000).toISOString() : null)

export function serializePayment(row: ParseObject): StripePaymentDto {
  return {
    id: String(row.get('stripeId')), customerId: String(row.get('customerId') || ''), email: String(row.get('email') || ''),
    amount: Number(row.get('amount')) || 0, refunded: Number(row.get('refunded')) || 0, currency: String(row.get('currency') || ''),
    status: String(row.get('status') || ''), description: String(row.get('description') || ''), receiptUrl: String(row.get('receiptUrl') || ''),
    paidAt: seconds(row.get('paidAtSec')) || ''
  }
}

export function serializeSubscription(row: ParseObject): StripeSubscriptionDto {
  return {
    id: String(row.get('stripeId')), customerId: String(row.get('customerId') || ''), email: String(row.get('email') || ''),
    status: row.get('status'), plan: String(row.get('plan') || ''), mrr: Number(row.get('mrr')) || 0, amount: Number(row.get('amount')) || 0,
    interval: String(row.get('interval') || ''), intervalCount: Number(row.get('intervalCount')) || 1, currency: String(row.get('currency') || ''),
    startedAt: seconds(row.get('startedAtSec')), canceledAt: seconds(row.get('canceledAtSec')),
    currentPeriodEnd: seconds(row.get('currentPeriodEndSec')), cancelAtPeriodEnd: row.get('cancelAtPeriodEnd') === true
  }
}

/** The last 12 calendar months (UTC) up to and including this one, oldest first. */
export function lastMonths(now: Date, count = 12): string[] {
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1)).toISOString().slice(0, 7))
}

type PaidSpan = { from: string, to?: string, mrr: number, monthly: number }

/**
 * MRR at the end of each month (this month: today), from subscriptions summed by the month they
 * started paying and the month they ended. A running one counts at today's MRR, an ended one at
 * its price until the month it ended.
 */
// ponytail: plan changes, coupons and pauses are not replayed; Stripe invoices would give the exact history.
export function mrrByMonth(months: string[], spans: PaidSpan[]): number[] {
  return months.map(month => spans.reduce((sum, s) => sum + (s.from > month ? 0 : !s.to ? s.mrr : s.to > month ? s.monthly : 0), 0))
}

export async function revenueReport(project: ParseObject, account: ParseObject, range: RevenueRange): Promise<RevenueReport> {
  const projectId = project.id || ''
  const currency = String(account.get('currency') || '')
  const days = REVENUE_RANGES.find(r => r.value === range)?.days || 0
  const now = new Date()
  const since = days ? Math.floor(now.getTime() / 1000) - days * DAY : 0
  const months = lastMonths(now)
  const paid = { projectId, status: 'succeeded', currency }
  const Parse = useParse()
  const [period, payers, allTime, monthly, currencies, top, bySubStatus, plans, started, canceled, recent, spans] = await Promise.all([
    aggregate('StripePayment', [{ $match: { ...paid, paidAtSec: { $gte: since } } }, { $group: { _id: '$projectId', gross: { $sum: '$amount' }, refunds: { $sum: '$refunded' }, payments: { $sum: 1 } } }]),
    aggregate('StripePayment', [{ $match: { ...paid, paidAtSec: { $gte: since }, net: { $gt: 0 } } }, { $group: { _id: '$customerId', p: { $first: '$projectId' } } }, { $group: { _id: '$p', n: { $sum: 1 } } }]),
    aggregate('StripePayment', [{ $match: paid }, { $group: { _id: '$projectId', net: { $sum: '$net' } } }]),
    aggregate('StripePayment', [{ $match: { ...paid, month: { $gte: months[0] } } }, { $group: { _id: '$month', net: { $sum: '$net' }, payments: { $sum: 1 } } }]),
    aggregate('StripePayment', [{ $match: { projectId, status: 'succeeded' } }, { $group: { _id: '$currency', net: { $sum: '$net' } } }]),
    aggregate('StripePayment', [{ $match: { ...paid, customerId: { $ne: '' } } }, { $group: { _id: '$customerId', net: { $sum: '$net' }, payments: { $sum: 1 }, email: { $max: '$email' } } }, { $sort: { net: -1 } }, { $limit: 10 }]),
    aggregate('StripeSubscription', [{ $match: { projectId, currency, status: { $in: ['active', 'trialing', 'past_due'] } } }, { $group: { _id: '$status', mrr: { $sum: '$mrr' }, n: { $sum: 1 } } }]),
    aggregate('StripeSubscription', [{ $match: { projectId, currency, status: { $in: PAYING_STATUSES } } }, { $group: { _id: '$plan', mrr: { $sum: '$mrr' }, n: { $sum: 1 } } }, { $sort: { mrr: -1 } }, { $limit: 10 }]),
    new Parse.Query('StripeSubscription').equalTo('projectId', projectId).greaterThanOrEqualTo('startedAtSec', since).count(MASTER),
    new Parse.Query('StripeSubscription').equalTo('projectId', projectId).greaterThanOrEqualTo('canceledAtSec', Math.max(since, 1)).count(MASTER),
    new Parse.Query('StripePayment').equalTo('projectId', projectId).descending('paidAtSec').limit(10).find(MASTER),
    aggregate('StripeSubscription', [{ $match: { projectId, currency, paidFromMonth: { $gt: '' } } }, { $group: { _id: { from: '$paidFromMonth', to: '$endedMonth' }, mrr: { $sum: '$mrr' }, monthly: { $sum: '$monthly' } } }])
  ])
  const gross = fromMinor(Number(period[0]?.gross) || 0, currency)
  const refunds = fromMinor(Number(period[0]?.refunds) || 0, currency)
  const sub = (status: string) => bySubStatus.find(r => r.objectId === status)
  const mrr = fromMinor((Number(sub('active')?.mrr) || 0) + (Number(sub('past_due')?.mrr) || 0), currency)
  const byMonth = new Map(monthly.map(m => [String(m.objectId), m]))
  const mrrs = mrrByMonth(months, spans.map(s => ({ ...s.objectId, mrr: Number(s.mrr) || 0, monthly: Number(s.monthly) || 0 })))
  return {
    currency, range, gross, refunds, net: Math.round((gross - refunds) * 100) / 100,
    payments: Number(period[0]?.payments) || 0,
    customers: Number(payers[0]?.n) || 0,
    allTimeNet: fromMinor(Number(allTime[0]?.net) || 0, currency),
    mrr, arr: Math.round(mrr * 12 * 100) / 100,
    subscribers: { active: Number(sub('active')?.n) || 0, trialing: Number(sub('trialing')?.n) || 0, pastDue: Number(sub('past_due')?.n) || 0 },
    newSubscribers: started, churned: canceled,
    months: months.map((month, i) => ({ month, net: fromMinor(Number(byMonth.get(month)?.net) || 0, currency), payments: Number(byMonth.get(month)?.payments) || 0, mrr: fromMinor(mrrs[i] || 0, currency) })),
    plans: plans.map(p => ({ plan: String(p.objectId || 'Subscription'), subscribers: Number(p.n) || 0, mrr: fromMinor(Number(p.mrr) || 0, currency) })),
    topCustomers: top.map(t => ({ customerId: String(t.objectId), email: String(t.email || ''), net: fromMinor(Number(t.net) || 0, currency), payments: Number(t.payments) || 0 })),
    recent: recent.map(serializePayment),
    otherCurrencies: currencies.filter(c => c.objectId !== currency && Number(c.net) > 0).map(c => ({ currency: String(c.objectId), net: fromMinor(Number(c.net), String(c.objectId)) }))
  }
}

export function customerDto(raw: any): StripeCustomerDto | null {
  if (!raw?.id || raw.deleted) return null
  return {
    id: String(raw.id), name: String(raw.name || ''), email: normalizeEmail(raw.email), createdAt: seconds(raw.created),
    country: String(raw.address?.country || ''), delinquent: raw.delinquent === true,
    balance: Number(raw.balance) || 0, currency: String(raw.currency || '').toLowerCase(), livemode: raw.livemode === true
  }
}

/** The contact's Stripe customer, read live: by their linked id, else the newest customer with their email. */
async function liveCustomer(account: ParseObject, customerId: string, email: string): Promise<StripeCustomerDto | null> {
  const key = readCredential(String(account.get('secretSealed') || ''))
  // ponytail: Stripe's email filter is case-sensitive, so a customer saved as Ada@X.io is not found for ada@x.io until a sync links them.
  const raw = customerId ? await stripeGet(key, `/customers/${encodeURIComponent(customerId)}`) : (await stripeGet(key, '/customers', { email, limit: '1' })).data?.[0]
  return customerDto(raw)
}

/**
 * One contact's Stripe customer (read live, so someone who exists in Stripe shows up before the
 * next sync) and their synced subscriptions and payments, found by their Stripe customer id or,
 * failing that, their email. A Stripe error leaves `customer` null and the synced rows as they are.
 */
export async function contactBilling(project: ParseObject, account: ParseObject, contact: ParseObject): Promise<{ customer: StripeCustomerDto | null, subscriptions: StripeSubscriptionDto[], payments: StripePaymentDto[] }> {
  const Parse = useParse()
  const customerId = String(((contact.get('attributes') || {}) as Record<string, unknown>)[STRIPE_ATTR.customer] || '')
  const email = String(contact.get('email') || '')
  if (!customerId && !email) return { customer: null, subscriptions: [], payments: [] }
  const scoped = (className: string) => {
    const query = new Parse.Query(className).equalTo('projectId', project.id)
    return customerId ? query.equalTo('customerId', customerId) : query.equalTo('email', email)
  }
  const [customer, subs, payments] = await Promise.all([
    liveCustomer(account, customerId, email).catch(() => null),
    scoped('StripeSubscription').descending('startedAtSec').limit(50).find(MASTER),
    scoped('StripePayment').descending('paidAtSec').limit(50).find(MASTER)
  ])
  return { customer, subscriptions: subs.map(serializeSubscription), payments: payments.map(serializePayment) }
}
