import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Get the error alert rules and the alerts that fired recently', operationId: 'getErrorAlerts', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const project = await requireProject(ctx, clampText(getQuery(event).project, 40))
  return { ...errorAlertConfig(project), notifyEmails: parseRecipientList(project.get('notifyEmails')), recent: await recentErrorAlerts(project.id || '') }
})
