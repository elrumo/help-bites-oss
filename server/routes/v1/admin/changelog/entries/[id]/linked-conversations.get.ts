defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'listChangelogLinkedConversations', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Conversations an entry answers',
    description: 'The customer conversations behind an entry: the ones it links itself plus those of its linked board items, once each and only from this project (error issues are left out; there is no customer to tell). `defaultBody` is the starting text for a reply: the entry\'s title and public address. Use `POST …/reply-conversations` to send it; nothing is ever sent automatically.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Entry id, or its number with `?project=`' }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: 'The conversations.', content: { 'application/json': { schema: { type: 'object', required: ['count', 'conversations', 'defaultBody'], properties: { count: { type: 'integer', example: 2 }, conversations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, subject: { type: 'string' }, endUserName: { type: 'string' }, status: { type: 'string' } } } }, defaultBody: { type: 'string', example: 'Good news: “Dark mode” has just shipped.' } } } } } }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Entry not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const { project, row } = await scoped.changelogEntry(ctx, getRouterParam(event, 'id') || '', String(getQuery(event).project || '') || undefined)
  return await linkedConversationsOf(project, row)
})
