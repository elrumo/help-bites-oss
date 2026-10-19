import { CONTACT_SUBSCRIPTIONS } from '#shared/contacts'
import { billingRules } from '#shared/stripe'
import { compileSegmentFilter } from '#shared/segments'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'listContacts', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List contacts',
    description: 'The project\'s people, newest first: your app\'s users (from identity tokens), imports, database syncs and sign-ups. Page with `cursor` (the `nextCursor` of the previous page). `q` searches name, email and id and returns one page of best matches. `externalId` or `email` looks one person up.',
    parameters: [
      { name: 'segment', in: 'query', schema: { type: 'string' }, description: 'Only this segment\'s contacts (segment id).' },
      { name: 'billing', in: 'query', schema: { type: 'string', enum: ['paying', 'never', 'active', 'trialing', 'past_due', 'canceled'] }, description: 'Stripe billing status, once Stripe is connected: paying (has paid), never (never paid) or a subscription status.' },
      { name: 'minRevenue', in: 'query', schema: { type: 'number' }, description: 'Only people who paid more than this in total (Stripe, in the account\'s main currency).' },
      { name: 'q', in: 'query', schema: { type: 'string' } },
      { name: 'tag', in: 'query', schema: { type: 'string' } },
      { name: 'subscription', in: 'query', schema: { type: 'string', enum: ['none', 'pending', 'subscribed', 'unsubscribed'] } },
      { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Changed at or after this time: poll it to mirror unsubscribes into your database.' },
      { name: 'externalId', in: 'query', schema: { type: 'string' } },
      { name: 'email', in: 'query', schema: { type: 'string' } },
      { name: 'cursor', in: 'query', schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
      { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Operators and admin keys only.' }
    ],
    responses: { 200: { description: '`{ contacts: [Contact], nextCursor }`', content: { 'application/json': { schema: { type: 'object', properties: { contacts: { type: 'array', items: { '$ref': '#/components/schemas/Contact' } }, nextCursor: { type: 'string', nullable: true } } } } } } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const query = getQuery(event)
  const text = (key: string) => (typeof query[key] === 'string' ? String(query[key]).trim() : '')

  if (text('externalId') || text('email')) {
    const row = await findContactBy(project, { externalId: text('externalId'), email: text('email') })
    return { contacts: row ? [serializeContact(row)] : [], nextCursor: null }
  }
  const updatedSince = text('updatedSince') ? new Date(text('updatedSince')) : undefined
  if (updatedSince && Number.isNaN(updatedSince.getTime())) throw createError({ statusCode: 400, statusMessage: 'updatedSince must be an ISO date' })
  const subscription = text('subscription')
  if (subscription && !CONTACT_SUBSCRIPTIONS.includes(subscription as never)) throw createError({ statusCode: 400, statusMessage: 'Unknown subscription' })

  // The segment and the billing filters both narrow the list.
  const billing = billingRules(text('billing'), text('minRevenue') ? Number(text('minRevenue')) : undefined)
  const wheres = [text('segment') ? await segmentWhere(project, text('segment')) : {}, compileSegmentFilter({ match: 'all', rules: billing })].filter(w => Object.keys(w).length)
  return listContacts(project, {
    where: wheres.length > 1 ? { $and: wheres } : wheres[0],
    q: text('q'),
    tag: text('tag'),
    subscription,
    updatedSince,
    cursor: text('cursor'),
    limit: Number(query.limit) || 50
  })
})
