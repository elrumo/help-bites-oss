defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'getChangelogEntry', security: [{}, { EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }],
    summary: 'One changelog entry',
    description: 'A published entry (in a published release, if it has one) by its slug, `#N` number or id. Public: pass the project public key as `?pk=`. A writer (an operator, the project secret, or an admin token) can add `?preview=1` to read a draft too, in the full admin shape. An archived entry is a 404 for everyone.',
    parameters: [
      { name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'Slug, number or id' },
      { name: 'pk', in: 'query', schema: { type: 'string' }, description: 'Project public key' },
      { name: 'preview', in: 'query', schema: { type: 'boolean' }, description: 'A writer only: include drafts' }
    ],
    responses: { 200: { description: 'The entry.', content: { 'application/json': { schema: { type: 'object', properties: { entry: { '$ref': '#/components/schemas/PublicChangelogEntry' } } } } } }, 404: { description: 'Unknown project or entry, or no public changelog.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { project, writer } = await resolveChangelogReader(event)
  setHeader(event, 'Cache-Control', optionalBearer(event) || writer ? 'no-store' : 'public, max-age=60')
  const preview = Boolean(writer) && ['1', 'true'].includes(String(getQuery(event).preview || ''))
  const entry = await getChangelogEntryForReader(project, getRouterParam(event, 'ref') || '', preview)
  if (!entry) throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
  return { entry }
})
