defineRouteMeta({
  openAPI: {
    tags: ['Brand'], operationId: 'updateBrandAsset', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a brand kit file',
    description: 'Only the keys sent change: `name`, `description`, `kind`, `background`, `public` and `order` (files sort by it, lowest first).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { name: 'Wordmark, white', kind: 'logo', background: 'dark', public: true } } } } },
    responses: { 200: { description: '`{ asset }`' }, 400: { description: 'Invalid value.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedBrandAsset(ctx, event)
  await updateBrandAsset(row, (await readBody(event).catch(() => ({}))) || {})
  await refreshBrandLook(project)
  return { asset: serializeBrandAsset(project, row) }
})
