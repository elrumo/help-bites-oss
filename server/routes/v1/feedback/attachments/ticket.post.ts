import { getRequestURL } from 'h3'
import { formatLimit, itemFileMaxBytes } from '#shared/itemAttachments'

defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'createFeedbackAttachmentTicket', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Get a URL to upload a file to as raw bytes',
    description: 'For a file that is too big for base64 and is not at a public address: ask for a ticket naming the file, then `PUT` the raw bytes to `uploadUrl` (`curl -T ./shot.png "<uploadUrl>"`, no Authorization header, no encoding). The `PUT` answers with the same `{ url, name, mime, size }` as `POST /v1/feedback/attachments`, to pass in `attachments` on planning items, comments and feedback posts. The URL works for 15 minutes, for this project and filename only; same limits and checks as the other upload forms. Operators pass `?project=<id>`.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators)' }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['filename'], properties: { filename: { type: 'string', example: 'new-icon.png', description: 'The file name with its extension: it decides the type, and the size limit.' } } } } } },
    responses: { 200: { description: 'Where to PUT the file.', content: { 'application/json': { schema: { type: 'object', properties: { uploadUrl: { type: 'string' }, method: { type: 'string', example: 'PUT' }, expiresAt: { type: 'string', format: 'date-time' }, maxBytes: { type: 'integer' }, curl: { type: 'string' } } } } } }, 400: { description: 'No filename.' }, 401: { description: 'Sign in to upload.' }, 403: { description: 'Attachments are off for this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveFeedbackContext(event, { requireActor: true })
  const owner = uploadOwnerOf(ctx)
  const body = (await readBody(event).catch(() => ({})) || {}) as Record<string, unknown>
  const filename = typeof body.filename === 'string' ? body.filename.trim().slice(0, 200) : ''
  if (!filename) throw createError({ statusCode: 400, statusMessage: 'Send filename' })
  const { token, expiresAt } = mintUploadTicket({ projectId: ctx.project.id || '', owner, filename })
  const origin = (process.env.APP_URL || getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin).replace(/\/+$/, '')
  const uploadUrl = `${origin}/v1/feedback/attachments/upload/${token}`
  return {
    uploadUrl, method: 'PUT', expiresAt: expiresAt.toISOString(), maxBytes: itemFileMaxBytes(filename),
    curl: `curl -T '<path to ${filename}>' '${uploadUrl}'`,
    note: `Send the file bytes with PUT, up to ${formatLimit(itemFileMaxBytes(filename))}. The reply is the attachment object to pass in \`attachments\`.`
  }
})
