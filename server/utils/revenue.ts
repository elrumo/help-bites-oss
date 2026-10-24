import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { revenueSource, type RevenueConnection, type RevenueSourceId } from '#shared/revenue'
import { hubOrigin } from './hub'
import { MASTER, iso, useParse, type ParseObject } from './parse'
import { runExclusive } from './redis'
import { appleAdapter } from './revenue/apple'
import { lemonSqueezyAdapter } from './revenue/lemonsqueezy'
import { paddleAdapter } from './revenue/paddle'
import { saveRows } from './revenue/rows'
import type { Credentials, PullAdapter } from './revenue/types'
import { readCredential, storeCredential } from './secrets'
import { findStripeAccount, serializeStripeAccount } from './stripe'
import { workspaceIsActive } from './tenancy'
import { projectWorkspaceId } from './usage'

// Revenue sources other than Stripe (Stripe keeps its own sync, server/utils/stripe.ts). A project
// connects each one at most once: a RevenueSource row holds its credentials (sealed JSON), where
// the worker stopped, and how the last run went. What a source reads becomes StripePayment and
// StripeSubscription rows tagged with its `source`, which the Revenue tab, the overview and a
// person's billing section read together (shared/revenue.ts).
//
//   pull    Apple, Paddle, Lemon Squeezy: an adapter in server/utils/revenue/ reads the service on
//           the worker's tick, a stretch of up to RUN_BUDGET_MS at a time, from a saved cursor.
//   push    RevenueCat: the service posts events to /v1/webhooks/revenuecat/<project>
//           (server/utils/revenue/revenuecat.ts); the row keeps the secret that must come with them.
//   manual  Custom: nothing is read; payments arrive on POST /v1/admin/revenue/payments.

const ADAPTERS: Partial<Record<RevenueSourceId, PullAdapter>> = { apple: appleAdapter, paddle: paddleAdapter, lemonsqueezy: lemonSqueezyAdapter }
const RUN_BUDGET_MS = 25_000
const DEFAULT_EVERY_MINUTES = 60
const OTHER_CLASSES = ['StripePayment', 'StripeSubscription'] as const

export async function findRevenueSource(project: ParseObject, source: RevenueSourceId): Promise<ParseObject | null> {
  return (await new (useParse()).Query('RevenueSource').equalTo('project', project).equalTo('source', source).first(MASTER)) || null
}

export async function requireRevenueSource(project: ParseObject, source: RevenueSourceId): Promise<ParseObject> {
  const row = await findRevenueSource(project, source)
  if (!row) throw createError({ statusCode: 404, statusMessage: `${revenueSource(source)?.id || source} is not connected to this project` })
  return row
}

export function credentialsOf(row: ParseObject): Credentials {
  try { return JSON.parse(readCredential(row.get('secretSealed')) || '{}') } catch { return {} }
}

const webhookUrl = (event: H3Event, project: ParseObject, source: RevenueSourceId) => `${hubOrigin(event)}/v1/webhooks/${source}/${project.id}`

/** The connection as the API returns it. Push sources show where to send events; the secret only to who `withSecret`. */
export async function serializeRevenueSource(row: ParseObject, options: { event?: H3Event, project?: ParseObject, withSecret?: boolean } = {}): Promise<RevenueConnection> {
  const Parse = useParse()
  const source = row.get('source') as RevenueSourceId
  const count = (className: string) => new Parse.Query(className).equalTo('projectId', row.get('projectId')).equalTo('source', source).count(MASTER)
  const [payments, subscriptions] = await Promise.all([count('StripePayment'), count('StripeSubscription')])
  const push = revenueSource(source)?.kind === 'push'
  return {
    source,
    accountName: String(row.get('accountName') || ''),
    livemode: row.get('livemode') !== false,
    status: row.get('status') || 'idle',
    lastRunAt: iso(row.get('lastRunAt')),
    lastError: String(row.get('lastError') || ''),
    stats: { payments, subscriptions },
    ...(push && options.event && options.project ? { webhook: { url: webhookUrl(options.event, options.project, source), token: options.withSecret ? String(credentialsOf(row).webhookToken || '') : '' } } : {})
  }
}

/** Every connected source of a project, Stripe first. */
export async function listRevenueSources(project: ParseObject, options: { event?: H3Event, withSecret?: boolean } = {}): Promise<RevenueConnection[]> {
  const [stripe, rows] = await Promise.all([
    findStripeAccount(project),
    new (useParse()).Query('RevenueSource').equalTo('project', project).ascending('createdAt').limit(20).find(MASTER)
  ])
  const connections = await Promise.all(rows.map(row => serializeRevenueSource(row, { ...options, project })))
  const s = serializeStripeAccount(stripe)
  const first: RevenueConnection[] = stripe ? [{ source: 'stripe', accountName: s.accountName, livemode: s.livemode, status: s.status, lastRunAt: s.lastRunAt, lastError: s.lastError, stats: { payments: s.stats.payments, subscriptions: s.stats.subscriptions } }] : []
  return [...first, ...connections]
}

const bad = (message: string) => createError({ statusCode: 400, statusMessage: message })

/** Reads the fields a source asks for out of what the panel or a script sent. */
function readCredentials(source: RevenueSourceId, input: unknown): Credentials {
  const given = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const out: Credentials = {}
  for (const field of revenueSource(source)?.fields || []) {
    const value = typeof given[field.key] === 'string' ? (given[field.key] as string).trim() : ''
    if (!value && !field.optional) throw bad(`Enter ${field.key.replace(/([A-Z])/g, ' $1').toLowerCase()}`)
    if (value.length > 4000) throw bad(`${field.key} is too long`)
    if (value) out[field.key] = value
  }
  return out
}

/**
 * Connects (or reconnects with new credentials) a source other than Stripe. A pull source's
 * credentials are tried first; RevenueCat gets the secret its webhook must send; the custom source
 * needs nothing. Reconnecting a push source keeps its secret, so the service need not be updated.
 */
export async function connectRevenueSource(project: ParseObject, source: RevenueSourceId, input: unknown): Promise<ParseObject> {
  const info = revenueSource(source)
  if (!info || source === 'stripe') throw bad('Unknown revenue source')
  const row = (await findRevenueSource(project, source)) || new (useParse().Object.extend('RevenueSource'))() as ParseObject
  let credentials: Credentials = {}
  let account = { accountName: '', livemode: true }
  if (info.kind === 'pull') {
    credentials = readCredentials(source, input)
    account = await ADAPTERS[source]!.check(credentials)
  } else if (source === 'revenuecat') {
    credentials = { webhookToken: credentialsOf(row).webhookToken || `rcw_${randomBytes(24).toString('base64url')}` }
  }
  row.set('project', project)
  row.set('projectId', project.id)
  row.set('source', source)
  row.set('secretSealed', storeCredential(JSON.stringify(credentials)))
  row.set('accountName', account.accountName)
  row.set('livemode', account.livemode)
  row.set('enabled', true)
  row.set('status', 'idle')
  row.set('lastError', '')
  if (info.kind === 'pull') row.set('nextRunAt', new Date())
  if (row.isNew()) row.set('cursor', {})
  await row.save(null, MASTER)
  return row
}

/** Forgets the credentials and every payment and subscription this source brought. */
export async function disconnectRevenueSource(project: ParseObject, source: RevenueSourceId): Promise<void> {
  const Parse = useParse()
  await (await findRevenueSource(project, source))?.destroy(MASTER)
  for (const className of OTHER_CLASSES) {
    for (;;) {
      const rows = await new Parse.Query(className).equalTo('projectId', project.id).equalTo('source', source).limit(1000).find(MASTER)
      if (!rows.length) break
      await Parse.Object.destroyAll(rows, MASTER)
    }
  }
}

/** One run for up to RUN_BUDGET_MS; the worker continues it on the next tick when there is more. */
export async function runRevenueSync(id: string, options: { reset?: boolean, budgetMs?: number } = {}): Promise<{ ran: boolean }> {
  const result = await runExclusive(`sb:revenue:${id}`, 900, async () => {
    const row = await new (useParse()).Query('RevenueSource').include('project').get(id, MASTER)
    const adapter = ADAPTERS[row.get('source') as RevenueSourceId]
    const project = row.get('project') as ParseObject
    if (!adapter) return
    if (!(await workspaceIsActive(await projectWorkspaceId(project)))) {
      row.set('nextRunAt', new Date(Date.now() + 60 * 60_000))
      await row.save(null, MASTER)
      return
    }
    const projectId = project.id || ''
    row.set('status', 'running')
    await row.save(null, MASTER)
    try {
      const run = await adapter.sync({
        credentials: credentialsOf(row), cursor: options.reset ? {} : (row.get('cursor') || {}), reset: options.reset === true,
        deadline: Date.now() + (options.budgetMs ?? RUN_BUDGET_MS),
        savePayments: rows => saveRows('StripePayment', projectId, rows),
        saveSubscriptions: rows => saveRows('StripeSubscription', projectId, rows)
      })
      row.set('cursor', run.cursor)
      row.set('status', 'idle')
      row.set('lastError', '')
      row.set('lastRunAt', new Date())
      row.set('nextRunAt', new Date(run.done ? Date.now() + (adapter.everyMinutes ?? DEFAULT_EVERY_MINUTES) * 60_000 : Date.now()))
    } catch (error) {
      row.set('status', 'error')
      row.set('lastError', String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Sync failed').slice(0, 500))
      row.set('lastRunAt', new Date())
      row.set('nextRunAt', new Date(Date.now() + DEFAULT_EVERY_MINUTES * 60_000))
      console.warn(`[revenue] ${id} failed:`, row.get('lastError'))
    }
    await row.save(null, MASTER)
  })
  return { ran: result.ran }
}

/** Sources whose turn it is, oldest first. */
export async function dueRevenueSources(limit = 3): Promise<string[]> {
  const rows = await new (useParse()).Query('RevenueSource').notEqualTo('enabled', false).lessThanOrEqualTo('nextRunAt', new Date()).ascending('nextRunAt').limit(limit).select('objectId').find(MASTER)
  return rows.map(r => r.id || '')
}

/** The push source's row for a webhook, when the secret it sent is the one made for it; null otherwise. */
export async function authenticateRevenueWebhook(event: H3Event, project: ParseObject, source: RevenueSourceId): Promise<ParseObject | null> {
  const row = await findRevenueSource(project, source)
  const expected = Buffer.from(String(row ? credentialsOf(row).webhookToken || '' : ''))
  // RevenueCat sends the header exactly as typed on its dashboard; "Bearer " is allowed in front of the secret.
  const supplied = Buffer.from(String(getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '').trim())
  return row && expected.length > 0 && expected.length === supplied.length && timingSafeEqual(expected, supplied) ? row : null
}

/** What a push source records when an event arrives (or fails to be applied): the panel shows when it last heard. */
export async function noteRevenueEvent(row: ParseObject, error?: Error): Promise<void> {
  row.set('lastRunAt', new Date())
  row.set('status', error ? 'error' : 'idle')
  row.set('lastError', error ? String((error as { statusMessage?: string }).statusMessage || error.message).slice(0, 500) : '')
  await row.save(null, MASTER)
}
