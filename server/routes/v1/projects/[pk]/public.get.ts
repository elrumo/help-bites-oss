defineRouteMeta({
  openAPI: {
    tags: ['End user'],
    summary: 'Public project config',
    description: 'What the embed needs before it has a token: name, theme and the origins allowed to host the widget. Unauthenticated.',
    operationId: 'getPublicProject',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' }, description: 'Project public key (pk_…)' }],
    responses: { 200: { description: 'Public project configuration.', content: { 'application/json': { schema: { type: 'object', required: ['id', 'publicKey', 'name'], properties: { id: { type: 'string', example: 'project_123' }, publicKey: { type: 'string', example: 'pk_example' }, name: { type: 'string', example: 'Acme' }, siteUrl: { type: 'string', format: 'uri', example: 'https://acme.example' }, inboxPath: { type: 'string', example: '/support' }, theme: { type: 'object', example: { accent: '#2563eb', dark: false } }, allowedOrigins: { type: 'array', items: { type: 'string' }, example: ['https://acme.example'] }, allowAttachments: { type: 'boolean', example: true }, allowAnonymousUsers: { type: 'boolean', description: 'Whether POST /v1/anonymous/session is open for this project.' }, chatNotice: { type: 'string', description: 'Fixed informational line shown at the top of a new chat.', example: 'A human always reads this chat; an AI may answer first.' }, poweredBy: { type: 'object', nullable: true, properties: { url: { type: 'string', format: 'uri' } }, description: 'The "Powered by HelpBites" link to show, or null when the plan removes the branding.' } } } } } }, 404: { description: 'Unknown project' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  const payload = serializePublicProject(project)
  // Only worth the extra query when the embed will actually show the picker.
  if (payload.letUsersChooseType) payload.types = await listSelectableTypes(project)
  payload.poweredBy = await poweredByFor(project)
  return payload
})
