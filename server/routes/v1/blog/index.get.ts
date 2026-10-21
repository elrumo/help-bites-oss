defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'getBlog', security: [{}, { EndUserToken: [] }],
    summary: 'The public blog',
    description: 'Published posts (or, with `type=page`, pages), newest first, a page at a time, without their bodies (read one post for `bodyHtml`). A scheduled post appears once its `publishedAt` passes. `q` finds words in titles, excerpts and tags; `featured=true` keeps the featured posts. A members-only post is listed with its excerpt and `locked` unless the viewer is a member. Public: pass the project public key as `?pk=` (or `X-Project-Key`). With an identity token each post\'s `reactions` say which the viewer left (`reacted`). 404 unless the project\'s blog is on (Project → Blog → Settings). Everything here is what the hosted page at `/blog/<pk>` and `blog.js` draw, so you can build your own UI on it.',
    parameters: [
      { name: 'pk', in: 'query', schema: { type: 'string' }, description: 'Project public key' },
      { name: 'tag', in: 'query', schema: { type: 'string' }, description: 'Only posts with this tag (any case)' },
      { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Search titles, excerpts and tags' },
      { name: 'featured', in: 'query', schema: { type: 'boolean' }, description: 'Only featured posts' },
      { name: 'type', in: 'query', schema: { type: 'string', enum: ['post', 'page'], default: 'post' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
      { name: 'skip', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }
    ],
    responses: { 200: { description: 'The blog.', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PublicBlog' } } } }, 400: { description: 'An invalid number or type.' }, 404: { description: 'Unknown project, or no blog.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveBlogContext(event)
  // A signed-in caller's response is never shared; an anonymous one may be for a minute.
  setHeader(event, 'Cache-Control', optionalBearer(event) ? 'no-store' : 'public, max-age=60')
  return await listPublicBlog(ctx, readBlogPage(getQuery(event)))
})
