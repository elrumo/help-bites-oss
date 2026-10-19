defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'getChangelogSubscription', security: [{ EndUserToken: [] }],
    summary: 'The signed-in user’s changelog subscription',
    description: 'How often this user is emailed about the changelog (`instant` or `weekly`), or `null` when they are not subscribed. Matched by their user id or their account email.',
    responses: { 200: { description: 'Their cadence.', content: { 'application/json': { schema: { type: 'object', properties: { frequency: { type: 'string', enum: ['instant', 'weekly'], nullable: true } } } } } }, 401: { description: 'Sign in.' }, 404: { description: 'No notifications on this changelog.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { project, claims } = await requireEndUser(event)
  requireChangelogNotify(project)
  setHeader(event, 'Cache-Control', 'no-store')
  return await getChangelogSubscription(project, claims)
})
