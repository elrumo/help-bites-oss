defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'importChangelogComments', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }],
    summary: 'Import changelog comments from another system',
    description: 'Up to 100 comments, each `{ externalId, entry, body, status, authorId, authorName, authorAvatar, authorIsStaff, postedAt, editedAt }`. `entry` names the entry it is on by its `externalId`, slug or `#N`. A comment whose `externalId` exists is **updated**, otherwise created, so re-running converges. It keeps the author, date and status it is given (author = the host’s user id, so `viewerIsAuthor` and account erasure work), skips the rate limit, the duplicate guard and the notification, and recomputes the entries’ comment counts. Not for an admin token.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator names it; the project secret acts on its own project' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['comments'], properties: { comments: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['externalId', 'entry'], properties: { externalId: { type: 'string' }, entry: { type: 'string' }, body: { type: 'string' }, status: { type: 'string', enum: ['visible', 'hidden', 'deleted'] }, authorId: { type: 'string' }, authorName: { type: 'string' }, authorAvatar: { type: 'string' }, authorIsStaff: { type: 'boolean' }, postedAt: { type: 'string', format: 'date-time' }, editedAt: { type: 'string', format: 'date-time' } } } } } } } } },
    responses: { 200: { description: 'What was imported and what failed.', content: { 'application/json': { schema: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, id: { type: 'string' }, externalId: { type: 'string' }, created: { type: 'boolean' } } } }, failed: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, message: { type: 'string' } } } } } } } } }, 400: { description: 'Not 1 to 100 comments.' }, 403: { description: 'An admin token cannot import.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  requireServerWriter(writer)
  const project = await changelogWriterProject(event, writer)
  return await importChangelogComments(project, await readBody(event).catch(() => ({})))
})
