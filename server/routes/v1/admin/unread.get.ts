defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'getAdminUnread', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Unread inbox count',
    description: 'Customer messages waiting on a reply outside the archive, across the workspace: the badge on the inbox. Never cached, so it is cheap to call whenever a message arrives; the totals stop at 1,000 conversations, as the inbox\'s do. Not the end-user `GET /v1/unread`.',
    responses: { 200: { description: '`{ unreadMessages }`', content: { 'application/json': { example: { unreadMessages: 5 } } } } }
  }
})

export default defineEventHandler(async (event) => {
  return { unreadMessages: await unreadMessages(await requireMember(event)) }
})
