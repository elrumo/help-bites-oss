import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'getDefaultPricingTable', security: [],
    summary: 'Read the project\'s first pricing table',
    description: 'The same as `GET /v1/pricing/{pk}/{key}` for the project\'s first published table (the oldest), so an embed works with nothing but the public key. 404 when none is published.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'locale', in: 'query', required: false, schema: { type: 'string' } }, { name: 'currency', in: 'query', required: false, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ table }`' }, 304: { description: 'Not modified.' }, 404: { description: 'Unknown project, or no published table.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const table = await publicPricingTable(event)
  const body = { table }
  const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`
  if (handleCacheHeaders(event, { etag, maxAge: 60, cacheControls: ['stale-while-revalidate=86400', 'stale-if-error=604800'] })) return
  return body
})
