defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'adminListEmailLogs', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Email log',
    description: 'Every message HelpBites sent or tried to send, newest first: API sends, test sends, conversation and feedback notifications, operator password resets. With `?project=` one project\'s; without, all of this workspace\'s. Filters as on `GET /v1/email-logs`. Page with `before` = the previous page\'s `nextBefore`.',
    parameters: [
      { name: 'project', in: 'query', schema: { type: 'string' } },
      { name: 'to', in: 'query', schema: { type: 'string' }, description: 'An exact address, or the start of one.' },
      { name: 'template', in: 'query', schema: { type: 'string' } },
      { name: 'status', in: 'query', schema: { type: 'string' } },
      { name: 'source', in: 'query', schema: { type: 'string' } },
      { name: 'batch', in: 'query', schema: { type: 'string' } },
      { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'until', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } }
    ],
    responses: { 200: { description: '`{ logs, nextBefore }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const scope = query.project ? { project: await requireProject(ctx, String(query.project)) } : { workspace: ctx.apiKeyProjectIds ? undefined : ctx.workspace, projects: await projectPointers(ctx) }
  return listEmailLogs(scope, readEmailLogQuery(query))
})
