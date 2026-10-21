defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'updateCmsEntry', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit an entry',
    description: 'Only the keys sent change: `name`, `slug`, `content` (the whole tree) and `style` (`accent`, `mode` light/dark/auto, `radius` sharp/soft/round, `headingFont` and `bodyFont` as Google Fonts names, `width` narrow/normal/wide; merged key by key). Edits change the working copy only: visitors keep the published version until you publish again. Changing the slug of a published page moves it at once.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { name: 'Launch', style: { accent: '#0ea5e9', mode: 'dark' } } } } } },
    responses: { 200: { description: '`{ entry, issues }`' }, 400: { description: 'Invalid value.' }, 404: { description: 'Not found.' }, 409: { description: 'The slug is taken.' }, 413: { description: 'The content is larger than 512 KB.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedCmsEntry(ctx, event)
  const issues = await updateCmsEntry(project, row, (await readBody(event).catch(() => ({}))) || {})
  return { entry: serializeCmsEntry(project, row), issues }
})
