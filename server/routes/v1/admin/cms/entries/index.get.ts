defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'listCmsEntries', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List entries',
    description: 'Every entry of the project, drafts included, newest edit first, without their content (read one for that). `status` is draft or published; `changed` is true when the working copy differs from what visitors get. `path` is where a page is hosted.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'type', in: 'query', schema: { type: 'string' }, description: 'Only entries of this type (a root component key).' }],
    responses: { 200: { description: '`{ entries }`' }, 400: { description: 'Missing project.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await cmsProject(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  const type = String(getQuery(event).type || '')
  return { entries: (await listCmsEntries(project, type || undefined)).map(row => serializeCmsEntry(project, row, false)) }
})
