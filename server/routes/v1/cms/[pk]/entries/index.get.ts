import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'listPublishedCmsEntries', security: [],
    summary: 'List published entries (delivery API)',
    description: 'Public, no sign-in: `pk` is the project\'s public key. Published entries only, newest first, with their content: `{ id, slug, name, type, version, content, style, publishedAt }`. Filter with `type` (a root component key) and `starts_with` (a slug prefix: `blog/`). Open to any origin, cached for a minute behind an ETag.',
    parameters: [
      { name: 'pk', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'type', in: 'query', schema: { type: 'string' } },
      { name: 'starts_with', in: 'query', schema: { type: 'string' } },
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'per_page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }
    ],
    responses: { 200: { description: '`{ entries, total, page, perPage }`' }, 304: { description: 'Not modified.' }, 404: { description: 'Unknown project.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await cmsPublicProject(event)
  const query = getQuery(event)
  const page = Math.max(1, Math.floor(Number(query.page) || 1))
  const perPage = Math.min(100, Math.max(1, Math.floor(Number(query.per_page) || 25)))
  const body = await listPublishedCmsEntries(project, { type: String(query.type || '') || undefined, startsWith: String(query.starts_with || '') || undefined, page, perPage })
  const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`
  if (handleCacheHeaders(event, { etag, maxAge: 60, cacheControls: ['stale-while-revalidate=600'] })) return
  return body
})
