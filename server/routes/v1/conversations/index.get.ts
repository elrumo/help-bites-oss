defineRouteMeta({
  openAPI: {
    tags: ['End user'], operationId: 'listConversations', security: [{ EndUserToken: [] }],
    summary: 'My conversations',
    description: 'Every conversation of the signed-in end user, newest activity first. Bearer: identity token.',
    responses: { 200: { description: 'Caller’s conversations. Private typed fields are removed.', content: { 'application/json': { schema: { type: 'object', properties: { conversations: { type: 'array', items: { '$ref': '#/components/schemas/Conversation' } }, unreadCount: { type: 'integer', example: 2 } } } } } }, 401: { description: 'Invalid identity token.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { endUser } = await requireEndUser(event)
  if (!endUser) return { conversations: [], unreadCount: 0 }
  const Parse = useParse()
  const rows = await new Parse.Query('Conversation').equalTo('endUser', endUser).descending('lastMessageAt').limit(100).find(MASTER)
  const conversations = await Promise.all(rows.map(serializeConversationForEndUser))
  return { conversations, unreadCount: conversations.reduce((sum, c) => sum + c.unreadByUser, 0) }
})
