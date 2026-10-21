defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'listLeadFiles', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List files sent through lead forms',
    description: 'The files people attached through a form\'s `file` fields, newest first: one person\'s (`contact`) or one form\'s (`form`). Each says which form and field it came through, its name, type and size; download it with `GET /v1/admin/lead-files/{id}/download`. Pass the last `createdAt` as `before` for the next page.',
    parameters: [
      { name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' },
      { name: 'contact', in: 'query', required: false, schema: { type: 'string' }, description: 'A contact\'s id' },
      { name: 'form', in: 'query', required: false, schema: { type: 'string' }, description: 'A lead form\'s id' },
      { name: 'before', in: 'query', required: false, schema: { type: 'string', format: 'date-time' } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } }
    ],
    responses: { 200: { description: '`{ files: [LeadFile] }`', content: { 'application/json': { schema: { type: 'object', properties: { files: { type: 'array', items: { '$ref': '#/components/schemas/LeadFile' } } } } } } }, 400: { description: 'Missing project, or neither contact nor form.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const project = await leadFormProject(ctx, event)
  const query = getQuery(event)
  const contactId = String(query.contact || '')
  const formId = String(query.form || '')
  if (!contactId && !formId) throw createError({ statusCode: 400, statusMessage: 'Pass ?contact=<contactId> or ?form=<formId>' })
  const before = query.before ? new Date(String(query.before)) : null
  setHeader(event, 'Cache-Control', 'no-store')
  return { files: await listLeadFiles(project, { contactId, formId, before: before && !Number.isNaN(before.getTime()) ? before : null, limit: Number(query.limit) || 100 }) }
})
