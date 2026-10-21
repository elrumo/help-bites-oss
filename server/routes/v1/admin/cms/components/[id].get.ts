defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'getCmsComponent', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Read a component',
    description: 'One of the project\'s own components. Built-ins come with the list.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ component }`' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scopedCmsComponent(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { component: cmsComponentDef(row) }
})
