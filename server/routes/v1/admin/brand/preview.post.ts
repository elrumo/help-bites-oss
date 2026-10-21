import { validateBrandConfig } from '#shared/brand'

defineRouteMeta({
  openAPI: {
    tags: ['Brand'], operationId: 'previewBrandPage', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Render the brand page with unsaved changes',
    description: 'Returns the public page\'s HTML for the kit as saved with `brand` (a partial kit, as for PATCH) applied on top, private files left out as the public page leaves them out. Nothing is saved, and it works while the page is not public.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { brand: { page: { template: 'editorial', theme: 'dark' } } } } } } },
    responses: { 200: { description: '`{ html, csp }`' }, 400: { description: 'Invalid value.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const project = await brandProject(ctx, event, body)
  const { config, errors } = validateBrandConfig(body.brand, brandConfigOf(project))
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  const assets = (await listBrandAssets(project)).map(row => serializeBrandAsset(project, row))
  return { html: renderBrandPage(brandPageData(project, config, assets), await poweredByFor(project)), csp: BRAND_PAGE_CSP }
})
