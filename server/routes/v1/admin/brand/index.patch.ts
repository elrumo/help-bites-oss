defineRouteMeta({
  openAPI: {
    tags: ['Brand'], operationId: 'updateBrandKit', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a project\'s brand kit',
    description: 'Only the keys sent change. `colors`, `fonts` and `guidelines` are full lists. `page` merges key by key: `public` turns the page and `GET /v1/brand/{pk}` on, `template` is minimal, editorial or split, `theme` auto, light or dark, `radius` sharp, soft or round, `accent` a #rrggbb colour (empty: the first colour), and `sections` the sections shown, in order. A font\'s `cssUrl` must be a https://fonts.googleapis.com/css2 link; it is what the page loads to show the face.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { tagline: 'Orders, sorted.', colors: [{ name: 'Ink', hex: '#14213d', usage: 'Text and the wordmark' }, { name: 'Signal', hex: '#fca311', usage: 'Buttons and highlights' }], fonts: [{ name: 'Fraunces', role: 'display', cssUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&display=swap', weights: '400, 600' }], guidelines: [{ title: 'Clear space', body: 'Leave the height of the **A** around the logo.' }], page: { public: true, template: 'split', theme: 'auto' } } } } } },
    responses: { 200: { description: '`{ brand }`' }, 400: { description: 'Invalid value.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const project = await brandProject(ctx, event)
  return { brand: await saveBrandConfig(project, (await readBody(event).catch(() => ({}))) || {}) }
})
