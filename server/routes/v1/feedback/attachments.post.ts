import { createHash } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { formatLimit, ITEM_VIDEO_MAX_BYTES, itemFileMaxBytes } from '#shared/itemAttachments'

defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'uploadFeedbackAttachment', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Upload an image or file for a post or board item',
    description: 'Multipart field `file`: an image (PNG, JPEG, GIF, WebP; up to 8 MB), any other file (up to 25 MB) or an MP4/MOV video (up to 100 MB). Programs and scripts (.exe, .bat, .sh, .jar, .app and the like, or executable bytes under any name) are refused with 415. JSON clients, including MCP, may instead send `{ filename, contentBase64 }` (base64 encoded; same limits decoded). Files are served as downloads under the type their extension implies (else application/octet-stream), never as HTML. Returns `{ url, name, mime, size }`; pass up to 10 of them as `attachments` when creating or editing posts or board items, or when posting a planning comment. A changelog entry shows images only. Operators pass `?project=<id>`; end users upload with their identity token, once their address is verified, and only where the project allows attachments. Counts against the workspace\'s storage.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators)' }],
    requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } }, 'application/json': { schema: { type: 'object', required: ['filename', 'contentBase64'], properties: { filename: { type: 'string' }, contentBase64: { type: 'string', description: 'Base64 encoded file bytes.' } } } } } },
    responses: { 200: { description: 'The stored file.', content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: { type: 'integer' } } } } } }, 401: { description: 'Sign in to upload.' }, 402: { description: 'The workspace\'s storage is full.' }, 403: { description: 'Attachments are off for this project.' }, 413: { description: 'Too large.' }, 415: { description: 'A program or script, which cannot be attached.' }, 429: { description: 'Rate limited.' } }
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
  const file = String(getHeader(event, 'content-type') || '').toLowerCase().includes('application/json')
    ? await readBase64Upload(event)
    : await readUploadedFile(event)
  return await storeItemFile(file, ctx.project.id || '', owner)
})

async function readBase64Upload(event: H3Event): Promise<{ filename: string, data: Buffer }> {
  const input = (await readBody(event).catch(() => ({})) || {}) as Record<string, unknown>
  const filename = typeof input.filename === 'string' ? input.filename.trim() : ''
  const encoded = typeof input.contentBase64 === 'string' ? input.contentBase64 : ''
  if (!filename || !encoded) throw createError({ statusCode: 400, statusMessage: 'Send filename and contentBase64' })
  if (encoded.length > Math.ceil(ITEM_VIDEO_MAX_BYTES * 4 / 3) + 4) throw createError({ statusCode: 413, statusMessage: `File is larger than ${formatLimit(ITEM_VIDEO_MAX_BYTES)}` })
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw createError({ statusCode: 400, statusMessage: 'contentBase64 must be valid base64' })
  const data = Buffer.from(encoded, 'base64')
  if (!data.length || data.toString('base64') !== encoded) throw createError({ statusCode: 400, statusMessage: 'contentBase64 must be valid base64' })
  const limit = itemFileMaxBytes(filename)
  if (data.length > limit) throw createError({ statusCode: 413, statusMessage: `File is larger than ${formatLimit(limit)}` })
  return { filename, data }
}
