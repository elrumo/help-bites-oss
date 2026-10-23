import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Saved AI reports on a project\'s errors, newest first', operationId: 'listErrorReports', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ in: 'query', name: 'project', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ reports: [{ id, text, files, count, source, at }] }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const project = await requireProject(ctx, clampText(getQuery(event).project, 40))
  return { reports: await listErrorReports(project) }
})
