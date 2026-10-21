defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'uploadBlogImage', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Upload an image for a post',
    description: 'Multipart fields `file` (PNG, JPEG, GIF or WebP, up to 8 MB) and `project`. Returns its public URL, for the body (`![alt](url)`) or `coverImageUrl`. It counts against the workspace\'s storage.',
    responses: { 200: { description: '`{ url, mime, size }`', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Attachment' } } } }, 400: { description: 'No file or project.' }, 402: { description: 'The workspace\'s storage is full.' }, 413: { description: 'Larger than 8 MB.' }, 415: { description: 'Not an image.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const parts = await readMultipartFormData(event)
  const projectId = parts?.find(p => p.name === 'project')?.data?.toString('utf8') || String(getQuery(event).project || '')
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!projectId || !file) throw createError({ statusCode: 400, statusMessage: 'Send multipart fields "file" and "project"' })
  const project = await requireProject(ctx, projectId)
  await rateLimit(`sb:rl:blogimage:${ctx.agentId}`, LIMITS.emailImagesPerAgent.limit, LIMITS.emailImagesPerAgent.window)
  return storeAttachment(Buffer.from(file.data), project.id || '', 'blog', ctx.workspaceId)
})
