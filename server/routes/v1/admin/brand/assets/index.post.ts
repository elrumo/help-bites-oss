defineRouteMeta({
  openAPI: {
    tags: ['Brand'], operationId: 'uploadBrandAsset', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Add a file to the brand kit',
    description: 'Multipart: `project` and `file` (PNG, JPEG, GIF, WebP, SVG, ICO or PDF, up to 20 MB; the type is read from the bytes), and optionally `kind` (logo, icon, favicon, screenshot, social, other; guessed from the image when left out), `name` (the file name by default), `description`, `background` (light, dark or any: what a logo is drawn to sit on) and `public` ("false" keeps it off the public page). SVGs with scripts or embedded content are refused. The bytes count against the workspace\'s storage.',
    responses: { 200: { description: '`{ asset }`' }, 400: { description: 'Missing project or file, or an invalid field.' }, 402: { description: 'The workspace\'s storage is full.' }, 413: { description: 'Larger than 20 MB.' }, 415: { description: 'Not an accepted type.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const parts = (await readMultipartFormData(event)) || []
  const fields = Object.fromEntries(parts.filter(p => !p.filename && p.name).map(p => [p.name!, p.data.toString('utf8')]))
  const file = parts.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Send the file as multipart field "file"' })
  const project = await brandProject(ctx, event, fields)
  const row = await createBrandAsset(project, ctx.workspaceId, { filename: String(file.filename || 'file'), mime: String(file.type || ''), data: Buffer.from(file.data) }, fields)
  await refreshBrandLook(project)
  return { asset: serializeBrandAsset(project, row) }
})
