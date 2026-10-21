defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'listCmsAssets', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List files',
    description: 'The project\'s files, newest first. Each is `{ id, name, alt, url, mime, size, width, height }`; put it (or just `{ id, url, alt }`) in an asset field.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    responses: { 200: { description: '`{ assets }`' }, 400: { description: 'Missing project.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await cmsProject(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { assets: (await listCmsAssets(project)).map(serializeCmsAsset) }
})
