import { can } from '#shared/roles'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'adminGetEmailLog', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'One email log entry',
    description: 'With its delivery events, and the message\'s HTML and text when the project keeps message content.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ log }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const row = await scoped.emailLog(ctx, getRouterParam(event, 'id') || '')
  // The copy of a sent email can hold a one-time sign-in code or a reset link: a signed-in admin reads it, no key and no agent does.
  const log = serializeEmailLog(row, { content: !ctx.apiKeyId && can(ctx.role, 'projects.manage') })
  // No saved copy: show the template as it renders with the values that were logged.
  return { log, templatePreview: log.html || !log.template?.id ? null : await renderLoggedTemplate(ctx, log) }
})

/** Redacted and cut-short values are left out, so their placeholders stay visible rather than showing broken content. */
async function renderLoggedTemplate(ctx: Awaited<ReturnType<typeof requireMember>>, log: ReturnType<typeof serializeEmailLog>): Promise<string | null> {
  try {
    const values = Object.fromEntries(log.variables.filter(v => v.value !== '[redacted]' && !v.value.endsWith('…')).map(v => [v.key, v.value]))
    const project = log.projectId ? await requireProject(ctx, log.projectId) : null
    return renderEmailTemplate(await scoped.emailTemplate(ctx, log.template!.id!), project, values).html
  } catch {
    return null // the template was deleted or no longer renders
  }
}
