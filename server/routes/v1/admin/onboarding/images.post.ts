defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'uploadOnboardingImage', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Upload a picture for an onboarding step',
    description: 'Multipart fields `project` and `file` (PNG, JPEG, GIF or WebP, up to 8 MB), and optionally `compress` (`true`: re-encode it smaller as WebP; default off). Returns the stored image `{ url, mime, size }` (and `compressed`, `originalSize` when asked); put the url in a step\'s `imageUrl`. It counts against the workspace\'s storage.',
    responses: { 200: { description: '`{ url, mime, size }`' }, 400: { description: 'Missing project or file.' }, 402: { description: 'The workspace\'s storage is full.' }, 413: { description: 'Larger than 8 MB.' }, 415: { description: 'Not an accepted image type.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const parts = (await readMultipartFormData(event)) || []
  const projectId = parts.find(p => p.name === 'project')?.data?.toString('utf8') || ''
  const file = parts.find(p => p.name === 'file' && p.data?.length)
  if (!projectId || !file) throw createError({ statusCode: 400, statusMessage: 'Send multipart fields "file" and "project"' })
  const project = await requireProject(ctx, projectId)
  return storeAttachment(Buffer.from(file.data), project.id || '', 'onboarding', ctx.workspaceId, { compress: await wantsCompression(event) })
})
