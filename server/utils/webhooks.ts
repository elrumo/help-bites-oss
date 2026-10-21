import { createHmac } from 'node:crypto'
import { MASTER, useParse, type ParseObject } from './parse'
import { runExclusive } from './redis'
import { safeFetch } from './outbound'
import { workspaceIsActive } from './tenancy'
import { hasFeature, projectWorkspaceId } from './usage'
import { LEGACY_WEBHOOK_EVENTS, matchesEventFilter, type DomainEvent, type WebhookEndpointDto } from '#shared/domainEvents'

// Event webhooks: how HelpBites tells the developer's app about changes it
// owns — someone unsubscribed, an address bounced — without ever writing to
// their database. A durable outbox: emitting writes a WebhookDelivery row, the
// worker posts it, and failures retry with backoff for about a day, so a lost
// unsubscribe never happens just because their server was down for a minute.
//
// Who receives what: the project's original single URL (Settings → Event
// webhook) keeps the four events it always got; WebhookEndpoint rows each
// choose their own filter over the domain events (server/utils/domainEvents.ts).
//
// Signed exactly like the action webhook (`x-helpbites-signature:
// sha256=<hmac of the body>`), so one verifier serves both. The body carries
// an `id` (dedupe on it: a retry after a timeout can arrive twice) and
// `createdAt` (reject old ones to stop replays).

export type WebhookEventType = string

// Minutes to wait after each failed attempt; after the last, the delivery is marked failed.
export const WEBHOOK_BACKOFF_MINUTES = [1, 5, 30, 120, 720]
// A suspended workspace's events wait (without using up attempts) and are looked at again this much later.
const INACTIVE_RETRY_MS = 60 * 60_000
const DELIVERY_BUDGET_MS = 90_000

export function webhookSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

/** When to try again after `attempts` failures; null to give up. */
export function nextWebhookAttempt(attempts: number, now = new Date()): Date | null {
  const wait = WEBHOOK_BACKOFF_MINUTES[attempts - 1]
  return wait === undefined ? null : new Date(now.getTime() + wait * 60_000)
}

export function serializeWebhookEndpoint(row: ParseObject, secret = false): WebhookEndpointDto {
  const status = String(row.get('lastStatus') || '')
  return {
    id: row.id || '',
    projectId: (row.get('project') as ParseObject | undefined)?.id || '',
    url: String(row.get('url') || ''),
    description: String(row.get('description') || ''),
    events: ((row.get('events') as string[] | undefined) || ['*']).map(String),
    enabled: row.get('enabled') !== false,
    ...(secret ? { secret: String(row.get('secret') || '') } : {}),
    lastDeliveryAt: row.get('lastDeliveryAt') ? new Date(row.get('lastDeliveryAt') as Date).toISOString() : null,
    lastStatus: status === 'delivered' || status === 'failed' || status === 'pending' ? status : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null
  }
}

/** Queue a domain event for every destination that wants it: the legacy URL, then each matching endpoint. Nothing when the plan has no event webhooks. */
export async function queueWebhooks(project: ParseObject, event: DomainEvent): Promise<number> {
  const Parse = useParse()
  const legacy = Boolean(project.get('eventWebhookUrl') && project.get('eventWebhookSecret') && LEGACY_WEBHOOK_EVENTS.includes(event.type))
  const endpoints = (await new Parse.Query('WebhookEndpoint').equalTo('project', project).notEqualTo('enabled', false).limit(50).find(MASTER))
    .filter(row => matchesEventFilter(event.type, (row.get('events') as string[] | undefined) || ['*']))
  if (!legacy && !endpoints.length) return 0
  if (!(await hasFeature(await projectWorkspaceId(project), 'eventWebhooks'))) return 0
  const rows = [...(legacy ? [null] : []), ...endpoints].map((endpoint) => {
    const row = new (Parse.Object.extend('WebhookDelivery'))() as ParseObject
    row.set('project', project)
    if (endpoint) row.set('endpoint', endpoint)
    row.set('type', event.type)
    row.set('payload', event)
    row.set('status', 'pending')
    row.set('attempts', 0)
    row.set('nextAt', new Date())
    return row
  })
  try {
    await Parse.Object.saveAll(rows, MASTER)
  } catch (error) {
    console.error('[webhooks] could not queue events:', (error as Error).message)
    return 0
  }
  return rows.length
}

async function deliver(row: ParseObject): Promise<void> {
  const project = row.get('project') as ParseObject
  const endpoint = row.get('endpoint') as ParseObject | undefined
  // A row with no endpoint belongs to the project's original webhook, which only ever got its own events:
  // one whose endpoint was deleted must not fall through to it.
  const orphaned = !endpoint && !LEGACY_WEBHOOK_EVENTS.includes(String(row.get('type')))
  const url = String(orphaned ? '' : endpoint ? endpoint.get('url') || '' : project.get('eventWebhookUrl') || '')
  const secret = String(orphaned ? '' : endpoint ? endpoint.get('secret') || '' : project.get('eventWebhookSecret') || '')
  if (!url || !secret || (endpoint && endpoint.get('enabled') === false)) {
    row.set('status', 'failed')
    row.set('lastError', endpoint || orphaned ? 'The endpoint was deleted or switched off' : 'The project has no event webhook any more')
    row.unset('nextAt')
    await row.save(null, MASTER)
    return
  }
  const body = JSON.stringify(row.get('payload'))
  const attempts = Number(row.get('attempts') || 0) + 1
  let error = ''
  try {
    const response = await safeFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-helpbites-signature': webhookSignature(secret, body), 'x-helpbites-event': String(row.get('type')) }, body, timeoutMs: 15_000 })
    if (!response.ok) error = `HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`
  } catch (e) {
    error = String((e as { statusMessage?: string }).statusMessage || (e as Error).message || 'Request failed').slice(0, 300)
  }
  row.set('attempts', attempts)
  if (!error) {
    row.set('status', 'delivered')
    row.set('deliveredAt', new Date())
    row.unset('nextAt')
  } else {
    const next = nextWebhookAttempt(attempts)
    row.set('lastError', error)
    if (next) row.set('nextAt', next)
    else { row.set('status', 'failed'); row.unset('nextAt') }
  }
  await row.save(null, MASTER)
  // The endpoint list shows how the last delivery went.
  if (endpoint && (row.get('status') !== 'pending')) {
    endpoint.set('lastStatus', row.get('status'))
    endpoint.set('lastDeliveryAt', new Date())
    await endpoint.save(null, MASTER).catch(() => {})
  }
}

/** Post what is due, oldest first. One process at a time. */
export async function deliverDueWebhooks(limit = 50): Promise<void> {
  const started = Date.now()
  await runExclusive('sb:webhooks:deliver', 120, async () => {
    const rows = await new (useParse()).Query('WebhookDelivery').equalTo('status', 'pending').lessThanOrEqualTo('nextAt', new Date()).ascending('nextAt').include('project').include('endpoint').limit(limit).find(MASTER)
    // Per project in order, a few projects at a time: one slow endpoint does not hold up the rest.
    const byProject = new Map<string, ParseObject[]>()
    for (const row of rows) {
      const key = (row.get('project') as ParseObject)?.id || ''
      byProject.set(key, [...(byProject.get(key) || []), row])
    }
    await Promise.all([...byProject.values()].map(async (list) => {
      if (!(await workspaceIsActive(await projectWorkspaceId(list[0]!.get('project') as ParseObject | undefined)))) {
        for (const row of list) row.set('nextAt', new Date(Date.now() + INACTIVE_RETRY_MS))
        await useParse().Object.saveAll(list, MASTER)
        return
      }
      // The lock below lasts 120 s and is not renewed: stop starting deliveries well before it ends.
      for (const row of list) {
        if (Date.now() - started > DELIVERY_BUDGET_MS) break
        await deliver(row)
      }
    }))
  })
}
