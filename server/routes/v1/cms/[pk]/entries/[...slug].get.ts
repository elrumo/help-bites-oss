import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'getPublishedCmsEntry', security: [],
    summary: 'Read a published entry (delivery API)',
    description: 'Public, no sign-in: the published version of the entry at `slug` (which may hold `/`: `blog/hello-world`; `home` is the root). Drafts and unpublished entries answer 404. `format=html` adds `html` (the body rendered with the project\'s components) and `css` (the theme and each component\'s styles) for a site that shows it as is. Open to any origin, cached for a minute behind an ETag.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'html'] } }],
    responses: { 200: { description: '`{ entry }`, plus `html` and `css` with `format=html`.' }, 304: { description: 'Not modified.' }, 404: { description: 'Unknown project, or no such published entry.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await cmsPublicProject(event)
  const row = await publishedCmsEntry(project, getRouterParam(event, 'slug') || '')
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
  const entry = toPublicCmsEntry(row)
  const body = getQuery(event).format === 'html' ? { entry, ...cmsEntryHtml(project, entry, await cmsLibrary(project), cmsHost(event)) } : { entry }
  const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`
  if (handleCacheHeaders(event, { etag, maxAge: 60, cacheControls: ['stale-while-revalidate=600'] })) return
  return body
})
