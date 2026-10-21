defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'listLeadForms', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List lead forms',
    description: 'Every lead form of the project, with its fields, words, look and settings, and `stats`: how many people came through it (`leads`) and how many of them are on the list (`confirmed`, subscribed). `path` is the public read and submit URL, `pagePath` the hosted page. The leads themselves are contacts: `GET /v1/contacts?leadForm=<id>`.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    responses: { 200: { description: '`{ forms: [LeadForm] }`', content: { 'application/json': { schema: { type: 'object', properties: { forms: { type: 'array', items: { '$ref': '#/components/schemas/LeadForm' } } } } } } }, 400: { description: 'Missing project.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const project = await leadFormProject(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { forms: await serializeLeadForms(project, await listLeadForms(project)) }
})
