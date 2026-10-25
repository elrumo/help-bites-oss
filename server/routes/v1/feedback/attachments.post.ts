import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'uploadFeedbackAttachment', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Upload an image or file for a post or board item',
    description: 'Multipart field `file`: an image (PNG, JPEG, GIF, WebP; up to 8 MB) or a PDF, text, CSV, JSON, ZIP, Office document or MP4/MOV video (up to 25 MB). Files are served as downloads under the type their extension implies, never as HTML. Returns `{ url, name, mime, size }`; pass up to 10 of them as `attachments` when you create or edit a post (`POST /v1/feedback`, `PATCH /v1/feedback/:id`) or a board item (`POST /v1/admin/board-items`, `PATCH /v1/admin/board-items/:id`). A changelog entry shows images only: pass PNG, JPEG, GIF or WebP uploads as its `images` (`POST /v1/admin/changelog/entries`, `PATCH /v1/admin/changelog/entries/:id`). Operators pass `?project=<id>` and use this route for board items too. End users upload with their identity token, once their address is verified, and only where the project allows attachments. Counts against the workspace\'s storage.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators)' }],
    requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } } },
    responses: { 200: { description: 'The stored file.', content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: { type: 'integer' } } } } } }, 401: { description: 'Sign in to upload.' }, 402: { description: 'The workspace\'s storage is full.' }, 403: { description: 'Attachments are off for this project.' }, 413: { description: 'Too large.' }, 415: { description: 'Not an accepted type.' }, 429: { description: 'Rate limited.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveFeedbackContext(event, { requireActor: true })
  let owner = ''
  if (ctx.actor.kind === 'agent') owner = `agent-${ctx.actor.agent.id}`
  else if (ctx.actor.kind === 'user') {
    // Anyone can mint an email-only session, and uploads cost storage: they wait for a verified address.
    requireVerifiedAnonymous(ctx.actor.claims)
    if (ctx.project.get('allowAttachments') === false) throw createError({ statusCode: 403, statusMessage: 'Attachments are off for this project' })
    // The host's user id can hold any character; keys get a hash of it.
    owner = `u-${createHash('sha1').update(ctx.actor.externalId).digest('hex').slice(0, 16)}`
  }
  await rateLimit(`sb:rl:upload:${ctx.project.id}:${owner}`, LIMITS.uploadsPerUser.limit, LIMITS.uploadsPerUser.window)
  return await storeItemFile(await readUploadedFile(event), ctx.project.id || '', owner)
})
