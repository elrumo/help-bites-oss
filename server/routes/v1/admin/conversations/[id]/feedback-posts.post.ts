import { readFeedbackLinkInput } from '#shared/conversationHub'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Link, unlink or file a feedback post for a conversation',
    description: 'Send `{ postId, linked }` to link (default) or unlink an existing post (an id or `#12`), or `{ create: { title, body?, type? } }` to file a new post written by the requester and link it. The requester follows what is linked, so they hear when it ships; pass `follow: false` to link without that. A contact without a user id (`externalId`) cannot follow: linking still works (`following: false`), filing a new post is refused with 409. Every change (not a repeat) adds a line to the conversation\'s timeline and emits `conversation.feedback_linked` with `linked` true or false; unlinking leaves the requester following. A conversation links at most 20 posts.',
    operationId: 'changeConversationFeedbackLink',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'conv_123' } }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
      postId: { type: 'string', example: '#12' }, linked: { type: 'boolean', default: true }, follow: { type: 'boolean', default: true },
      create: { type: 'object', required: ['title'], properties: { title: { type: 'string', maxLength: 200 }, body: { type: 'string', maxLength: 20000 }, type: { type: 'string', example: 'feature', description: 'A type key the feedback board defines.' } } }
    }, example: { create: { title: 'Export bookmarks as CSV', body: 'Asked for in the support chat.', type: 'feature' } } } } } },
    responses: {
      200: { description: '`{ feedbackPostIds, post, linked, created, following }`: the conversation\'s linked ids after the change and the post as the panel shows it.' },
      400: { description: 'Invalid body, or the conversation already links 20 posts.' },
      404: { description: 'Conversation or post not found.' },
      409: { description: 'The contact has no user id, so cannot author a new post.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'inbox' })
  const conversation = await scoped.conversation(ctx, getRouterParam(event, 'id') || '')
  const { input, errors } = readFeedbackLinkInput(await readBody(event).catch(() => ({})))
  if (!input) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  const [endUser, project] = await Promise.all([
    (conversation.get('endUser') as ParseObject).fetch(MASTER),
    requireProject(ctx, pointerId(conversation.get('project')))
  ])
  return await changeFeedbackLink(project, conversation, endUser, ctx.agent, input)
})
