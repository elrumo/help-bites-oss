import { createError, getHeader, getRouterParam, readRawBody } from 'h3'
import { formatLimit, itemFileMaxBytes } from '#shared/itemAttachments'

defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'putFeedbackAttachment', security: [],
    summary: 'Upload a file as raw bytes to a ticket URL',
    description: 'The body is the file itself, not encoded and not multipart. The path token (from `POST /v1/feedback/attachments/ticket`) is the credential and fixes the project and filename; it expires after 15 minutes. Same limits, type rules and storage accounting as `POST /v1/feedback/attachments`. Returns `{ url, name, mime, size }`.',
    parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { required: true, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
    responses: { 200: { description: 'The stored file.', content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: { type: 'integer' } } } } } }, 400: { description: 'Empty body.' }, 401: { description: 'The ticket is invalid or expired; ask for another.' }, 402: { description: 'The workspace\'s storage is full.' }, 413: { description: 'Too large.' }, 415: { description: 'A program or script, which cannot be attached.' }, 429: { description: 'Rate limited.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ticket = readUploadTicket(getRouterParam(event, 'token') || '')
  if (!ticket) throw createError({ statusCode: 401, statusMessage: 'This upload link is invalid or expired; ask for a new one' })
  const limit = itemFileMaxBytes(ticket.filename)
  // Refuse a body that declares itself too big before reading it.
  if (Number(getHeader(event, 'content-length') || 0) > limit) throw createError({ statusCode: 413, statusMessage: `File is larger than ${formatLimit(limit)}` })
  await rateLimit(`sb:rl:upload:${ticket.projectId}:${ticket.owner}`, LIMITS.uploadsPerUser.limit, LIMITS.uploadsPerUser.window)
  const data = await readRawBody(event, false)
  if (!data?.length) throw createError({ statusCode: 400, statusMessage: 'Send the file bytes as the request body' })
  if (data.length > limit) throw createError({ statusCode: 413, statusMessage: `File is larger than ${formatLimit(limit)}` })
  return await storeItemFile({ filename: ticket.filename, data: Buffer.from(data) }, ticket.projectId, ticket.owner)
})
