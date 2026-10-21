defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'downloadLeadFile', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Download a file sent through a lead form',
    description: 'The file as it was sent, always as an attachment. Nobody else can reach it: the stored object has no public link.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The file' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const row = await scoped.leadFile(ctx, getRouterParam(event, 'id') || '')
  const data = await readLeadFile(row)
  const name = String(row.get('name') || 'file')
  setHeader(event, 'Content-Type', String(row.get('mime') || 'application/octet-stream'))
  setHeader(event, 'Content-Disposition', `attachment; filename="${name.replace(/[^\w.\- ()]+/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Cache-Control', 'private, no-store')
  return data
})
