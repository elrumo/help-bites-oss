defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'listPublicLegalDocuments', security: [],
    summary: 'List a project\'s published legal documents',
    description: 'Public. `pk` is the project\'s public key. Returns the published documents\' type, slug, locale, title, version and path (one entry per language); read one with `/v1/legal/{pk}/{slug}`.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Documents.' }, 404: { description: 'Unknown project.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await publicLegalProject(event)
  setHeader(event, 'Cache-Control', 'public, max-age=60')
  const docs = (await listLegalDocuments(project, true)).map(row => toPublicLegalDocument(project, row))
  return { documents: docs.map(({ type, slug, locale, title, effectiveDate, publishedAt, version, url }) => ({ type, slug, locale, title, effectiveDate, publishedAt, version, url })) }
})
