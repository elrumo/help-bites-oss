defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'createCmsEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create an entry',
    description: 'A draft. `type` is a root component (default `page`). `template` starts a page from a template (`GET /v1/admin/cms/templates`), with the project\'s name in its copy; otherwise send `content` (a block tree: `{ component, ...fields }`, children in `blocks` fields; `_uid`s are added) or get an empty one. `slug` is made from the name unless sent; the project\'s first entry is `home`. The content is checked against the components: values are fitted to their field types and blocks a field does not allow are dropped, each listed in `issues`.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], example: { project: 'p1', name: 'Launch', slug: 'launch', template: 'saas' } } } } },
    responses: { 200: { description: '`{ entry, issues }`' }, 400: { description: 'Invalid value.' }, 409: { description: 'The slug is taken.' }, 413: { description: 'The content is larger than 512 KB.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const project = await cmsProject(ctx, event, body)
  const { row, issues } = await createCmsEntry(project, body)
  return { entry: serializeCmsEntry(project, row), issues }
})
