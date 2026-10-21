import { createHash } from 'node:crypto'

defineRouteMeta({
  openAPI: {
    tags: ['Hub'], operationId: 'getHubLoader', security: [],
    summary: 'Which embeds a project has (for helpbites.js)',
    description: 'Public, no sign-in. What public/helpbites.js reads before it injects the chat widget, feedback board, changelog and onboarding scripts: `modules.chat`, `modules.feedback`, `modules.changelog` and `modules.onboarding` each say whether the project has it (`onboarding.flows` lists the published flow keys), `modules.chat.home` whether the widget shows a Home tab, `hub` the page\'s address, and `accent` the project\'s colour. Never 404 for a known project: a project with nothing set up answers with everything off except chat.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ project, modules, hub, accent }`.' }, 304: { description: 'Not modified.' }, 404: { description: 'Unknown project.' }, 429: { description: 'Too many reads from this address.' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await publicHubProject(event)
  const body = await buildLoader(project, hubOrigin(event))
  const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`
  if (handleCacheHeaders(event, { etag, maxAge: 60, cacheControls: ['public', 'stale-while-revalidate=86400', 'stale-if-error=604800'] })) return
  return body
})
