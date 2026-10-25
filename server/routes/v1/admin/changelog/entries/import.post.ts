defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'importChangelogEntries', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }],
    summary: 'Import changelog entries from another system',
    description: 'Up to 100 entries, each as `POST …/entries` takes it plus the caller’s own `externalId`. An entry whose `externalId` exists is **updated** (only the fields sent), otherwise created, so re-running converges. It keeps the `slug` and `publishedAt` it is given and the review trail the entry already has (`reviewStatus`, `reviewedBy`, `reviewedAt`, `reviewNotes`, `authorName`, `source`), and never drafts, links or tells anyone. `releaseVersion` finds the release of that version or creates it already published. A new entry needs a `title`. Entries are handled one by one and are not transactional: `failed` lists the ones that could not be imported, by index. Not for an admin token.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator names it; the project secret acts on its own project' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['entries'], properties: { entries: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['externalId'], properties: {
      externalId: { type: 'string', description: 'Your id for the entry (up to 200 characters)' },
      title: { type: 'string' }, slug: { type: 'string' }, summary: { type: 'string' }, body: { type: 'string' }, bodyFormat: { type: 'string', enum: ['markdown', 'html'] },
      tag: { type: 'string', enum: ['new', 'improved', 'fix', 'removed', 'breaking'] }, area: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'published', 'archived'] }, publishedAt: { type: 'string', format: 'date-time', nullable: true },
      releaseVersion: { type: 'string' }, commitShas: { type: 'array', items: { type: 'string' } },
      pinned: { type: 'boolean' }, iconGlyph: { type: 'string' }, accentColor: { type: 'string', example: '#3366ff' }, images: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: { type: 'integer' } } }, description: 'Uploads from POST /v1/feedback/attachments' }, links: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } } } },
      reviewStatus: { type: 'string', enum: ['pending', 'approved', 'rejected'], nullable: true }, reviewedBy: { type: 'string', nullable: true }, reviewedAt: { type: 'string', format: 'date-time', nullable: true }, reviewNotes: { type: 'string', nullable: true },
      authorName: { type: 'string' }, source: { type: 'string', enum: ['admin', 'internal'] }
    } } } } } } } },
    responses: { 200: { description: 'What was imported and what failed.', content: { 'application/json': { schema: { type: 'object', properties: {
      results: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, id: { type: 'string' }, externalId: { type: 'string' }, slug: { type: 'string' }, created: { type: 'boolean' } } } },
      failed: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, message: { type: 'string' } } } }
    } } } } }, 400: { description: 'Not 1 to 100 entries.' }, 401: { description: 'Admin session, API key or project secret required.' }, 403: { description: 'An admin token cannot import.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  requireServerWriter(writer)
  const project = await changelogWriterProject(event, writer)
  return await importChangelogEntries(project, writer, await readBody(event).catch(() => ({})))
})
