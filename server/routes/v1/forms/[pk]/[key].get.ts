import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'getPublicLeadForm', security: [],
    summary: 'Read a lead form',
    description: 'Public, no sign-in: `pk` is the project\'s public key and `key` the form\'s. What `forms.js` and the Swift snippet draw: the fields (in order), the words, the look (`style.accent` is the project\'s accent when the form leaves it empty; `look` is the finished style: the project style\'s light and dark colours, radius, shadow and font with the form\'s own fields over it, see docs/STYLE.md; an empty `background` or `text` follows the page\'s light or dark theme) and whether people confirm their address. The words come in the language asked for when the form has a translation for it (`locale` says which, `locales` lists them all); a choice field\'s `options` stay the values to send and `optionLabels` say what to show. A `file` field says what it takes (`accept`: images, documents or any) and how large (`maxMB`). A closed or unknown form answers 404. Open to any origin; answers carry an ETag and may be cached for a minute.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }, { name: 'locale', in: 'query', required: false, schema: { type: 'string' }, description: 'The language to show it in, such as `es` or `pt-BR`; else the `Accept-Language` header. A language the form has no translation for gets the form\'s own.' }],
    responses: { 200: { description: '`{ form }`: key, name, locale, locales, fields, content, style, doubleOptIn, project { name, logoUrl }.' }, 304: { description: 'Not modified.' }, 404: { description: 'Unknown project, or no such active form.' }, 429: { description: 'Too many requests.' } }
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
