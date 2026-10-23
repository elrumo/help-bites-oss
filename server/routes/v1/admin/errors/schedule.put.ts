import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Set how often the AI triage of unresolved errors runs on its own', operationId: 'setErrorReportSchedule', description: '`frequency` is `off`, `daily`, `weekly` or `monthly`. The first run is one interval from now; each run saves a report (see `listErrorReports`).', security: [{ AgentSession: [] }, { AdminApiKey: [] }], responses: { 200: { description: '`{ frequency, nextAt }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  return await setErrorReportSchedule(await requireProject(ctx, clampText(body.project, 40)), body.frequency)
})
