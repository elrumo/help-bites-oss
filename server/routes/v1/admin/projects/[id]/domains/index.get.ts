import { PROJECT_DOMAIN_LIMIT } from '#shared/domains'

defineRouteMeta({
  openAPI: {
    tags: ['Domains'], operationId: 'listProjectDomains', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List the custom domains of a project',
    description: 'The hosts the project\'s public pages are served on, each with the DNS records to add and the result of the last check.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ domains, limit }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  return { domains: (await listProjectDomains(project)).map(serializeProjectDomain), limit: PROJECT_DOMAIN_LIMIT }
})
