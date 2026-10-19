defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Upload an image for a reply',
    description: 'Multipart fields `file` and `conversationId` (the attachment is stored under that conversation\'s project).',
    responses: { 200: { description: '{ url, mime, size }' }, 402: { description: 'The workspace\'s storage is full.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const parts = await readMultipartFormData(event)
  const conversationId = parts?.find(p => p.name === 'conversationId')?.data?.toString('utf8') || ''
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!conversationId || !file) throw createError({ statusCode: 400, statusMessage: 'Send multipart fields "file" and "conversationId"' })
  const conversation = await scoped.conversation(ctx, conversationId)
  return storeAttachment(Buffer.from(file.data), pointerId(conversation.get('project')), `agent-${ctx.agentId}`)
})
