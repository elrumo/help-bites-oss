import { BOARD_PUBLIC_GROUNDING, boardPublicPrompt, readBoardPublicDescription } from '#shared/boardTitle'

defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'suggestBoardItemPublicDescription', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Write a board item\'s public description with AI',
    description: 'Reads an item\'s internal title and description (the first 4,000 characters) and has the AI write what the public roadmap shows, for the product\'s users, in the same language: one to three plain sentences on what users will be able to do, with brand and product names, comparisons to other products ("like X does") and internal details (people, code, links, ticket numbers, dates) left out. Nothing is saved: send the text as `publicDescription` to `PATCH /v1/admin/board-items/{id}` or `POST /v1/admin/board-items`. The title and description are treated as data. The panel, the app and the iOS share sheet call this from the AI button on the public description. The AI call can take several seconds. Metered like every AI call; shares the 30 a minute per project of `suggest-title`.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['description'], properties: { title: { type: 'string', example: 'Virtual copies' }, description: { type: 'string', example: 'Let users make virtual copies of photos, stacked like Lightroom does…' } } } } } },
    responses: {
      200: { description: 'The proposed public description (Markdown).', content: { 'application/json': { schema: { type: 'object', properties: { publicDescription: { type: 'string' } } } } } },
      400: { description: 'Missing project or description.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project not found.' },
      429: { description: 'Rate limited.' }, 501: { description: 'No AI provider is configured.' }, 502: { description: 'The AI failed or gave an unusable answer.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const projectId = String(getQuery(event).project || '')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=<projectId>' })
  const project = await requireProject(ctx, projectId)
  const body = (await readBody(event).catch(() => ({}))) as { title?: unknown, description?: unknown }
  const title = typeof body.title === 'string' ? body.title : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) throw createError({ statusCode: 400, statusMessage: 'description is required' })
  const route = await resolveAi(await workspaceOfRow(project))
  if (!route) throw createError({ statusCode: 501, statusMessage: 'No AI provider is configured. Add one in the workspace AI settings, or set LITELLM_API_BASE_URL on the server.' })
  // One bucket with the title AI: both are the planning editor's AI buttons.
  await rateLimit(`sb:rl:boardtitle:${project.id}`, LIMITS.boardTitleAiPerProject.limit, LIMITS.boardTitleAiPerProject.window)
  let publicDescription: string | null = null
  try {
    const { text } = await chatCompletion(route, { messages: [{ role: 'system', content: BOARD_PUBLIC_GROUNDING }, { role: 'user', content: boardPublicPrompt(title, description) }], temperature: 0.3, max_tokens: 400 }, { timeoutMs: 30_000 })
    publicDescription = readBoardPublicDescription(text)
  } catch (error) {
    console.error('[board] public description AI failed', (error as Error).message)
  }
  if (!publicDescription) throw createError({ statusCode: 502, statusMessage: 'The AI could not write a public description. Try again.' })
  return { publicDescription }
})
