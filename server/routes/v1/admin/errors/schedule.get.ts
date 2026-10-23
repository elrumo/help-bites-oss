import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'How often the AI triage of unresolved errors runs on its own', operationId: 'getErrorReportSchedule', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ in: 'query', name: 'project', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ frequency: "off" | "daily" | "weekly" | "monthly", nextAt }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return errorReportSchedule(await requireProject(ctx, clampText(getQuery(event).project, 40)))
})
