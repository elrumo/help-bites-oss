defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'listContactSources', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Databases the project syncs contacts from',
    description: 'Operators only: sources hold database credentials. Credentials are never returned (`hasSecret`).',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ sources, kinds: [{ kind, label }], ready }`. `ready` is false until HELPBITES_SECRET is set on the server.' } }
  }
})

export default defineEventHandler(async (event) => {
  // Contact sources read the developer's own database: running marketing data is an admin's job.
  const ctx = await requireMember(event, { can: 'marketing' })
  const project = await requireProject(ctx, String(getQuery(event).project || ''))
  const rows = await new (useParse()).Query('ContactSource').equalTo('project', project).descending('createdAt').limit(100).find(MASTER)
  return {
    sources: rows.map(serializeContactSource),
    kinds: SOURCE_KINDS.map(kind => ({ kind, label: sourceDriver(kind).label })),
    ready: hasRootSecret()
  }
})
