defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'listCmsComponents', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List components',
    description: 'Every component the project can use: the built-ins (`builtin: true`, read-only, ids starting with `hb_`) and then the project\'s own. Each has its `key` (what a block\'s `component` names), `fields` (the schema), and its `html` and `css` template. `root` components are entry types; `nestable` ones go inside a `blocks` field.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    responses: { 200: { description: '`{ components }`' }, 400: { description: 'Missing project.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await cmsProject(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { components: await cmsComponentList(project) }
})
