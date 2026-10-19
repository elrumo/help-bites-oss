defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'listChangelogComments', security: [{}, { EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'The comments on a changelog entry',
    description: 'Visible comments, oldest first (a conversation read newest-first is unreadable). Public: pass the project public key as `?pk=`. With an identity token each comment says whether the viewer wrote it (`viewerIsAuthor`); an admin token or an operator also sees hidden ones, marked by `status`. Deleted comments are never returned. Comments written with the entry’s public changelog; 404 for an entry that is not public (a team member can read a draft’s).',
    parameters: [
      { name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'Entry slug, number or id' },
      { name: 'pk', in: 'query', schema: { type: 'string' }, description: 'Project public key' },
      { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators only)' },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      { name: 'skip', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }
    ],
    responses: { 200: { description: 'A page of comments.', content: { 'application/json': { schema: { type: 'object', properties: { comments: { type: 'array', items: { '$ref': '#/components/schemas/ChangelogComment' } }, total: { type: 'integer' }, hasMore: { type: 'boolean' } } } } } }, 404: { description: 'Unknown project or entry, or no public changelog.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveCommentContext(event)
  setHeader(event, 'Cache-Control', optionalBearer(event) ? 'no-store' : 'public, max-age=30')
  const entry = await readableChangelogEntry(ctx, getRouterParam(event, 'ref') || '')
  return await listChangelogComments(ctx, entry, readChangelogCommentPage(getQuery(event)))
})
