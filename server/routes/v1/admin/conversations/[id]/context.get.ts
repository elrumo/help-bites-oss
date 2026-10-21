defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Everything the conversation panel knows about the customer',
    description: 'One read for the panel beside a conversation: who the requester is, their Stripe plan and MRR (`billing` is null unless they have a Stripe customer; `mrr` is in major currency units, e.g. 19.99), their other conversations (newest first, at most 10, this one left out), the feedback posts linked to this conversation with whether the requester follows each, and the knowledge models "Save as FAQ" can write to (best first; `defaultModelId` is empty when the workspace has none).',
    operationId: 'getConversationContext',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } }],
    responses: {
      200: {
        description: '`{ contact, billing, pastConversations, feedbackPosts, faqModels }`',
        content: { 'application/json': { schema: { type: 'object', required: ['contact', 'billing', 'pastConversations', 'feedbackPosts', 'faqModels'], properties: {
          contact: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, externalId: { type: 'string' }, language: { type: 'string', example: 'es' }, lastSeenAt: { type: 'string', format: 'date-time', nullable: true } } },
          billing: { type: 'object', nullable: true, properties: { plan: { type: 'string', example: 'Pro' }, mrr: { type: 'number', example: 29 }, currency: { type: 'string', example: 'usd' }, status: { type: 'string', example: 'active' }, customerId: { type: 'string', example: 'cus_123' } } },
          pastConversations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, subject: { type: 'string' }, status: { type: 'string' }, statusCategory: { type: 'string' }, lastMessageAt: { type: 'string', format: 'date-time', nullable: true }, lastMessagePreview: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } } },
          feedbackPosts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, number: { type: 'integer', nullable: true }, title: { type: 'string' }, status: { type: 'string' }, statusLabel: { type: 'string' }, statusCategory: { type: 'string' }, following: { type: 'boolean' } } } },
          faqModels: { type: 'object', properties: { models: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } }, defaultModelId: { type: 'string' } } }
        } } } }
      },
      404: { description: 'Conversation not found.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const [endUser, project] = await Promise.all([
    (conversation.get('endUser') as ParseObject).fetch(MASTER),
    requireProject(ctx, pointerId(conversation.get('project')))
  ])
  setHeader(event, 'Cache-Control', 'no-store')
  return await loadConversationContext(ctx, project, conversation, endUser)
})
