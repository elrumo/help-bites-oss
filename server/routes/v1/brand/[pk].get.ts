defineRouteMeta({
  openAPI: {
    tags: ['Brand'], operationId: 'getPublicBrandKit', security: [],
    summary: 'Read a public brand kit',
    description: 'Public, no sign-in: `pk` is the project\'s public key. Returns the name, tagline, about text, accent, colours, fonts, guidelines (Markdown `body` and sanitised `html`), the public files (each with its `url` in the bucket and a `downloadUrl` that saves it under its name) and the page\'s `url`. Open to any origin, so your own site can build its press page from it. 404 unless the kit\'s page is public.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ brand }`' }, 404: { description: 'Unknown project, or the kit is not public.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await publicBrandProject(event)
  setHeader(event, 'Cache-Control', 'public, max-age=60')
  const assets = (await listBrandAssets(project, true)).map(row => serializeBrandAsset(project, row))
  return { brand: toPublicBrand(project, brandConfigOf(project), assets) }
})
