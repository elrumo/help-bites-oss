defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Search end users',
    parameters: [
      { name: 'project', in: 'query', schema: { type: 'string' } },
      { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Name, email or external id' }
    ],
    responses: { 200: { description: '{ endUsers }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const Parse = useParse()
  const { project, q } = getQuery(event)
  const term = typeof q === 'string' ? q.trim() : ''
  const only = typeof project === 'string' && project ? await requireProject(ctx, project) : null
  const projectId = only?.id || ''
  // Every EndUser query below stays inside ?project, else this workspace's projects.
  const scope = only ? [only] : await projectPointers(ctx)
  const endUsers = () => new Parse.Query('EndUser').containedIn('project', scope)

  const shape = (rows: ParseObject[]) => rows.map(row => ({ ...serializeEndUser(row), projectId: pointerId(row.get('project')) }))

  // Prefer Meilisearch (typo-tolerant, all fields). Falls through to Mongo regex
  // when it is unavailable or returns nothing, so behaviour is unchanged offline.
  if (term) {
    try {
      const ids = await searchEndUserIds(term, { workspaceId: ctx.workspaceId, projectId }, 50)
      if (ids.length) {
        const rows = await endUsers().containedIn('objectId', ids).find(MASTER)
        const byId = new Map(rows.map(r => [r.id || '', r]))
        return { endUsers: shape(ids.map(id => byId.get(id)).filter(Boolean) as ParseObject[]) }
      }
    } catch { /* fall through */ }
  }

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const queries = term
    ? [endUsers().matches('name', escaped, 'i'), endUsers().matches('email', escaped, 'i'), endUsers().matches('externalId', escaped, 'i')]
    : [endUsers()]
  const query = queries.length > 1 ? Parse.Query.or(...queries) : queries[0]!
  const rows = await query.descending('lastSeenAt').limit(50).find(MASTER)
  return { endUsers: shape(rows) }
})
