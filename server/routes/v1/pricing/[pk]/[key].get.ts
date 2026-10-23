import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'getPublicPricingTable', security: [],
    summary: 'Read a published pricing table',
    description: [
      'Public, no sign-in: `pk` is the project\'s public key and `key` the table\'s. Returns the published version only (drafts answer 404), with prices read from Stripe for plans linked to it: changed in Stripe, changed here, without a publish (the copy kept at publish shows while Stripe cannot be reached).',
      'Each plan has `prices` by slot (`month`, `year`, `once`): `amount` in the currency\'s units, `currency`, `monthly` (a yearly price over twelve), `trialDays`, and `href`, where its button goes (HelpBites\' checkout link, a Stripe Payment Link or your own URL; null for no button). Add `?prefilled_email=` and `?client_reference_id=` to an href to fill in the buyer\'s email and tag the purchase, as with Stripe Payment Links. `lines` is the card\'s feature list and `cells` every feature\'s value, for a comparison table. `savings` is the percent a year saves.',
      '`style.accent` is filled with the project\'s accent when the table leaves it empty; an empty `background` or `text` means "follow the app\'s light or dark theme". `look` is the project\'s style (light and dark palettes, `radius`, `shadow`, `fontFamily`, `scheme`) with the table\'s own accent, colours, radius and font laid over it, ready to draw with; it is `null` while the project has no style of its own. An empty label means the client\'s own words. Pass `?locale=es` (or send `Accept-Language`) for a translation and `?currency=eur` for prices in another currency: Stripe prices with that currency option and written prices with an amount in it. `intervals` are the slots some plan has (`week`, `month`, `year`, `once`), `currencies` the ones a switcher can offer. While the table runs an A/B test, `key` is the table this visitor was given and `experiment` the test to send back with events. Open to any origin. Answers carry an ETag and may be cached for a minute.'
    ].join(' '),
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }, { name: 'locale', in: 'query', required: false, schema: { type: 'string' }, description: 'A language tag such as `es` or `pt-BR`.' }, { name: 'currency', in: 'query', required: false, schema: { type: 'string' }, description: 'A three-letter currency code: every price shows in it when every price has it (`currencies` lists them).' }, { name: 'visitor', in: 'query', required: false, schema: { type: 'string' }, description: 'An id your client keeps for the person (6 to 64 letters, digits, - and _). While the table runs an A/B test, the same visitor always gets the same table; `key` and `experiment` say which.' }],
    responses: { 200: { description: '`{ table }`: key, name, locale, locales, version, template, style, look, options, content, intervals, savings, features and plans.' }, 304: { description: 'Not modified.' }, 404: { description: 'Unknown project, or no such published table.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const table = await publicPricingTable(event)
  const body = { table }
  const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`
  if (handleCacheHeaders(event, { etag, maxAge: 60, cacheControls: ['stale-while-revalidate=86400', 'stale-if-error=604800'] })) return
  return body
})
