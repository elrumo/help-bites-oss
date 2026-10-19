defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'sendTestEmail', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Send a test of a template',
    description: 'Renders the template with its sample values (and any `variables` you pass) and sends it to `to` (default: your own address), with "[Test]" in front of the subject. A project template uses its project\'s brand and sender; a master uses `project` for both when given. Logged with source `test`; the suppression list does not apply.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { to: { type: 'array', items: { type: 'string' }, maxItems: 5, description: 'Up to five addresses (one may be a plain string). Defaults to your own.' }, variables: { type: 'object' }, project: { type: 'string', description: 'For a master: whose brand and sender to use.' } } } } } },
    responses: { 200: { description: '`{ id, sent, failed, suppressed, results }`' }, 400: { description: 'No recipient (and no email on your account).' }, 402: { description: 'The workspace\'s emails for this month or today would run out.' }, 503: { description: 'Email sending is not configured.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { agent, agentId, sessionToken } = ctx
  await rateLimit(`sb:rl:emailtest:${agentId}`, LIMITS.emailTestsPerAgent.limit, LIMITS.emailTestsPerAgent.window)
  const row = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const projectId = pointerId(row.get('project')) || String(body.project || '')
  const project = projectId ? await requireProject(ctx, projectId) : null
  const fallback = String(agent.get('email') || '').trim()
  if (!body.to && !fallback) throw createError({ statusCode: 400, statusMessage: 'Pass "to": your account has no email address' })
  const recipients = parseEmailRecipients(body.to || fallback, 5)
  const sender = projectEmailSender(project)
  if (!isMailerConfigured(sender)) throw createError({ statusCode: 503, statusMessage: 'Email sending is not configured on this server' })

  const values = cleanVariableValues(body.variables, EMAIL_SEND_LIMITS.variableLength)
  const template = serializeEmailTemplate(row)
  const batchId = newEmailBatchId()
  const actor = { type: sessionToken.startsWith('ak_') ? 'admin_key' : 'agent', id: agentId, name: String(agent.get('name') || agent.get('username') || '') } as const
  const results = await deliverEmails(recipients.map((recipient) => {
    const rendered = renderEmailTemplate(row, project, { ...values, ...recipient.variables, 'recipient.email': recipient.email, 'recipient.name': recipient.name })
    return {
      project,
      // Only used without a project: a master's test is logged to the workspace.
      workspace: ctx.workspace,
      to: { email: recipient.email, name: recipient.name },
      subject: `[Test] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      sender,
      ignoreSuppressions: true,
      log: { source: 'test', kind: 'template', template: row, templateKey: template.key, templateName: template.master?.name || template.name, variables: values, batchId, actor }
    }
  }))
  return summarizeDeliveries(batchId, results)
})
