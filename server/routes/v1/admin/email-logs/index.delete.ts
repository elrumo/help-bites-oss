defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'adminPurgeEmailLogs', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete old email log entries',
    description: 'Deletes entries created before `before` (or older than `olderThanDays`), for one project with `?project=` or all of this workspace\'s. One of the two bounds is required. At most 20,000 entries go per call; `more: true` means call again. Old entries are also pruned automatically after EMAIL_LOG_RETENTION_DAYS (default 180).',
    parameters: [
      { name: 'project', in: 'query', schema: { type: 'string' } },
      { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'olderThanDays', in: 'query', schema: { type: 'integer', minimum: 0 } }
    ],
    responses: { 200: { description: '`{ deleted, more }`' }, 400: { description: 'No bound given.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const query = getQuery(event)
  let before: Date | null = null
  if (query.before) before = new Date(String(query.before))
  else if (query.olderThanDays !== undefined && query.olderThanDays !== '') before = new Date(Date.now() - Math.max(0, Number(query.olderThanDays)) * 24 * 60 * 60 * 1000)
  if (!before || Number.isNaN(before.getTime())) throw createError({ statusCode: 400, statusMessage: 'Pass before (an ISO date) or olderThanDays' })
  const scope = query.project ? { project: await requireProject(ctx, String(query.project)) } : { workspace: ctx.apiKeyProjectIds ? undefined : ctx.workspace, projects: await projectPointers(ctx) }
  const max = 20_000
  const deleted = await purgeEmailLogs({ scope, before, max })
  return { deleted, more: deleted >= max }
})
