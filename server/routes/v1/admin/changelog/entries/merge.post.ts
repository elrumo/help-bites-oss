defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'mergeChangelogEntries', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Fold several entries into one',
    description: 'Creates `entry` (as `POST …/entries` takes it) and **archives** the 2 to 10 entries named by `refs` (slugs, `#N` numbers or ids). The merged entry also cites every commit the sources did, so none is written up again, and links what they linked. An archived entry is never public but keeps its slug and commits. Not transactional: the merged entry exists before the first source is archived. Writing the merged text is the caller’s job.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator names it; the project secret and an admin token act on their own project' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['refs', 'entry'], properties: { refs: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'string' } }, entry: { type: 'object', description: 'The merged entry, as `POST …/entries` takes it' } } } } } },
    responses: { 200: { description: 'The merged entry and the archived ones.', content: { 'application/json': { schema: { type: 'object', properties: { entry: { '$ref': '#/components/schemas/ChangelogEntry' }, archived: { type: 'array', items: { type: 'string' }, description: 'Ids of the archived entries' } } } } } }, 400: { description: 'Invalid refs or entry, or a source is already archived.' }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'A source was not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const project = await changelogWriterProject(event, writer)
  const { entry, archived } = await mergeChangelogEntries(project, writer, await readBody(event).catch(() => ({})))
  return { entry: await serializeChangelogEntry(project, entry), archived: archived.map(row => row.id || '') }
})
