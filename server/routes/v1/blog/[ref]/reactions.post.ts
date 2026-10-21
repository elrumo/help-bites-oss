import { BLOG_REACTIONS } from '#shared/blog'

defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'reactToBlogPost', security: [{ EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'React to a post',
    description: 'Toggles one of the viewer\'s reactions on a published post, or sets it with `on`. A signed-in user (an identity token, or an email-only session) or an operator; sixty a minute per user. 403 when the blog has reactions off.',
    parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'Slug or id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['reaction'], properties: { reaction: { type: 'string', enum: [...BLOG_REACTIONS] }, on: { type: 'boolean', description: 'Omit to toggle' } } } } } },
    responses: { 200: { description: 'The post\'s reactions now.', content: { 'application/json': { schema: { type: 'object', properties: { reactions: { type: 'array', items: { '$ref': '#/components/schemas/BlogReaction' } } } } } } }, 400: { description: 'Unknown reaction.' }, 401: { description: 'Sign in to react.' }, 403: { description: 'Reactions are off.' }, 404: { description: 'Post not found.' }, 429: { description: 'Too many reactions.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveBlogContext(event)
  const row = await readableBlogPost(ctx, getRouterParam(event, 'ref') || '')
  const body = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
  const fresh = await reactToBlogPost(ctx, row, body.reaction, body.on)
  return { reactions: serializePublicBlogPost(ctx.project, ctx.config, fresh, blogActorId(ctx.actor)).reactions }
})
