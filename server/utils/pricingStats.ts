import { PRICING_INTERVALS, addFunnel, compareConversion, emptyFunnel, pricingExperimentOf, pricingPlansOf, stripePriceFor, type PricingFunnel, type StripeCatalog } from '#shared/pricing'
import { MASTER, pointerId, useParse, type ParseObject } from './parse'
import { runExclusive, useRedis } from './redis'
import { readCredential } from './secrets'
import { stripeListAll } from './stripe'

// A pricing table's numbers: views, unique visitors and clicks (sent by pricing.js
// and the Swift snippet), checkouts (counted when HelpBites' checkout link is
// followed) and conversions with their revenue (read back from Stripe: completed
// Checkout Sessions the table started, or that came through a Payment Link it shows).
// Counting is cheap and never fails a request: it goes to Redis, and a worker
// moves it into one PricingStat row per table, A/B test run and day. Unique
// visitors are a HyperLogLog per row, so they are an estimate within about 1%.

const DIRTY = 'sb:pricing:dirty'
const KEEP_SECONDS = 40 * 86_400
const COUNTED_SECONDS = 4 * 86_400
// Checkout Sessions last a day at most, so two days back finds every one that completed since the last look.
const LOOK_BACK_SECONDS = 2 * 86_400
const POLL_EVERY_SECONDS = 10 * 60
const METRICS = ['views', 'clicks', 'checkouts', 'conversions'] as const
type Metric = (typeof METRICS)[number]

const today = () => new Date().toISOString().slice(0, 10)
const member = (projectId: string, tableId: string, run: string, day: string) => `${projectId}:${tableId}:${run || '-'}:${day}`
const hitsKey = (m: string) => `sb:pricing:hits:${m}`
const visitorsKey = (m: string) => `sb:pricing:uv:${m}`

/**
 * Adds to a table's numbers for today (or `day`), under the A/B test run that showed it ('' for
 * none). `plan` also counts the plan's own; `visitor` is added to the day's unique visitors.
 */
export async function countPricing(projectId: string, tableId: string, run: string, counts: Partial<Record<Metric, number>>, extra: { plan?: string, visitor?: string, revenue?: { currency: string, amount: number }, day?: string } = {}): Promise<void> {
  if (!projectId || !tableId) return
  try {
    const m = member(projectId, tableId, run, extra.day || today())
    const multi = useRedis().multi()
    for (const [metric, n] of Object.entries(counts)) {
      if (!n) continue
      multi.hincrby(hitsKey(m), metric, n)
      if (extra.plan && metric !== 'views') multi.hincrby(hitsKey(m), `p:${extra.plan}:${metric}`, n)
    }
    if (extra.revenue && extra.revenue.amount > 0 && /^[a-z]{3}$/.test(extra.revenue.currency)) multi.hincrby(hitsKey(m), `r:${extra.revenue.currency}`, Math.round(extra.revenue.amount))
    if (extra.visitor) multi.pfadd(visitorsKey(m), extra.visitor)
    multi.expire(hitsKey(m), KEEP_SECONDS)
    multi.expire(visitorsKey(m), KEEP_SECONDS)
    multi.sadd(DIRTY, m)
    await multi.exec()
  } catch (error) {
    console.warn('[pricing] not counted:', (error as Error).message)
  }
}

/** Redis fields as a funnel's increments. */
export function funnelOfHits(hits: Record<string, string>): PricingFunnel {
  const out = emptyFunnel()
  for (const [field, raw] of Object.entries(hits)) {
    const n = Number(raw) || 0
    if ((METRICS as readonly string[]).includes(field)) out[field as Metric] += n
    else if (field.startsWith('r:')) out.revenue[field.slice(2)] = (out.revenue[field.slice(2)] || 0) + n
    else if (field.startsWith('p:')) {
      const [, plan = '', metric = ''] = field.split(':')
      if (plan && (metric === 'clicks' || metric === 'checkouts' || metric === 'conversions')) addFunnel(out, { plans: { [plan]: { clicks: 0, checkouts: 0, conversions: 0, [metric]: n } } })
    }
  }
  return out
}

function funnelOfRow(row: ParseObject): PricingFunnel {
  return addFunnel(emptyFunnel(), {
    views: row.get('views'), visitors: row.get('visitors'), clicks: row.get('clicks'), checkouts: row.get('checkouts'), conversions: row.get('conversions'),
    revenue: row.get('revenue') || {}, plans: row.get('plans') || {}
  })
}

/** Moves counts from Redis into PricingStat rows. Each row is written by one process at a time; a failed write goes back to be tried again. */
export async function flushPricingStats(max = 500): Promise<number> {
  const redis = useRedis()
  const members = await redis.spop(DIRTY, max) as string[]
  let written = 0
  for (const m of members) {
    const [projectId = '', tableId = '', run = '-', day = ''] = m.split(':')
    const done = await runExclusive(`sb:pricing:flush:${m}`, 60, async () => {
      const temp = `${hitsKey(m)}:flushing`
      let hits: Record<string, string> = {}
      // Renamed first, so what is counted while this runs lands in a fresh key and is not lost.
      if (await redis.exists(hitsKey(m))) {
        await redis.rename(hitsKey(m), temp)
        hits = await redis.hgetall(temp)
      }
      const visitors = await redis.pfcount(visitorsKey(m))
      try {
        const Parse = useParse()
        const query = new Parse.Query('PricingStat').equalTo('tableId', tableId).equalTo('run', run === '-' ? '' : run).equalTo('day', day)
        const row = (await query.first(MASTER)) || new (Parse.Object.extend('PricingStat'))() as ParseObject
        const total = addFunnel(row.isNew() ? emptyFunnel() : funnelOfRow(row), funnelOfHits(hits))
        row.set({
          project: Parse.Object.extend('Project').createWithoutData(projectId), projectId,
          table: Parse.Object.extend('PricingTable').createWithoutData(tableId), tableId,
          run: run === '-' ? '' : run, day,
          views: total.views, clicks: total.clicks, checkouts: total.checkouts, conversions: total.conversions,
          // An estimate that only grows within a day; Redis forgetting it never lowers what was saved.
          visitors: Math.max(Number(row.get('visitors')) || 0, visitors),
          revenue: total.revenue, plans: total.plans
        })
        await row.save(null, MASTER)
        await redis.del(temp)
        written++
      } catch (error) {
        for (const [field, value] of Object.entries(hits)) await redis.hincrby(hitsKey(m), field, Number(value) || 0)
        await redis.del(temp)
        await redis.sadd(DIRTY, m)
        console.warn('[pricing] stats not saved:', (error as Error).message)
      }
    }, { waitMs: 2000 })
    if (!done.ran) await redis.sadd(DIRTY, m)
  }
  return written
}

/** A table's numbers since a day (YYYY-MM-DD), in total and by day: one A/B test run's (`run`), or all of them (`run` undefined). */
export async function pricingFunnel(tableId: string, options: { since: string, run?: string }): Promise<{ total: PricingFunnel, days: Array<{ day: string } & PricingFunnel> }> {
  const query = new (useParse()).Query('PricingStat').equalTo('tableId', tableId).greaterThanOrEqualTo('day', options.since).ascending('day').limit(5000)
  if (options.run !== undefined) query.equalTo('run', options.run)
  const rows = await query.find(MASTER)
  const byDay = new Map<string, PricingFunnel>()
  const total = emptyFunnel()
  for (const row of rows) {
    const funnel = funnelOfRow(row)
    addFunnel(total, funnel)
    const day = String(row.get('day'))
    byDay.set(day, addFunnel(byDay.get(day) || emptyFunnel(), funnel))
  }
  return { total, days: [...byDay.entries()].map(([day, funnel]) => ({ day, ...funnel })) }
}

/** An A/B test's result: each table's numbers over the run, against the control's. Null when the table has never run one. */
export async function pricingExperimentReport(project: ParseObject, control: ParseObject) {
  const experiment = pricingExperimentOf(control.get('experiment'))
  if (!experiment.runId) return null
  const since = (experiment.startedAt || '').slice(0, 10) || '2000-01-01'
  const keys = [String(control.get('key')), ...experiment.variants.map(v => v.table)]
  const rows = await new (useParse()).Query('PricingTable').equalTo('project', project).containedIn('key', keys).limit(10).find(MASTER)
  const byKey = new Map(rows.map(row => [String(row.get('key')), row]))
  const arms = await Promise.all(keys.map(async (key, i) => {
    const row = byKey.get(key)
    const funnel = row ? (await pricingFunnel(row.id || '', { since, run: experiment.runId })).total : emptyFunnel()
    return { table: key, name: String(row?.get('name') || key), id: row?.id || '', control: i === 0, weight: i === 0 ? experiment.weight : experiment.variants[i - 1]!.weight, funnel }
  }))
  const base = arms[0]!.funnel
  const compared = arms.map(arm => ({ ...arm, ...compareConversion(base, arm.funnel) }))
  // A leader once the numbers say so: the best rate among the arms that differ from the control with 95% confidence.
  const better = compared.filter(arm => !arm.control && arm.enough && arm.confidence >= 0.95 && (arm.lift || 0) > 0).sort((a, b) => b.rate - a.rate)
  const worse = compared.filter(arm => !arm.control && arm.enough && arm.confidence >= 0.95 && (arm.lift || 0) < 0)
  return { ...experiment, arms: compared, leader: better[0]?.table || (worse.length && worse.length === compared.length - 1 ? compared[0]!.table : null) }
}

// ---- conversions, from Stripe -----------------------------------------------------------

type Owner = { tableId: string, key: string, plan: string, slot: string }

/** Which table and plan sells each Payment Link, from what each published table kept of Stripe. */
function linkOwners(tables: ParseObject[]): Map<string, Owner[]> {
  const out = new Map<string, Owner[]>()
  for (const row of tables) {
    const published = row.get('published') as { snapshot?: Record<string, unknown>, stripe?: StripeCatalog | null } | undefined
    const catalog = published?.stripe
    if (!catalog || !published?.snapshot) continue
    const currency = String((published.snapshot.options as { currency?: string } | undefined)?.currency || 'usd')
    for (const plan of pricingPlansOf(published.snapshot.plans)) {
      for (const slot of PRICING_INTERVALS) {
        const price = stripePriceFor(plan, slot, catalog, [currency])
        if (!price) continue
        for (const link of catalog.links.filter(l => l.prices.includes(price.id))) {
          out.set(link.id, [...(out.get(link.id) || []), { tableId: row.id || '', key: String(row.get('key')), plan: plan.key, slot }])
        }
      }
    }
  }
  return out
}

/**
 * Counts the project's Checkout Sessions that completed in the last two days and came from one of its
 * pricing tables, each once. HelpBites' own sessions carry the table, plan and A/B test in their
 * metadata; a Payment Link's are matched by the link, and by `hbx__…` in their reference id for a test.
 */
export async function pollPricingConversions(project: ParseObject, account: ParseObject): Promise<{ counted: number }> {
  const projectId = project.id || ''
  const redis = useRedis()
  const status = `sb:pricing:conv:${projectId}`
  try {
    const key = readCredential(String(account.get('secretSealed') || ''))
    const sessions = await stripeListAll(key, '/checkout/sessions', { 'status': 'complete', 'created[gte]': String(Math.floor(Date.now() / 1000) - LOOK_BACK_SECONDS) }, 2000)
    const tables = await new (useParse()).Query('PricingTable').equalTo('project', project).limit(100).find(MASTER)
    const byKey = new Map(tables.map(row => [String(row.get('key')), row]))
    const owners = linkOwners(tables)
    let counted = 0
    for (const session of sessions) {
      const meta = (session.metadata || {}) as Record<string, string>
      let owner: { tableId: string, plan: string, run: string, slot: string } | null = null
      const ours = meta.helpbites_table ? byKey.get(meta.helpbites_table) : undefined
      if (ours) owner = { tableId: ours.id || '', plan: String(meta.helpbites_plan || ''), run: String(meta.helpbites_run || ''), slot: String(meta.helpbites_interval || '') }
      else if (session.payment_link && owners.has(session.payment_link)) {
        const tagged = /^hbx__([a-z0-9-]+)__([a-z0-9-]+)__([\w]+)$/.exec(String(session.client_reference_id || ''))
        const list = owners.get(session.payment_link)!
        const pick = (tagged && list.find(o => o.key === tagged[2])) || list[0]!
        owner = { tableId: pick.tableId, plan: pick.plan, run: tagged ? tagged[3]! : '', slot: pick.slot }
      }
      if (!owner) continue
      // Each session once, however many times this looks back over it.
      if (!(await redis.sadd(`sb:pricing:counted:${projectId}`, String(session.id)))) continue
      counted++
      const day = new Date((Number(session.created) || Date.now() / 1000) * 1000).toISOString().slice(0, 10)
      await countPricing(projectId, owner.tableId, owner.run, { conversions: 1 }, { plan: owner.plan, day, revenue: { currency: String(session.currency || '').toLowerCase(), amount: Number(session.amount_total) || 0 } })
    }
    await redis.expire(`sb:pricing:counted:${projectId}`, COUNTED_SECONDS)
    await redis.set(status, JSON.stringify({ at: new Date().toISOString(), error: '' }), 'EX', KEEP_SECONDS)
    return { counted }
  } catch (error) {
    const message = String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Stripe could not be read').slice(0, 300)
    await redis.set(status, JSON.stringify({ at: new Date().toISOString(), error: message }), 'EX', KEEP_SECONDS).catch(() => {})
    throw error
  }
}

/** When Stripe was last asked about conversions, and what went wrong if it did. */
export async function pricingConversionStatus(projectId: string): Promise<{ at: string, error: string } | null> {
  try {
    const raw = await useRedis().get(`sb:pricing:conv:${projectId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

let lastPoll = 0

/** The worker's turn (server/plugins/marketingWorker.ts): save what was counted, and every few minutes ask Stripe about the projects due. */
export async function runPricingWork(): Promise<void> {
  await flushPricingStats()
  if (Date.now() - lastPoll < 60_000) return
  lastPoll = Date.now()
  await runExclusive('sb:pricing:conversions', 600, async () => {
    const Parse = useParse()
    const published = await new Parse.Query('PricingTable').equalTo('status', 'published').select('project').limit(1000).find(MASTER)
    const projectIds = [...new Set(published.map(row => pointerId(row.get('project'))).filter(Boolean))]
    const redis = useRedis()
    for (const projectId of projectIds) {
      if (await redis.set(`sb:pricing:convnext:${projectId}`, '1', 'EX', POLL_EVERY_SECONDS, 'NX') !== 'OK') continue
      const account = await new Parse.Query('StripeAccount').equalTo('projectId', projectId).notEqualTo('enabled', false).include('project').first(MASTER)
      if (!account) continue
      await pollPricingConversions(account.get('project') as ParseObject, account).catch(error => console.warn(`[pricing] conversions for ${projectId}:`, (error as Error).message))
    }
  })
}
