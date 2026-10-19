defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Export this workspace\'s data',
    description: 'Queues an export of everything the workspace holds as one gzipped JSON Lines file: a `{ format: "helpbites-export", version: 1, workspaceId, exportedAt }` line, then one `{ class, data }` line per row. Credentials (project secrets, webhook secrets, sealed values, API key and invitation hashes) are left out. When it is ready, you get an email with a download link that works for 7 days; `GET /v1/admin/workspace/export` links the latest one. Owners and admins; also while the workspace is suspended.',
    responses: { 202: { description: '`{ queued: true }`' }, 403: { description: 'Not an owner or admin, or the workspace is being deleted.' }, 429: { description: 'More than 5 exports in an hour.' }, 503: { description: 'The server has no file storage (S3) set up.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.export', allowInactive: true })
  await requestWorkspaceExport(ctx, clientIp(event))
  setResponseStatus(event, 202)
  return { queued: true }
})
