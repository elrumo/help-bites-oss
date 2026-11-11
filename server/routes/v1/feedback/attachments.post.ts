import { createError, getHeader } from 'h3'

defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'uploadFeedbackAttachment', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Upload an image or file for a post or board item',
    description: 'Multipart field `file`: an image (PNG, JPEG, GIF, WebP; up to 8 MB), any other file (up to 25 MB) or an MP4/MOV video (up to 100 MB). Programs and scripts (.exe, .bat, .sh, .jar, .app and the like, or executable bytes under any name) are refused with 415. JSON clients, including MCP, may instead send `{ filename, contentBase64 }` (base64 encoded; same limits decoded) or `{ url, filename? }` (a public http(s) address HelpBites downloads once: no redirects, private addresses refused; use this for screenshots and recordings too large to send inline). For a file that only exists on the caller\'s machine, ask `POST …/attachments/ticket` for a one-time upload URL and `PUT` the raw bytes to it (no base64). Files are served as downloads under the type their extension implies (else application/octet-stream), never as HTML. Returns `{ url, name, mime, size }`; pass up to 10 of them as `attachments` when creating or editing posts or board items, or when posting a planning comment. A changelog entry shows images only. Operators pass `?project=<id>`; end users upload with their identity token, once their address is verified, and only where the project allows attachments. Counts against the workspace\'s storage.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators)' }],
    requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } }, 'application/json': { schema: { type: 'object', properties: { filename: { type: 'string', description: 'Required with contentBase64; taken from the url otherwise.' }, contentBase64: { type: 'string', description: 'Base64 encoded file bytes. Send this or url.' }, url: { type: 'string', description: 'A public http(s) address to download the file from. Send this or contentBase64.' } } } } } },
    responses: { 200: { description: 'The stored file.', content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: { type: 'integer' } } } } } }, 401: { description: 'Sign in to upload.' }, 402: { description: 'The workspace\'s storage is full.' }, 403: { description: 'Attachments are off for this project.' }, 413: { description: 'Too large.' }, 502: { description: 'The `url` could not be downloaded.' }, 415: { description: 'A program or script, which cannot be attached.' }, 429: { description: 'Rate limited.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveFeedbackContext(event, { requireActor: true })
  const owner = uploadOwnerOf(ctx)
  await rateLimit(`sb:rl:upload:${ctx.project.id}:${owner}`, LIMITS.uploadsPerUser.limit, LIMITS.uploadsPerUser.window)
  const file = String(getHeader(event, 'content-type') || '').toLowerCase().includes('application/json')
    ? await readJsonItemUpload((await readBody(event).catch(() => ({})) || {}) as Record<string, unknown>)
    : await readUploadedFile(event)
  return await storeItemFile(file, ctx.project.id || '', owner)
})
