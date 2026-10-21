import { randomBytes } from 'node:crypto'
import { createError } from 'h3'
import { cleanEventFilters, WEBHOOK_ENDPOINT_LIMITS, type WebhookDeliveryDto } from '#shared/domainEvents'
import { safeHttpUrl } from '#shared/support'
import { MASTER, iso, pointerId, useParse, type ParseObject } from './parse'
import { newDomainEvent } from './domainEvents'
import { assertFeature, projectWorkspaceId } from './usage'

// The CRUD behind a project's webhook endpoints. Signing and delivery are in
// webhooks.ts; the filters and event names in shared/domainEvents.ts.

const newSecret = () => `whsec_${randomBytes(24).toString('hex')}`

export async function getProjectEndpoint(project: ParseObject, id: string): Promise<ParseObject> {
  const row = id ? await new (useParse()).Query('WebhookEndpoint').equalTo('project', project).equalTo('objectId', id).first(MASTER) : null
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Webhook endpoint not found' })
  return row
}

export async function listProjectEndpoints(project: ParseObject): Promise<ParseObject[]> {
  return new (useParse()).Query('WebhookEndpoint').equalTo('project', project).ascending('createdAt').limit(WEBHOOK_ENDPOINT_LIMITS.endpoints + 5).find(MASTER)
}

/** Apply a create or PATCH body to an endpoint row; 400 with every problem found. */
export function applyEndpointInput(row: ParseObject, body: Record<string, unknown>): void {
  const errors: string[] = []
  if ('url' in body) {
    const url = safeHttpUrl(body.url)
    if (!url) errors.push('url must be an http(s) address')
    else row.set('url', url)
  }
  if (typeof body.description === 'string') row.set('description', body.description.trim().slice(0, WEBHOOK_ENDPOINT_LIMITS.description))
  if ('events' in body) {
    const { filters, errors: problems } = cleanEventFilters(body.events)
    errors.push(...problems)
    if (!problems.length) row.set('events', filters)
  }
  if (typeof body.enabled === 'boolean') row.set('enabled', body.enabled)
  if (!row.get('url') && !errors.length) errors.push('url is required')
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
}

export async function createEndpoint(project: ParseObject, body: Record<string, unknown>): Promise<ParseObject> {
  await assertFeature(await projectWorkspaceId(project), 'eventWebhooks')
  const existing = await listProjectEndpoints(project)
  if (existing.length >= WEBHOOK_ENDPOINT_LIMITS.endpoints) throw createError({ statusCode: 400, statusMessage: `At most ${WEBHOOK_ENDPOINT_LIMITS.endpoints} endpoints per project` })
  const row = new (useParse().Object.extend('WebhookEndpoint'))() as ParseObject
  row.set('project', project)
  row.set('events', ['*'])
  row.set('enabled', true)
  row.set('secret', newSecret())
  applyEndpointInput(row, body)
  await row.save(null, MASTER)
  return row
}

export async function rotateEndpointSecret(row: ParseObject): Promise<void> {
  row.set('secret', newSecret())
  await row.save(null, MASTER)
}

/** A `webhook.test` event for one endpoint, queued like any other so the signature and retries are the real ones. */
export async function queueTestDelivery(project: ParseObject, endpoint: ParseObject): Promise<void> {
  const event = newDomainEvent(project, 'webhook.test', { message: 'This is a test event from HelpBites.' })
  const row = new (useParse().Object.extend('WebhookDelivery'))() as ParseObject
  row.set('project', project)
  row.set('endpoint', endpoint)
  row.set('type', event.type)
  row.set('payload', event)
  row.set('status', 'pending')
  row.set('attempts', 0)
  row.set('nextAt', new Date())
  await row.save(null, MASTER)
}

export async function recentDeliveries(project: ParseObject, endpointId = '', limit = 30): Promise<WebhookDeliveryDto[]> {
  const Parse = useParse()
  const query = new Parse.Query('WebhookDelivery').equalTo('project', project).descending('createdAt').limit(Math.min(Math.max(limit, 1), 100))
  if (endpointId) query.equalTo('endpoint', Parse.Object.extend('WebhookEndpoint').createWithoutData(endpointId))
  const rows = await query.find(MASTER)
  return rows.map(row => ({
    id: row.id || '',
    endpointId: pointerId(row.get('endpoint')),
    type: String(row.get('type') || ''),
    status: row.get('status') as WebhookDeliveryDto['status'],
    attempts: Number(row.get('attempts') || 0),
    lastError: String(row.get('lastError') || ''),
    createdAt: iso(row.createdAt),
    deliveredAt: iso(row.get('deliveredAt'))
  }))
}
