import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'getPublicOnboardingFlow', security: [],
    summary: 'Read a published onboarding flow',
    description: 'Public, no sign-in: `pk` is the project\'s public key and `key` the flow\'s. Returns the published version only (drafts and unpublished flows answer 404). `style.accent` is filled with the project\'s accent when the flow leaves it empty; an empty `background` or `text` means "follow the app\'s light or dark theme", and an empty `buttonLabel` means the client\'s own (Continue, and Get started on the last step). Pass `?locale=es` (or send `Accept-Language`) for a translation: you get the first language the flow has, else its own, and `locale` says which. Open to any origin. Answers carry an ETag and may be cached for a minute and served stale for a week if HelpBites cannot be reached. Save the response in your app as its offline copy (docs/ONBOARDING.md). A step with a pricing table carries it as `pricing`: the published table as `GET /v1/pricing/{pk}/{key}` gives it, in the flow\'s language, or null while the table is not published (docs/PRICING.md).',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }, { name: 'locale', in: 'query', required: false, schema: { type: 'string' }, description: 'A language tag such as `es` or `pt-BR`.' }, { name: 'visitor', in: 'query', required: false, schema: { type: 'string' }, description: 'An id your client keeps for the person, so a step\'s pricing table in an A/B test is always the same one for them.' }],
    responses: { 200: { description: '`{ flow }`: key, name, locale, locales, version, publishedAt, project { name, logoUrl }, style, options and steps.' }, 304: { description: 'Not modified.' }, 404: { description: 'Unknown project, or no such published flow.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const flow = await publicOnboardingFlow(event)
  const body = { flow }
  const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`
  if (handleCacheHeaders(event, { etag, maxAge: 60, cacheControls: ['stale-while-revalidate=86400', 'stale-if-error=604800'] })) return
  return body
})
