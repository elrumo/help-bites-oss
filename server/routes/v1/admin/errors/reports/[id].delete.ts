import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Delete a saved AI report', operationId: 'deleteErrorReport', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ in: 'query', name: 'project', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ ok: true }`' }, 404: { description: 'No such report in this project.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  await deleteErrorReport(await requireProject(ctx, clampText(getQuery(event).project, 40)), clampText(getRouterParam(event, 'id'), 40))
  return { ok: true }
})
