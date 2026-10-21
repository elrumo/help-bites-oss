import { safeHttpUrl } from '#shared/support'

defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'importGhostBlog', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Import a Ghost blog',
    description: 'Takes the JSON file from Ghost (Settings → Advanced → Export content) as `export` and makes its posts and pages here: HTML (kept as `bodyFormat: "html"`, sanitised like anything else), tags, author, dates, cover and its alt text, SEO fields, featured and visibility. Published and scheduled posts stay so; email-only (`sent`) posts come in as drafts; `paid` and `tiers` posts become members-only. `siteUrl` is the Ghost site\'s address, for the links and images the export writes as `__GHOST_URL__`; the images stay where they are, so keep that site up or move them. Up to 2,000 posts. Importing the same file again skips what came in before (matched by Ghost id), or overwrites it with `update: true`. Quiet: no webhooks, nothing emailed. Members are a CSV of their own (Members → Export): import it under Contacts.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'export'], properties: {
      project: { type: 'string' },
      export: { type: 'object', description: 'The Ghost export, as parsed JSON' },
      siteUrl: { type: 'string', format: 'uri', example: 'https://blog.example.com' },
      update: { type: 'boolean', default: false }
    } } } } },
    responses: { 200: { description: 'What happened.', content: { 'application/json': { schema: { type: 'object', properties: { created: { type: 'integer' }, updated: { type: 'integer' }, skipped: { type: 'integer' }, warnings: { type: 'array', items: { type: 'string' } } } } } } }, 400: { description: 'Not a Ghost export, or no project.' }, 404: { description: 'Project not found.' }, 413: { description: 'More than 2,000 posts.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
  const project = await blogProject(ctx, event, body)
  const siteUrl = typeof body.siteUrl === 'string' ? body.siteUrl.trim() : ''
  if (siteUrl && !safeHttpUrl(siteUrl)) throw createError({ statusCode: 400, statusMessage: 'siteUrl must be an http(s) address' })
  // One import per project at a time: two would race on the same Ghost ids.
  const run = await runExclusive(`sb:blogimport:${project.id}`, 600, () => importGhostExport(project, ctx.agent, body.export, { siteUrl, update: body.update === true }), { waitMs: 0 })
  if (!run.ran) throw createError({ statusCode: 409, statusMessage: 'An import into this blog is already running' })
  return run.value
})
