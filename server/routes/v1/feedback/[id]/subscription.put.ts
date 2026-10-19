defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'setFeedbackSubscription', security: [{ EndUserToken: [] }],
    summary: 'Follow, unfollow, mute or mark read',
    description: 'Followers hear about status changes and new comments. Authors, commenters and mentioned users follow automatically. `{ "subscribed": false }` unfollows (commenting again follows again); `muted` keeps the post in your list without email; `{ "read": true }` clears `unread`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Post id, its number (`12` or `12-slug`), or the externalId it was imported with' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { subscribed: { type: 'boolean' }, muted: { type: 'boolean' }, read: { type: 'boolean' } } } } } },
    responses: { 200: { description: 'Your state for this post.', content: { 'application/json': { schema: { type: 'object', properties: { subscribed: { type: 'boolean' }, muted: { type: 'boolean' }, unread: { type: 'boolean' } } } } } }, 401: { description: 'Sign in to follow.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { ctx, post } = await loadFeedbackPost(event, getRouterParam(event, 'id') || '', { requireActor: true })
  return await setFeedbackSubscription(ctx, post, await readBody(event).catch(() => ({})))
})
