defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'FAQs and saved replies to answer a conversation with',
    description: 'Saved replies of the project and FAQs from the knowledge the project\'s assistants can read, matching `q` (title, shortcut or text for replies; the assistants\' search for FAQs: Meilisearch when configured, else a keyword scan). With no `q` the replies are listed by title and the FAQs answer the customer\'s latest message. The text of a saved reply still has its `{{firstName}}` and `{{name}}` placeholders: the client fills them from the contact when it inserts one.',
    operationId: 'getConversationSuggestions',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } },
      { name: 'q', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'What to look for.' }
    ],
    responses: { 200: { description: '`{ faqs: [{ id, question, answer }], savedReplies: [{ id, title, body, shortcut }] }`' }, 404: { description: 'Conversation not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const project = await requireProject(ctx, pointerId(conversation.get('project')))
  setHeader(event, 'Cache-Control', 'no-store')
  return await suggestionsFor(project, conversation, String(getQuery(event).q || ''))
})
