defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'uploadCmsAsset', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Upload a file',
    description: 'Multipart: `project` and `file` (PNG, JPEG, GIF, WebP, SVG, ICO, PDF, MP4 or WebM, up to 20 MB; the type is read from the bytes), and optionally `compress` (`true`: a PNG, JPEG or WebP is re-encoded smaller as WebP and scaled down to 2560 px when that helps; default off), `formats` (`avif`, `webp` or `avif,webp`: also store those modern formats of a PNG, JPEG or WebP next to the file, whose own `url` becomes a fallback every browser reads; they are listed as the asset\'s `variants`, for a `<picture>`), `name` (the file name by default) and `alt` (the text for people who cannot see it). SVGs with scripts or embedded content are refused. The file is public at its `url`, and its bytes count against the workspace\'s storage.',
    responses: { 200: { description: '`{ asset }`' }, 400: { description: 'Missing project or file.' }, 402: { description: 'The workspace\'s storage is full.' }, 413: { description: 'Larger than 20 MB.' }, 415: { description: 'Not an accepted type.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const parts = (await readMultipartFormData(event)) || []
  const fields = Object.fromEntries(parts.filter(p => !p.filename && p.name).map(p => [p.name!, p.data.toString('utf8')]))
  const file = parts.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Send the file as multipart field "file"' })
  const project = await cmsProject(ctx, event, fields)
  const row = await createCmsAsset(project, ctx.workspaceId, { filename: String(file.filename || 'file'), mime: String(file.type || ''), data: Buffer.from(file.data) }, fields)
  return { asset: serializeCmsAsset(row) }
})
