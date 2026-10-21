defineRouteMeta({ openAPI: { tags: ['Pages'], summary: 'The repositories the assistant can read', operationId: 'listCmsRepos', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ repos: string[] }`: full names of the project\'s linked GitHub repos.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await cmsProject(ctx, event)
  return { repos: projectRepos(project).map(r => r.fullName) }
})
