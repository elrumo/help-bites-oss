import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'getPublicLeadForm', security: [],
    summary: 'Read a lead form',
    description: 'Public, no sign-in: `pk` is the project\'s public key and `key` the form\'s. What `forms.js` and the Swift snippet draw: the fields (in order), the words, the look (`style.accent` is the project\'s accent when the form leaves it empty; an empty `background` or `text` follows the page\'s light or dark theme) and whether people confirm their address. A closed or unknown form answers 404. Open to any origin; answers carry an ETag and may be cached for a minute.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ form }`: key, name, fields, content, style, doubleOptIn, project { name, logoUrl }.' }, 304: { description: 'Not modified.' }, 404: { description: 'Unknown project, or no such active form.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { project, row } = await readPublicLeadForm(event)
  const body = { form: toPublicLeadForm(project, row) }
  const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`
  if (handleCacheHeaders(event, { etag, maxAge: 60, cacheControls: ['stale-while-revalidate=86400'] })) return
  return body
})
