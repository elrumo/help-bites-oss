import { createHash } from 'node:crypto'
import { normalizeHubConfig } from '#shared/hub'

defineRouteMeta({
  openAPI: {
    tags: ['Hub'], operationId: 'getPublicHub', security: [],
    summary: 'Read a project\'s public hub',
    description: 'Public, no sign-in: `pk` is the project\'s public key. What /hub/{pk} shows and what the chat widget\'s Home tab reads, so a custom UI can draw the same thing: `sections` (ordered; each has `key`, `title`, `url`, `text`, `items` and `action`: "chat" for Contact us), `links`, `look` (accent, logo, fonts, corner radius from the Brand kit), and `home` (what\'s new, top feedback and onboarding flows for the Home tab, null while `hub.widgetHome` is off). A section appears only when its feature has something public to show; `sections` and `links` are empty while the page is off (`hub.enabled` false). Answers 404 when neither the page nor the Home tab is on. Cacheable for a minute; send `If-None-Match` with the ETag.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: { description: '`{ project, look, hub, sections, links, home }`.' },
      304: { description: 'Not modified.' },
      404: { description: 'Unknown project, or neither the hub nor the Home tab is on.' },
      429: { description: 'Too many reads from this address.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const project = await publicHubProject(event)
  const config = normalizeHubConfig(project.get('hub'))
  if (!config.enabled && !config.widgetHome.enabled) throw createError({ statusCode: 404, statusMessage: 'This project has no public hub' })
  const body = await buildHub(project, hubOrigin(event))
  const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`
  if (handleCacheHeaders(event, { etag, maxAge: 60, cacheControls: ['public', 'stale-while-revalidate=86400', 'stale-if-error=604800'] })) return
  return body
})
