defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'createChangelogComment', security: [{ EndUserToken: [] }],
    summary: 'Comment on a changelog entry',
    description: 'A signed-in user (an identity token; the project secret is refused) comments on a published entry. Markdown, up to 4,000 characters, rendered with a strict allowlist: no raw HTML, images or headings, at most 6 links. Five comments per ten minutes per user; the same text twice in a row on one entry is a 409. 403 unless the project has changelog comments on.',
    parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'Entry slug, number or id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string', maxLength: 4000 } } } } } },
    responses: { 201: { description: 'The comment and the entry’s new visible comment count.', content: { 'application/json': { schema: { type: 'object', properties: { comment: { '$ref': '#/components/schemas/ChangelogComment' }, commentCount: { type: 'integer' } } } } } }, 400: { description: 'Empty, too long, or too many links.' }, 401: { description: 'Sign in to comment.' }, 403: { description: 'Comments are turned off.' }, 404: { description: 'Entry not found or not public.' }, 409: { description: 'The same text as your last comment here.' }, 429: { description: 'Too many comments.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveCommentContext(event)
  const entry = await readableChangelogEntry(ctx, getRouterParam(event, 'ref') || '')
  const { comment, text, commentCount } = await createChangelogComment(ctx, entry, await readBody(event).catch(() => ({})))
  void notifyChangelogComment(ctx.project, entry, comment, text)
  setResponseStatus(event, 201)
  return { comment: serializeChangelogComment(comment, entry, changelogCommentViewerId(ctx.actor)), commentCount }
})
