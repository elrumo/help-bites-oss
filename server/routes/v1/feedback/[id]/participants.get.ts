defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'listFeedbackParticipants', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Who can be @mentioned in a thread',
    description: 'The post’s author, public commenters and followers that have a `username` (from their identity token), filtered by `q`, at most 8. Handles, names and avatars only — never ids or emails. On boards that hide author names, only the team is offered (admins see everyone).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }, { name: 'q', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: 'Candidates, the team first.', content: { 'application/json': { schema: { type: 'object', properties: { participants: { type: 'array', items: { type: 'object', properties: { handle: { type: 'string' }, name: { type: 'string' }, avatarUrl: { type: 'string' }, isTeam: { type: 'boolean' } } } } } } } } } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  return { participants: await listFeedbackParticipants(ctx, post, getQuery(event).q) }
})
