import { sendStream, setResponseHeaders } from 'h3'

defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    operationId: 'exportTransfer',
    summary: 'Export a workspace or project to move it',
    description: 'Streams everything another HelpBites can import, as one gzipped JSON Lines file: the whole workspace, or with `project` that project alone. Credentials (project secrets, webhook secrets, Stripe and database keys, API key hashes) and files in the bucket are left out. This is what "Import from another HelpBites" pulls, and the same file can be imported from disk. Owners and admins; an API key limited to some projects is refused.',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'project', in: 'query', required: false, schema: { type: 'string' }, description: 'A project id; leave out for the whole workspace.' }],
    responses: { 200: { description: 'The export, a gzipped JSON Lines file (`application/gzip`).' }, 403: { description: 'Not an owner or admin, or the workspace is being deleted.' }, 404: { description: 'No such project.' }, 429: { description: 'More than 20 exports in an hour.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.export', allowInactive: true })
  if (['deleting', 'deleted'].includes(String(ctx.workspace.get('status') || ''))) throw createError({ statusCode: 403, statusMessage: 'This workspace is being deleted', data: { code: 'workspace_suspended' } })
  const projectId = String(getQuery(event).project || '')
  if (projectId) await requireProject(ctx, projectId)
  await rateLimit(`sb:rl:export-stream:${ctx.workspaceId}`, 20, 3600)
  await audit({ action: 'workspace.export', actor: ctx.agent, workspace: ctx.workspace, target: projectId || undefined, data: { via: 'download' }, ip: clientIp(event) })
  setResponseHeaders(event, {
    'Content-Type': 'application/gzip',
    'Content-Disposition': `attachment; filename="helpbites-${projectId ? 'project' : 'workspace'}-${new Date().toISOString().slice(0, 10)}.jsonl.gz"`,
    'Cache-Control': 'private, no-store'
  })
  return sendStream(event, portableExport(ctx.workspaceId, projectId))
})
