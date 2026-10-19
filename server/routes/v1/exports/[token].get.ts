import { sendStream, setResponseHeaders } from 'h3'

defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Download a workspace export',
    description: 'The signed link from the export email or the Workspace settings. It opens one export file and expires (7 days from the email, an hour from the settings).',
    parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The export, a gzipped JSON Lines file.' }, 404: { description: 'An unknown or expired link, or the file is gone.' } }
  }
})

export default defineEventHandler(async (event) => {
  const key = readExportDownload(getRouterParam(event, 'token') || '')
  if (!key) throw createError({ statusCode: 404, statusMessage: 'This download link has expired; ask for a new export' })
  const stream = await readObjectStream(key).catch(() => null)
  if (!stream) throw createError({ statusCode: 404, statusMessage: 'This export is no longer available; ask for a new one' })
  setResponseHeaders(event, {
    'Content-Type': 'application/gzip',
    'Content-Disposition': `attachment; filename="helpbites-export-${key.split('/').pop()}"`,
    'Cache-Control': 'private, no-store'
  })
  return sendStream(event, stream as never)
})
