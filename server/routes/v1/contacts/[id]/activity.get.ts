import { readActivityTypes } from '#shared/activity'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'getContactActivity', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Everything one person has done, in one list',
    description: 'Conversations, feedback posts, comments and votes, emails sent to them, sequences they are on, Stripe payments and subscriptions, and onboarding they finished, newest first. Page backwards with `before` (the `at` of the last item you have). `types` limits the kinds: `joined, conversation, feedback_post, feedback_comment, vote, email, sequence, payment, subscription, onboarding`.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'The contact id.' },
      { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Operators and admin keys only.' },
      { name: 'types', in: 'query', schema: { type: 'string' }, description: 'Comma-separated kinds.' },
      { name: 'before', in: 'query', schema: { type: 'string' }, description: 'ISO time: only older items.' },
      { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } }
    ],
    responses: { 200: { description: '`{ items: [{ id, type, at, title, detail, ref }], nextBefore }`' }, 404: { description: 'Not in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const contact = await getProjectContact(project, getRouterParam(event, 'id') || '')
  const query = getQuery(event)
  return contactActivity(project, contact, { types: readActivityTypes(query.types), before: String(query.before || '') || undefined, limit: Number(query.limit) || undefined })
})
