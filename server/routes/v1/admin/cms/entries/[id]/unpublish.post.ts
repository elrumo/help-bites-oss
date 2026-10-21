defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'unpublishCmsEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Unpublish an entry',
    description: 'The page answers 404 and the delivery API stops serving it; the working copy stays. Sends the `cms.entry.unpublished` event webhook.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ entry }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedCmsEntry(ctx, event)
  await unpublishCmsEntry(project, row)
  return { entry: serializeCmsEntry(project, row) }
})
