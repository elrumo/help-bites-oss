defineRouteMeta({
  openAPI: {
    tags: ['Domains'], operationId: 'addProjectDomain', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Add a custom domain',
    description: 'Registers a host such as `feedback.example.com`. Add the returned DNS records (a TXT that proves the host is yours, a CNAME or A that points it here), then call verify. `target` is what the host\'s root shows: `hub` (default), `feedback`, `roadmap`, `changelog` or `blog`; every public page is also reachable under it.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['host'], properties: { host: { type: 'string', example: 'feedback.example.com' }, target: { type: 'string', enum: ['hub', 'feedback', 'roadmap', 'changelog', 'blog'] } } } } } },
    responses: { 200: { description: '`{ domain }` with `dnsRecords`' }, 400: { description: 'Not a domain, a reserved host, or too many domains.' }, 402: { description: 'The plan does not include custom domains.' }, 409: { description: 'The host belongs to another project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  return { domain: serializeProjectDomain(await addProjectDomain(project, await readObjectBody(event))) }
})
