defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'getCmsEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Read an entry',
    description: 'The working copy (the draft) with its content and style. This is how a site previews unpublished content from its server, with an admin key; the delivery API only serves published entries.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ entry }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedCmsEntry(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { entry: serializeCmsEntry(project, row) }
})
