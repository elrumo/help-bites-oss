defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'adminListEmailSuppressions', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Suppressed addresses',
    description: 'Addresses a project no longer mails. One project with `?project=`, else all of this workspace\'s.',
    parameters: [
      { name: 'project', in: 'query', schema: { type: 'string' } },
      { name: 'q', in: 'query', schema: { type: 'string' }, description: 'The start of an address.' },
      { name: 'reason', in: 'query', schema: { type: 'string', enum: ['bounce', 'complaint', 'unsubscribe', 'manual'] } },
      { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } }
    ],
    responses: { 200: { description: '`{ suppressions, nextBefore }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const scope = query.project ? await requireProject(ctx, String(query.project)) : await projectPointers(ctx)
  const before = query.before ? new Date(String(query.before)) : undefined
  if (before && Number.isNaN(before.getTime())) throw createError({ statusCode: 400, statusMessage: 'before must be an ISO date' })
  return listEmailSuppressions(scope, { q: String(query.q || ''), reason: String(query.reason || ''), limit: Number(query.limit) || 100, before })
})
