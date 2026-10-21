defineRouteMeta({
  openAPI: {
    tags: ['Saved replies'], operationId: 'createSavedReply', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a saved reply',
    description: 'A title (up to 120 characters), the text (up to 8,000) and an optional `shortcut` (letters, digits, dash and underscore, up to 30, unique in the project; a leading slash is ignored). A project has at most 200.',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['project', 'title', 'body'], properties: {
      project: { type: 'string' }, title: { type: 'string', example: 'Refund policy' }, body: { type: 'string', example: 'Hi {{firstName}}, you can ask for a refund within 30 days.' }, shortcut: { type: 'string', example: 'refund' }
    } } } } },
    responses: { 200: { description: '`{ reply }`' }, 400: { description: 'Invalid value.' }, 409: { description: 'The shortcut is taken, or the project has 200 replies.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
  const project = await savedReplyProject(ctx, event, body)
  return { reply: serializeSavedReply(await createSavedReply(project, ctx.agentId, body)) }
})
