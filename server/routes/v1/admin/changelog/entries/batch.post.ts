defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'createChangelogEntries', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Create several changelog entries, skipping commits already written up',
    description: 'Up to 50 entries, each as `POST /v1/admin/changelog/entries` takes it, plus `commitShas` (full 40-character SHAs of the git commits it describes). An entry is **skipped**, not created, when any of its commits is already cited by an entry of the project, so re-sending a batch never writes a commit up twice. Several entries of one batch may cite the same commit. Entries are created one by one and are not transactional: `failed` lists the ones that could not be created, by index.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator (session or `ak_` key) names it; the project secret and an admin token act on their own project' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['entries'], properties: {
      entries: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', required: ['title'], properties: {
        title: { type: 'string', description: 'Up to 200 characters' },
        body: { type: 'string', description: 'Markdown, written for the public' },
        tag: { type: 'string', enum: ['new', 'improved', 'fix', 'removed', 'breaking'], default: 'improved' },
        status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
        publishedAt: { type: 'string', format: 'date-time', nullable: true },
        releaseId: { type: 'string', nullable: true },
        commitShas: { type: 'array', items: { type: 'string', pattern: '^[0-9a-f]{40}$' }, maxItems: 50 }
      } } }
    } } } } },
    responses: { 200: { description: 'What was created, skipped and failed.', content: { 'application/json': { schema: { type: 'object', properties: {
      created: { type: 'array', items: { '$ref': '#/components/schemas/ChangelogEntry' } },
      skipped: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, commitSha: { type: 'string' }, entryId: { type: 'string', description: 'The entry that already cites the commit' } } } },
      failed: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, message: { type: 'string' } } } }
    } } } } }, 400: { description: 'Not 1 to 50 entries.' }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const project = await changelogWriterProject(event, writer)
  const { created, skipped, failed } = await createChangelogEntries(project, writer.agent, await readBody(event).catch(() => ({})), { name: writer.name, source: writer.source })
  return { created: await serializeChangelogEntries(project, created), skipped, failed }
})
