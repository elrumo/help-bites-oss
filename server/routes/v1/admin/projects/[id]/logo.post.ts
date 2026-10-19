defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Upload a project logo',
    description: 'Multipart field `file` (PNG/JPEG/GIF/WebP, ≤8 MB). Returns the stored image `{ url, mime, size }`; save the url onto the project as `brandLogoUrl`, `assistantLogoUrl` or `iconUrl`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ url, mime, size }' }, 402: { description: 'The workspace\'s storage is full.' }, 415: { description: 'Not an accepted image type.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const data = await readUploadedImage(event)
  // Stored under the project so its public URL is namespaced with the others.
  return storeAttachment(data, project.id || '', 'brand')
})
