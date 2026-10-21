defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Draft a reply with AI',
    description: 'Writes a reply for the operator to edit, with the same pipeline as the auto-responder: the conversation\'s assistant (else any active assistant of the project), the knowledge it may read, and the public part of the conversation (internal notes are never shown to the model). Nothing is stored or sent: put `draft` in the reply box. `sources` are the FAQs it was given. Counts against the workspace\'s AI credits.',
    operationId: 'draftConversationReply',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } }],
    responses: {
      200: { description: '`{ draft, model, sources: [{ faqId, question }] }`' },
      402: { description: 'The workspace has used its AI credits.' },
      404: { description: 'Conversation not found.' },
      409: { description: 'The project has no assistant, no AI is set up, or the customer has not written yet.' },
      502: { description: 'The AI provider failed.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'inbox' })
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const project = await requireProject(ctx, pointerId(conversation.get('project')))
  setHeader(event, 'Cache-Control', 'no-store')
  return await draftReply(ctx.workspace, project, conversation)
})
