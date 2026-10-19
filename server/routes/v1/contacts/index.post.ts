import { readContactInput } from '#shared/contacts'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'upsertContacts', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create or update contacts',
    description: 'One contact (`identify`), or up to 1000 as `{ contacts: [...] }`. A contact is matched by `externalId` (your user id — the `sub` of their identity tokens), then by `email`; anything unmatched is created. Attributes merge (`null` removes one), tags are added.\n\nConsent: anyone can be unsubscribed. `subscription: "subscribed"` only applies to people who have not chosen yet; to subscribe someone who unsubscribed, they must have asked again — pass `resubscribe: true`.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
      externalId: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' },
      attributes: { type: 'object', description: 'Up to 50 keys (letters, digits, `_`); string, number or boolean values.' },
      tags: { type: 'array', items: { type: 'string' } },
      subscription: { type: 'string', enum: ['none', 'subscribed', 'unsubscribed'] },
      unsubscribedTopics: { type: 'array', items: { type: 'string' } },
      resubscribe: { type: 'boolean', description: 'The person asked to be subscribed again.' },
      contacts: { type: 'array', maxItems: 1000, items: { type: 'object' }, description: 'A batch: each item has the fields above.' },
      fillOnly: { type: 'boolean', description: 'Batch only: fill blank fields, never overwrite (for imports of older data).' },
      project: { type: 'string', description: 'Operators and admin keys only.' }
    } }, example: { externalId: 'u_42', email: 'ada@example.com', name: 'Ada', attributes: { plan: 'pro' }, tags: ['beta'] } } } },
    responses: {
      200: { description: 'One: `{ contact, status }`. A batch: `{ results: [{ index, status, id, error? }], created, updated, unchanged, failed }`. Status is created, updated, unchanged or failed.' },
      400: { description: 'Invalid contact (one), or not a list (batch).' },
      402: { description: 'The new contacts would pass the plan\'s contact limit; nothing in the call is saved.' },
      413: { description: 'More than 1000 contacts.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  const via = caller.source === 'api' ? 'api' : 'panel'

  if (body.contacts === undefined) {
    const { input, errors } = readContactInput(body)
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    const [result] = await upsertContacts(project, [input], { via, explicit: body.resubscribe === true })
    if (result!.status === 'failed') throw createError({ statusCode: 400, statusMessage: result!.error || 'Could not save the contact' })
    return { contact: serializeContact(await getProjectContact(project, result!.id)), status: result!.status }
  }

  if (!Array.isArray(body.contacts)) throw createError({ statusCode: 400, statusMessage: 'contacts must be a list' })
  const read = body.contacts.map(item => readContactInput(item))
  const valid = read.flatMap((r, index) => (r.errors.length ? [] : [{ index, input: r.input }]))
  const written = await upsertContacts(project, valid.map(v => v.input), { via: via === 'panel' ? 'import' : 'api', fillOnly: body.fillOnly === true })
  const results: Awaited<ReturnType<typeof upsertContacts>> = read.map((r, index) => ({ index, status: 'failed', id: '', error: r.errors.join('; ') }))
  for (const [i, result] of written.entries()) results[valid[i]!.index] = { ...result, index: valid[i]!.index }
  const count = (status: string) => results.filter(r => r.status === status).length
  return { results, created: count('created'), updated: count('updated'), unchanged: count('unchanged'), failed: count('failed') }
})
