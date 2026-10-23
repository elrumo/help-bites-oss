defineRouteMeta({
  openAPI: {
    tags: ['End user'],
    summary: 'Public project config',
    description: 'What the embed needs before it has a token: name, theme and the origins allowed to host the widget. `look` is the project\'s look from its Brand kit (accent, logo, fonts, corner radius; `theme.accent` is the same colour), `feedbackStyle` is what the public feedback board wears (the project style with the board\'s own choices over it, every gap filled), and `widgetHome` says the chat opens on a Home tab (read it from GET /v1/hub/{pk}). Unauthenticated.',
    operationId: 'getPublicProject',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' }, description: 'Project public key (pk_…)' }, { name: 'widget', in: 'query', schema: { type: 'string', enum: ['1'] }, description: 'Sent by the chat widget when it loads inside a host page; records that the widget is installed (the project\'s setup turns green).' }],
    responses: { 200: { description: 'Public project configuration.', content: { 'application/json': { schema: { type: 'object', required: ['id', 'publicKey', 'name'], properties: { id: { type: 'string', example: 'project_123' }, publicKey: { type: 'string', example: 'pk_example' }, name: { type: 'string', example: 'Acme' }, siteUrl: { type: 'string', format: 'uri', example: 'https://acme.example' }, inboxPath: { type: 'string', example: '/support' }, theme: { type: 'object', example: { accent: '#2563eb', dark: false } }, widgetStyle: { type: 'object', description: 'The style the chat widget wears: the project style with the widget\'s own choices over it, every gap filled. `light` and `dark` are complete palettes (accent, background, surface, text, muted, border), `radius` is pixels, `shadowCss` a ready box-shadow, `scheme` auto, light or dark. See docs/STYLE.md.' }, allowedOrigins: { type: 'array', items: { type: 'string' }, example: ['https://acme.example'] }, allowAttachments: { type: 'boolean', example: true }, allowAnonymousUsers: { type: 'boolean', description: 'Whether POST /v1/anonymous/session is open for this project.' }, guestSurfaces: { type: 'array', items: { type: 'string', enum: ['chat', 'feedback', 'comments'] }, description: 'The surfaces POST /v1/anonymous/guest opens; empty when guests are off.' }, chatNotice: { type: 'string', description: 'Fixed informational line shown at the top of a new chat.', example: 'A human always reads this chat; an AI may answer first.' }, poweredBy: { type: 'object', nullable: true, properties: { url: { type: 'string', format: 'uri' } }, description: 'The "Powered by HelpBites" link to show, or null when the plan removes the branding.' } } } } } }, 404: { description: 'Unknown project' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  // The chat frame, loaded inside a host page: the widget is installed. Losing the stamp loses nothing.
  if (getQuery(event).widget === '1') await markWidgetSeen(project).catch(() => {})
  const payload = serializePublicProject(project)
  // Only worth the extra query when the embed will actually show the picker.
  if (payload.letUsersChooseType) payload.types = await listSelectableTypes(project)
  payload.poweredBy = await poweredByFor(project)
  return payload
})
