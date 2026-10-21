import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'getDefaultLeadForm', security: [],
    summary: 'Read the project\'s first lead form',
    description: 'The same as `GET /v1/forms/{pk}/{key}` for the project\'s first active form (the oldest), so an embed works with nothing but the public key. 404 when the project has none.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'locale', in: 'query', required: false, schema: { type: 'string' }, description: 'The language to show it in, such as `es` or `pt-BR`; else the `Accept-Language` header. A language the form has no translation for gets the form\'s own.' }],
    responses: { 200: { description: '`{ form }`' }, 304: { description: 'Not modified.' }, 404: { description: 'Unknown project, or no active form.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { project, row } = await readPublicLeadForm(event)
  // ?locale=es wins over the browser's Accept-Language; a language the form lacks gets the form's own.
  setResponseHeader(event, 'Vary', 'Accept-Language')
  const body = { form: toPublicLeadForm(project, row, wantedLocales(event)) }
  const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`
  if (handleCacheHeaders(event, { etag, maxAge: 60, cacheControls: ['stale-while-revalidate=86400'] })) return
  return body
})
