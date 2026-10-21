import { readConversationFaqInput } from '#shared/conversationHub'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Save an answer from a conversation as an FAQ',
    description: 'Creates an active FAQ (origin `conversation`, the conversation\'s id kept as `conversationId`) in a knowledge model, so assistants can use the answer. `modelId` is the operator\'s pick; left out, the first model the conversation\'s assistant (else the project\'s assistants) reads. Counts against the plan\'s FAQ limit.',
    operationId: 'saveConversationFaq',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['question', 'answer'], properties: {
      modelId: { type: 'string' }, question: { type: 'string', maxLength: 500, example: 'How do I export my data?' }, answer: { type: 'string', maxLength: 20000, example: 'Open Settings, Data, then choose Export.' }
    } } } } },
    responses: {
      200: { description: '`{ faq }`' },
      400: { description: 'Missing or too long question or answer, or a model of another project.' },
      402: { description: 'The plan\'s FAQ limit is reached.' },
      404: { description: 'Conversation or knowledge model not found.' },
      409: { description: 'The workspace has no knowledge model yet.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const { input, errors } = readConversationFaqInput(await readBody(event).catch(() => ({})))
  if (!input) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  const project = await requireProject(ctx, pointerId(conversation.get('project')))
  const faq = await saveConversationFaq(ctx, project, conversation, input)
  return { faq: serializeFaq(await scoped.faq(ctx, faq.id || '')) }
})
