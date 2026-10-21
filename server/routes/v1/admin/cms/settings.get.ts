defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'getCmsSettings', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Read the Pages settings',
    description: '`previewUrl`: your own site, which the editor\'s "Your site" preview frames (`{slug}` becomes the entry\'s slug). `brief`: the messaging brief the assistant writes and reads (audience, problem, valueProposition, pillars, proof, tone, callToAction).',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    responses: { 200: { description: '`{ settings }`' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await cmsProject(ctx, event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { settings: cmsSettingsOf(project) }
})
