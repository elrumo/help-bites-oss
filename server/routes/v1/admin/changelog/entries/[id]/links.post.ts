defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'linkChangelogEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'Link or unlink a source',
    description: 'Links (`linked: true`, the default) or unlinks one feedback post (`kind: "feedback"`, by id or `#N`), board item (`kind: "board"`, by id or `#N`) or conversation (`kind: "conversation"`, a ticket or an error issue). Each must belong to the entry’s project. An entry links at most 50 of each. Linking a conversation adds an internal `changelog.linked` event to its timeline; unlinking adds `changelog.unlinked`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['kind', 'id'], properties: { kind: { type: 'string', enum: ['feedback', 'board', 'conversation'] }, id: { type: 'string', example: '#12' }, linked: { type: 'boolean', default: true } } } } } },
    responses: { 200: { description: 'The entry with its sources.', content: { 'application/json': { schema: { type: 'object', properties: { entry: { '$ref': '#/components/schemas/ChangelogEntry' } } } } } }, 400: { description: 'Bad kind, or the entry already has 50 links of that kind.' }, 401: { description: 'Admin session, API key, project secret or admin token required.' }, 404: { description: 'Entry or source not found in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  const { project, row } = await loadWriterEntry(event, writer, getRouterParam(event, 'id') || '')
  const { kind, id, linked } = readChangelogLinkInput(await readBody(event).catch(() => ({})))
  const fresh = await linkChangelogEntry(project, writer.agent, row, kind, id, linked)
  return { entry: await serializeChangelogEntry(project, fresh) }
})
