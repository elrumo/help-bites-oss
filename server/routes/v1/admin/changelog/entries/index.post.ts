defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'createChangelogEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Create a changelog entry',
    description: 'Creates a draft (or, with `status: "published"`, a published entry dated now) with the project’s next `number`. Public only once published and, when it has a `releaseId`, once that release is published too. Optional `feedbackPostIds` (ids or `#N`), `boardItemIds` and `conversationIds` link its sources on creation; every one must belong to the project. The text is yours: nothing is copied from the sources.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator (session or `ak_` key) names it; the project secret and an admin token act on their own project' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: {
      title: { type: 'string', description: 'Up to 200 characters', example: 'CSV export' },
      body: { type: 'string', description: 'Markdown, written for the public' },
      tag: { type: 'string', enum: ['new', 'improved', 'fix', 'removed', 'breaking'], default: 'improved' },
      status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
      publishedAt: { type: 'string', format: 'date-time', nullable: true, description: 'The date shown; defaults to now on publishing' },
      releaseId: { type: 'string', nullable: true },
      commitShas: { type: 'array', items: { type: 'string', pattern: '^[0-9a-f]{40}$' }, maxItems: 50, description: 'Full SHAs of the git commits it describes. Not checked for duplicates here; use `POST …/entries/batch` for that' },
      images: { type: 'array', maxItems: 10, items: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, size: { type: 'integer' } } }, description: 'Images shown with the text, in order. Upload each with POST /v1/feedback/attachments and pass what it returns' },
      feedbackPostIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      boardItemIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      conversationIds: { type: 'array', items: { type: 'string' }, maxItems: 50 }
    } } } } },
    responses: { 200: { description: 'The created entry.', content: { 'application/json': { schema: { type: 'object', properties: { entry: { '$ref': '#/components/schemas/ChangelogEntry' } } } } } }, 400: { description: 'Missing title, or an invalid tag, status or date.' }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Project, release or source not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const project = await changelogWriterProject(event, writer)
  const row = await createChangelogEntry(project, writer.agent, await readBody(event).catch(() => ({})), { name: writer.name, source: writer.source })
  return { entry: await serializeChangelogEntry(project, row) }
})
