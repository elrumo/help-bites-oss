import type { H3Event } from 'h3'

defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'uploadCmsAsset', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Upload a file',
    description: 'Multipart: `project` and `file` (PNG, JPEG, GIF, WebP, SVG, ICO, PDF, MP4 or WebM, up to 20 MB; the type is read from the bytes), and optionally `compress` (`true`: a PNG, JPEG or WebP is re-encoded smaller as WebP and scaled down to 2560 px when that helps; default off), `formats` (`avif`, `webp` or `avif,webp`: also store those modern formats of a PNG, JPEG or WebP next to the file, whose own `url` becomes a fallback every browser reads; they are listed as the asset\'s `variants`, for a `<picture>`), `name` (the file name by default) and `alt` (the text for people who cannot see it). JSON clients, including MCP, send the same fields with the file as `contentBase64` (base64 encoded) or as `url` (a public http(s) address HelpBites downloads once; no redirects, private addresses refused), plus `filename` (taken from the URL when left out). SVGs with scripts or embedded content are refused. The file is public at its `url`, and its bytes count against the workspace\'s storage.',
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': { schema: { type: 'object', required: ['project', 'file'], properties: { project: { type: 'string' }, file: { type: 'string', format: 'binary' }, name: { type: 'string' }, alt: { type: 'string' }, compress: { type: 'string' }, formats: { type: 'string' } } } },
        'application/json': { schema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, contentBase64: { type: 'string', description: 'Base64 encoded file bytes. Send this or url.' }, url: { type: 'string', description: 'A public http(s) address to download the file from. Send this or contentBase64.' }, filename: { type: 'string' }, name: { type: 'string' }, alt: { type: 'string' }, compress: { type: 'boolean' }, formats: { type: 'string' } } } }
      }
    },
    responses: { 200: { description: '`{ asset }`' }, 400: { description: 'Missing project or file.' }, 402: { description: 'The workspace\'s storage is full.' }, 413: { description: 'Larger than 20 MB.' }, 415: { description: 'Not an accepted type.' }, 502: { description: 'The `url` could not be downloaded.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const json = String(getHeader(event, 'content-type') || '').toLowerCase().includes('application/json')
  const { fields, file } = json ? await readJsonCmsUpload((await readBody(event).catch(() => ({})) || {}) as Record<string, unknown>) : await readMultipartAsset(event)
  const project = await cmsProject(ctx, event, fields)
  const row = await createCmsAsset(project, ctx.workspaceId, file, fields)
  return { asset: serializeCmsAsset(row) }
})

async function readMultipartAsset(event: H3Event) {
  const parts = (await readMultipartFormData(event)) || []
  const fields = Object.fromEntries(parts.filter(p => !p.filename && p.name).map(p => [p.name!, p.data.toString('utf8')]))
  const file = parts.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Send the file as multipart field "file"' })
  return { fields, file: { filename: String(file.filename || 'file'), mime: String(file.type || ''), data: Buffer.from(file.data) } }
}

