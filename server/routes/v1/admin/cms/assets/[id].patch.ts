defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'updateCmsAsset', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Rename a file or change its alt text',
    description: 'Changes `name` and `alt`. Entries keep the alt text they were saved with; pick the file again to take the new one.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { name: 'Hero screenshot', alt: 'The dashboard with three projects' } } } } },
    responses: { 200: { description: '`{ asset }`' }, 400: { description: 'Invalid value.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scopedCmsAsset(ctx, event)
  await updateCmsAsset(row, (await readBody(event).catch(() => ({}))) || {})
  return { asset: serializeCmsAsset(row) }
})
