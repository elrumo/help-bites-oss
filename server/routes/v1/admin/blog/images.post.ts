defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'uploadBlogImage', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Upload an image for a post',
    description: 'Multipart fields `file` (PNG, JPEG, GIF or WebP, up to 8 MB) and `project`, and optionally `compress` (`true`: re-encode it as WebP at quality 80 and scale it down to 2560 px, when that makes it smaller; a GIF is kept; default off) or `formats` (`avif`, `webp` or `avif,webp`: store a set for a `<picture>` instead, the modern formats that came out smaller and a fallback every browser reads, a JPEG for a JPEG and a PNG otherwise; implies `compress`). Both can be fields or query parameters. Returns its public URL, for the body (`![alt](url)`) or `coverImageUrl`, with `mime`, `size` and, when asked, `compressed` and `originalSize`; with `formats`, `url` is the fallback, `variants` lists every file (most efficient first, the fallback last) and `picture` is a ready-made `<picture>` for an HTML post (the body allows `picture` and `source`). It counts against the workspace\'s storage (every file stored).',
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
  return storeAttachment(Buffer.from(file.data), project.id || '', 'blog', ctx.workspaceId, { compress: await wantsCompression(event), formats: await requestedFormats(event) })
})
