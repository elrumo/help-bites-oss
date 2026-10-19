defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'adminEmailLogStats', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Email totals',
    description: 'Counts over the last `days` (default 30, at most 365): by status, by source, per day, and the most-sent templates. One project with `?project=`, else all of this workspace\'s.',
    parameters: [
      { name: 'project', in: 'query', schema: { type: 'string' } },
      { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365 } }
    ],
    responses: { 200: { description: '`{ days, since, total, byStatus, bySource, byDay: [{ date, total, sent, failed }], topTemplates: [{ key, name, count }], truncated }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const scope = query.project ? { project: await requireProject(ctx, String(query.project)) } : { workspace: ctx.apiKeyProjectIds ? undefined : ctx.workspace, projects: await projectPointers(ctx) }
  const days = Math.min(Math.max(Number.parseInt(String(query.days || '30'), 10) || 30, 1), 365)
  return emailLogStats(scope, days)
})
