defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'One conversation',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ conversation, endUser, project }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const [endUser, project] = await Promise.all([
    (conversation.get('endUser') as ParseObject).fetch(MASTER),
    requireProject(ctx, pointerId(conversation.get('project')))
  ])
  return { conversation: serializeConversation(conversation), endUser: serializeEndUser(endUser), project: serializeAdminProject(project) }
})
