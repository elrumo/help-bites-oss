defineRouteMeta({
  openAPI: {
    tags: ['End user'],
    summary: 'Upload an image',
    description: 'Multipart field `file`; PNG, JPEG, GIF or WebP up to 8 MB. Returns an attachment to pass in a message\'s `attachments`. Bearer: identity token.',
    operationId: 'uploadEndUserAttachment',
    security: [{ EndUserToken: [] }],
    requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary', description: 'PNG, JPEG, GIF, or WebP; maximum 8 MB.' } } } } } },
    responses: { 200: { description: 'Stored attachment.', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Attachment' } } } }, 402: { description: 'The workspace\'s storage is full.' }, 403: { description: 'Attachments are disabled for this project.' }, 413: { description: 'Too large' }, 415: { description: 'Not an accepted image' } }
  }
})

export default defineEventHandler(async (event) => {
  const { project, endUser, claims } = await requireEndUser(event, { ensure: true })
  // Anyone can mint an email-only session, and uploads cost storage: they wait for a verified address.
  requireVerifiedAnonymous(claims)
  if (project.get('allowAttachments') === false) throw createError({ statusCode: 403, statusMessage: 'Attachments are off for this project' })
  await rateLimit(`sb:rl:upload:${endUser!.id}`, LIMITS.uploadsPerUser.limit, LIMITS.uploadsPerUser.window)
  const data = await readUploadedImage(event)
  return storeAttachment(data, project.id || '', endUser!.id || '')
})
