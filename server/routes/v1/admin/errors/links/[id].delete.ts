import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Stop reporting to a tracker project', operationId: 'removeErrorLink', description: 'Disconnects it from this project. The project in the tracker and its conversations are left alone.', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ in: 'query', name: 'project', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ project }`' }, 404: { description: 'No such tracker project.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, clampText(getQuery(event).project, 40))
  await removeErrorLink(project, getRouterParam(event, 'id') || '')
  return { project: serializeAdminProject(project) }
})
