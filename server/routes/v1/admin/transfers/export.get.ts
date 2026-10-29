import { sendStream, setResponseHeaders } from 'h3'
import { readTransferFiles } from '#shared/transfer'

defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    operationId: 'exportTransfer',
    summary: 'Export a workspace or project to move it',
    description: 'Streams everything the workspace holds, as one gzipped JSON Lines file another HelpBites can import (with `include=importable`, only what an import can use): the whole workspace, or with `project` that project alone. Uploaded files (message attachments, logos, brand and CMS files, lead form uploads, knowledge originals) travel as the links they have (`files=urls`, the default) or inside the file (`files=binary`, which needs file storage here and makes a much larger file). Credentials (project secrets, webhook and Stripe keys, database connections, AI provider keys) are left out unless `secrets=1`; then they are in the file in plain text, so keep it safe. Password and API key hashes never leave. This is what "Import from another HelpBites" pulls, and the same file can be imported from disk. Owners and admins; an API key limited to some projects is refused.',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'project', in: 'query', required: false, schema: { type: 'string' }, description: 'A project id; leave out for the whole workspace.' },
      { name: 'files', in: 'query', required: false, schema: { type: 'string', enum: ['urls', 'binary'], default: 'urls' }, description: '`urls` keeps links to the files in this instance\'s bucket; `binary` puts the files themselves in the export.' },
      { name: 'include', in: 'query', required: false, schema: { type: 'string', enum: ['all', 'importable'], default: 'all' }, description: '`all` is the whole archive, including what an import cannot take in (team list, usage, domains); `importable` is only what another HelpBites can use, which is what a pull asks for.' },
      { name: 'secrets', in: 'query', required: false, schema: { type: 'string', enum: ['0', '1'], default: '0' }, description: '`1` includes credentials and connections (Stripe, contact databases, webhook secrets, AI keys, project secrets).' }
    ],
    responses: { 200: { description: 'The export, a gzipped JSON Lines file (`application/gzip`).' }, 403: { description: 'Not an owner or admin, or the workspace is being deleted.' }, 400: { description: '`files=binary` on a server without file storage.' }, 404: { description: 'No such project.' }, 429: { description: 'More than 20 exports in an hour.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.export', allowInactive: true })
  if (['deleting', 'deleted'].includes(String(ctx.workspace.get('status') || ''))) throw createError({ statusCode: 403, statusMessage: 'This workspace is being deleted', data: { code: 'workspace_suspended' } })
  const query = getQuery(event)
  const projectId = String(query.project || '')
  const options = { files: readTransferFiles(query.files), secrets: query.secrets === '1' || query.secrets === 'true', all: query.include !== 'importable' }
  if (options.files === 'binary' && (!s3Configured() || !process.env.S3_PUBLIC_URL)) throw createError({ statusCode: 400, statusMessage: 'Exporting the files themselves needs file storage: set the server\'s S3_* settings and S3_PUBLIC_URL' })
  if (projectId) await requireProject(ctx, projectId)
  await rateLimit(`sb:rl:export-stream:${ctx.workspaceId}`, 20, 3600)
  await audit({ action: 'workspace.export', actor: ctx.agent, workspace: ctx.workspace, target: projectId || undefined, data: { via: 'download', files: options.files, secrets: options.secrets, all: options.all }, ip: clientIp(event) })
  setResponseHeaders(event, {
    'Content-Type': 'application/gzip',
    'Content-Disposition': `attachment; filename="helpbites-${projectId ? 'project' : 'workspace'}-${new Date().toISOString().slice(0, 10)}.jsonl.gz"`,
    'Cache-Control': 'private, no-store'
  })
  return sendStream(event, portableExport(ctx.workspaceId, projectId, options))
})
