defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'publishCmsEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Publish an entry',
    description: 'Freezes the working copy into the next version: the hosted page and the delivery API serve it from now on. Sends the `cms.entry.published` event webhook, so a static site can rebuild.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ entry }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedCmsEntry(ctx, event)
  await publishCmsEntry(project, row)
  return { entry: serializeCmsEntry(project, row) }
})
