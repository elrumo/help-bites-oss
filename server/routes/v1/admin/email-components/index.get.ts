defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List email components', operationId: 'listEmailComponents', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'The shared component library, plus one project\'s own components with `?project=`.', parameters: [{ name: 'project', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: '`{ components }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true })
  const projectId = String(getQuery(event).project || '')
  if (projectId) await requireProject(ctx, projectId)
  return { components: await listEmailComponents(ctx.workspace, projectId || null) }
})
