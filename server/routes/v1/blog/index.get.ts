defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'getBlog', security: [{}, { EndUserToken: [] }],
    summary: 'The public blog',
    description: 'Published posts, newest first, a page at a time, without their bodies (read one post for `bodyHtml`). A scheduled post appears once its `publishedAt` passes. Public: pass the project public key as `?pk=` (or `X-Project-Key`). With an identity token each post\'s `reactions` say which the viewer left (`reacted`). 404 unless the project\'s blog is on (Project → Blog → Settings). Everything here is what the hosted page at `/blog/<pk>` and `blog.js` draw, so you can build your own UI on it.',
    parameters: [
      { name: 'pk', in: 'query', schema: { type: 'string' }, description: 'Project public key' },
      { name: 'tag', in: 'query', schema: { type: 'string' }, description: 'Only posts with this tag (any case)' },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
      { name: 'skip', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }
    ],
    responses: { 200: { description: 'The blog.', content: { 'application/json': { schema: { '$ref': '#/components/schemas/PublicBlog' } } } }, 400: { description: 'An invalid number.' }, 404: { description: 'Unknown project, or no blog.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveBlogContext(event)
  // A signed-in caller's response is never shared; an anonymous one may be for a minute.
  setHeader(event, 'Cache-Control', optionalBearer(event) ? 'no-store' : 'public, max-age=60')
  return await listPublicBlog(ctx, readBlogPage(getQuery(event)))
})
