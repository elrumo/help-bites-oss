import { createHmac, randomBytes } from 'node:crypto'
import { MASTER, useParse, type ParseObject } from './parse'
import { runExclusive } from './redis'
import { safeFetch } from './outbound'
import { workspaceIsActive } from './tenancy'
import { hasFeature, projectWorkspaceId } from './usage'

// Event webhooks: how HelpBites tells the developer's app about changes it
// owns — someone unsubscribed, an address bounced — without ever writing to
// their database. A durable outbox: emitting writes a WebhookDelivery row, the
// worker posts it, and failures retry with backoff for about a day, so a lost
// unsubscribe never happens just because their server was down for a minute.
//
// Signed exactly like the action webhook (`x-helpbites-signature:
// sha256=<hmac of the body>`), so one verifier serves both. The body carries
// an `id` (dedupe on it: a retry after a timeout can arrive twice) and
// `createdAt` (reject old ones to stop replays).

export type WebhookEventType = 'contact.subscription_changed' | 'email.suppressed' | 'cms.entry.published' | 'cms.entry.unpublished'
  | 'blog.post.published' | 'blog.post.updated' | 'blog.post.unpublished' | 'blog.post.deleted'

// Minutes to wait after each failed attempt; after the last, the delivery is marked failed.
export const WEBHOOK_BACKOFF_MINUTES = [1, 5, 30, 120, 720]
// A suspended workspace's events wait (without using up attempts) and are looked at again this much later.
const INACTIVE_RETRY_MS = 60 * 60_000

export function webhookSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

/** When to try again after `attempts` failures; null to give up. */
export function nextWebhookAttempt(attempts: number, now = new Date()): Date | null {
  const wait = WEBHOOK_BACKOFF_MINUTES[attempts - 1]
  return wait === undefined ? null : new Date(now.getTime() + wait * 60_000)
}

/** Queue an event for the project's webhook; nothing when it has none, or when its workspace's plan does not include them. */
export async function emitWebhooks(project: ParseObject, events: { type: WebhookEventType, data: Record<string, unknown> }[]): Promise<void> {
  if (!events.length || !project.get('eventWebhookUrl') || !project.get('eventWebhookSecret')) return
  if (!(await hasFeature(await projectWorkspaceId(project), 'eventWebhooks'))) return
  const Parse = useParse()
  const rows = events.map(({ type, data }) => {
    const row = new (Parse.Object.extend('WebhookDelivery'))() as ParseObject
    row.set('project', project)
    row.set('type', type)
    row.set('payload', { id: `evt_${randomBytes(12).toString('hex')}`, type, createdAt: new Date().toISOString(), projectId: project.id || '', data })
    row.set('status', 'pending')
    row.set('attempts', 0)
    row.set('nextAt', new Date())
    return row
  })
  try {
    await Parse.Object.saveAll(rows, MASTER)
  } catch (error) {
    console.error('[webhooks] could not queue events:', (error as Error).message)
  }
}

async function deliver(row: ParseObject): Promise<void> {
  const project = row.get('project') as ParseObject
  const url = String(project.get('eventWebhookUrl') || '')
  const secret = String(project.get('eventWebhookSecret') || '')
  if (!url || !secret) {
    row.set('status', 'failed')
    row.set('lastError', 'The project has no event webhook any more')
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
}

/** Post what is due, oldest first. One process at a time. */
export async function deliverDueWebhooks(limit = 50): Promise<void> {
  await runExclusive('sb:webhooks:deliver', 120, async () => {
    const rows = await new (useParse()).Query('WebhookDelivery').equalTo('status', 'pending').lessThanOrEqualTo('nextAt', new Date()).ascending('nextAt').include('project').limit(limit).find(MASTER)
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
      for (const row of list) await deliver(row)
    }))
  })
}
