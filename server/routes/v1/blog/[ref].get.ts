defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'getBlogPostPublic', security: [{}, { EndUserToken: [] }],
    summary: 'One published post',
    description: 'A published post by its slug or id, with its sanitised `bodyHtml` (safe to put straight into your page), its reactions and comment count. Public with `?pk=`; 404 for a draft or a scheduled post (an admin token or an operator also reads those).',
    parameters: [
      { name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'Slug or id' },
      { name: 'pk', in: 'query', schema: { type: 'string' }, description: 'Project public key' }
    ],
    responses: { 200: { description: 'The post.', content: { 'application/json': { schema: { type: 'object', properties: { post: { '$ref': '#/components/schemas/PublicBlogPost' } } } } } }, 404: { description: 'Unknown project or post, or no blog.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveBlogContext(event)
  setHeader(event, 'Cache-Control', optionalBearer(event) ? 'no-store' : 'public, max-age=60')
  const row = await readableBlogPost(ctx, getRouterParam(event, 'ref') || '')
  return { post: serializePublicBlogPost(ctx.project, ctx.config, row, blogActorId(ctx.actor), { body: true }) }
})
