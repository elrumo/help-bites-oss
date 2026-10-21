defineRouteMeta({
  openAPI: {
    tags: ['Brand'], operationId: 'getBrandKit', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Get a project\'s brand kit',
    description: 'The kit (tagline, about, colours, fonts, guidelines and the public page\'s settings) and every file in it, private ones included. `url` is the public page, which answers only while `brand.page.public` is on.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    responses: { 200: { description: '`{ brand, assets, url }`' }, 400: { description: 'Missing project.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await brandProject(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return {
    brand: brandConfigOf(project),
    assets: (await listBrandAssets(project)).map(row => serializeBrandAsset(project, row)),
    url: `/brand/${String(project.get('publicKey') || '')}`
  }
})
