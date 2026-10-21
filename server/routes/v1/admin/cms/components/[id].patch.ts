defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'updateCmsComponent', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a component',
    description: 'Only the keys sent change; `fields` is the whole list. Entries keep their values when a field is renamed or removed (they stop rendering until a field takes the key again), and blocks of a component whose `key` changes render as nothing until it changes back. Published pages show the change at once: they render with the current components.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { html: '<a class="banner" href="{{@link}}">{{@text}}</a>' } } } } },
    responses: { 200: { description: '`{ component }`' }, 400: { description: 'Invalid component.' }, 404: { description: 'Not found.' }, 409: { description: 'The key is taken.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedCmsComponent(ctx, event)
  return { component: cmsComponentDef(await saveCmsComponent(project, (await readBody(event).catch(() => ({}))) || {}, row)) }
})
