defineRouteMeta({
  openAPI: {
    tags: ['Domains'], operationId: 'verifyProjectDomain', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Check a custom domain\'s DNS',
    description: 'Looks up the TXT and CNAME/A records. When both are right the domain is `verified` and starts serving; otherwise it is `failed` and each record says whether it was found. DNS changes can take a while to spread: call it again. At most 10 checks a minute.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'domainId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ domain }` with the result per record' }, 404: { description: 'No such domain in this project.' }, 429: { description: 'Too many checks.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const row = await getProjectDomain(project, getRouterParam(event, 'domainId') || '')
  return { domain: serializeProjectDomain(await verifyProjectDomain(row)) }
})
