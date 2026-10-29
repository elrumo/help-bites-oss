import { readTransferFiles } from '#shared/transfer'

defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Export this workspace\'s data',
    description: 'Queues an export of everything the workspace holds as one gzipped JSON Lines file: a `{ format: "helpbites-export", version: 1, workspaceId, exportedAt }` line, then one `{ class, data }` line per row. It is the same file as `GET /v1/admin/transfers/export`, made in the background for a workspace too large to stream. Send `files: "binary"` to put the uploaded files inside it (needs `S3_PUBLIC_URL`; the default `urls` keeps links) and `secrets: true` to include credentials and connections in plain text; without them credentials (project secrets, webhook secrets, sealed values) are left out, and API key and invitation hashes never leave. When it is ready, you get an email with a download link that works for 7 days; `GET /v1/admin/workspace/export` links the latest one. Owners and admins; also while the workspace is suspended.',
    requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: {
      files: { type: 'string', enum: ['urls', 'binary'], default: 'urls' },
      secrets: { type: 'boolean', default: false }
    } } } } },
    responses: { 202: { description: '`{ queued: true }`' }, 403: { description: 'Not an owner or admin, or the workspace is being deleted.' }, 429: { description: 'More than 5 exports in an hour.' }, 400: { description: '`files: "binary"` on a server without `S3_PUBLIC_URL`.' }, 503: { description: 'The server has no file storage (S3) set up.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.export', allowInactive: true })
  const body = (await readBody(event).catch(() => ({}))) as { files?: unknown, secrets?: unknown }
  await requestWorkspaceExport(ctx, clientIp(event), { files: readTransferFiles(body?.files), secrets: body?.secrets === true })
  setResponseStatus(event, 202)
  return { queued: true }
})
