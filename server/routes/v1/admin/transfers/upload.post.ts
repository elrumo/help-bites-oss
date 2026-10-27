import { getRequestWebStream } from 'h3'

defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    operationId: 'importFromFile',
    summary: 'Import an export file',
    description: 'Queues a background import of an export file (the request body, gzipped or plain JSON Lines, up to 2 GB; send `Content-Length`) into this workspace as new projects. Accepts files from `GET /v1/admin/transfers/export` and the workspace export email. Needs file storage (S3). If the import fails, nothing it created is left behind. Poll `GET /v1/admin/transfers`. Owners and admins.',
    security: [{ bearerAuth: [] }],
    requestBody: { content: { 'application/gzip': { schema: { type: 'string', format: 'binary' } }, 'application/x-ndjson': { schema: { type: 'string', format: 'binary' } } } },
    responses: { 202: { description: 'The queued import.' }, 400: { description: 'No file.' }, 409: { description: 'An import is already running here.' }, 413: { description: 'Over 2 GB.' }, 503: { description: 'The server has no file storage (S3).' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.export' })
  assertSession(ctx)
  const row = await queueUpload(ctx, getRequestWebStream(event) ?? null, Number(getHeader(event, 'content-length') || 0), clientIp(event))
  setResponseStatus(event, 202)
  return serializeTransfer(row)
})
