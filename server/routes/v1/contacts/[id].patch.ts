import { cleanTags, readContactInput } from '#shared/contacts'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'updateContact', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Update a contact',
    description: 'Partial. `attributes` merge (`null` removes a key); `tags` replaces the list, `addTags` / `removeTags` change it. Subscribing someone who unsubscribed needs `resubscribe: true` (they asked again). An `externalId` can only be set on a contact that has none.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, language: { type: 'string', description: 'A language tag such as `es` or `pt-BR`; empty clears it.' }, email: { type: 'string' }, externalId: { type: 'string' }, attributes: { type: 'object' }, tags: { type: 'array', items: { type: 'string' } }, addTags: { type: 'array', items: { type: 'string' } }, removeTags: { type: 'array', items: { type: 'string' } }, subscription: { type: 'string', enum: ['none', 'subscribed', 'unsubscribed'] }, unsubscribedTopics: { type: 'array', items: { type: 'string' } }, resubscribe: { type: 'boolean' }, project: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ contact }`' }, 400: { description: 'Invalid change.' }, 404: { description: 'Not in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  const row = await getProjectContact(project, getRouterParam(event, 'id') || '')

  // The row already has an identity, so a patch need not repeat it.
  const { input, errors } = readContactInput({ externalId: row.get('externalId'), email: row.get('email'), ...body, tags: undefined })
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  if (body.tags !== undefined || body.addTags !== undefined || body.removeTags !== undefined) {
    const removed = new Set(cleanTags(body.removeTags))
    const base = body.tags !== undefined ? cleanTags(body.tags) : (row.get('tags') as string[] | undefined) || []
    row.set('tags', cleanTags([...base, ...cleanTags(body.addTags)]).filter(t => !removed.has(t)))
  }
  await saveContact(project, row, input, { via: caller.source === 'api' ? 'api' : 'panel', explicit: body.resubscribe === true })
  return { contact: serializeContact(row) }
})
