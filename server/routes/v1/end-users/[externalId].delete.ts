defineRouteMeta({
  openAPI: {
    tags: ['Server'], operationId: 'eraseEndUser', security: [{ ProjectSecret: [] }],
    summary: 'Erase one of your users (server to server)',
    description: 'For account deletion on the host: removes everything the user left in this project — feedback posts (with their votes and comments), their comments and votes on other posts, their support conversations and messages, their changelog subscriptions (by user id or by address), and the end-user record. Idempotent.',
    parameters: [{ name: 'externalId', in: 'path', required: true, schema: { type: 'string' }, description: 'Your user id — the `sub` of their identity tokens' }],
    responses: { 200: { description: 'What was removed.', content: { 'application/json': { schema: { type: 'object', properties: { erased: { type: 'object', example: { posts: 1, comments: 3, votes: 12, conversations: 2, messages: 9, endUsers: 1 } } } } } } }, 401: { description: 'Project secret required.' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await requireProjectSecret(event)
  const externalId = decodeURIComponent(getRouterParam(event, 'externalId') || '').trim()
  if (!externalId) throw createError({ statusCode: 400, statusMessage: 'externalId is required' })
  return { erased: await eraseEndUserData(project, externalId) }
})
