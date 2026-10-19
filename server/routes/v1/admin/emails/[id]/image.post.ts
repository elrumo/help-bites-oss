defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'uploadEmailImage', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Upload an image for an email template',
    description: 'Multipart field `file` (PNG/JPEG/GIF/WebP, ≤8 MB). Returns the stored image `{ url, mime, size }`; set the url as an image block\'s `src`. Not for linked masters.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ url, mime, size }`' }, 400: { description: 'No file, or a linked master.' }, 402: { description: 'The workspace\'s storage is full.' }, 415: { description: 'Not an accepted image type.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  await rateLimit(`sb:rl:emailimg:${ctx.agentId}`, LIMITS.emailImagesPerAgent.limit, LIMITS.emailImagesPerAgent.window)
  const row = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  if (row.get('master')) throw createError({ statusCode: 400, statusMessage: 'A linked master is designed in the master itself' })
  const data = await readUploadedImage(event)
  // A project's images sit with its other uploads; a master's under its own id.
  const projectId = pointerId(row.get('project'))
  return projectId ? storeAttachment(data, projectId, 'emails', ctx.workspaceId) : storeAttachment(data, 'emails', row.id || '', ctx.workspaceId)
})
