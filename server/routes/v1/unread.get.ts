defineRouteMeta({
  openAPI: {
    tags: ['End user'],
    summary: 'Unread badge count',
    operationId: 'getUnreadCount',
    security: [{ EndUserToken: [] }],
    responses: { 200: { description: 'Sum of unread public agent messages across this user’s conversations.', content: { 'application/json': { schema: { type: 'object', required: ['unreadCount'], properties: { unreadCount: { type: 'integer', example: 3 } } } } } } }
  }
})

export default defineEventHandler(async (event) => {
  const { endUser } = await requireEndUser(event)
  if (!endUser) return { unreadCount: 0 }
  const Parse = useParse()
  const rows = await new Parse.Query('Conversation').equalTo('endUser', endUser).greaterThan('unreadByUser', 0).select('unreadByUser').limit(100).find(MASTER)
  return { unreadCount: rows.reduce((sum, row) => sum + Number(row.get('unreadByUser') || 0), 0) }
})
