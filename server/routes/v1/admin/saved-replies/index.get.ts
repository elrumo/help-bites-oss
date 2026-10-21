defineRouteMeta({
  openAPI: {
    tags: ['Saved replies'], operationId: 'listSavedReplies', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List a project\'s saved replies',
    description: 'Canned replies for the inbox, by title. `{{firstName}}` and `{{name}}` in the text are filled from the customer when a client inserts one (the first word of their name, else "there").',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    responses: { 200: { description: '`{ replies: [{ id, projectId, title, body, shortcut, createdAt, updatedAt }] }`' }, 400: { description: 'Missing project.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const project = await savedReplyProject(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { replies: (await listSavedReplies(project)).map(serializeSavedReply) }
})
