defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'adminAddEmailSuppressions', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Suppress addresses',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'emails'], properties: { project: { type: 'string' }, emails: { type: 'array', items: { type: 'string' }, maxItems: 1000 }, reason: { type: 'string', enum: ['manual', 'unsubscribe', 'bounce', 'complaint'] }, detail: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ added, existing }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (!body.project) throw createError({ statusCode: 400, statusMessage: 'project is required' })
  const project = await requireProject(ctx, String(body.project))
  const input = readSuppressionInput(body)
  return addEmailSuppressions(project, input.emails.map(email => ({ email, reason: input.reason, detail: input.detail, source: 'admin' })))
})
