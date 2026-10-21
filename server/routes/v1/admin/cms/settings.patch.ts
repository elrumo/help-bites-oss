defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'updateCmsSettings', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Change the Pages settings',
    description: 'Only the keys sent change; `brief` merges key by key.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], example: { project: 'p1', previewUrl: 'http://localhost:5173/{slug}', brief: { audience: 'Indie iOS developers', valueProposition: 'Ship support without leaving Xcode.' } } } } } },
    responses: { 200: { description: '`{ settings }`' }, 400: { description: 'Invalid preview URL.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const project = await cmsProject(ctx, event, body)
  return { settings: await saveCmsSettings(project, body) }
})
