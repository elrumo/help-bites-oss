import { BOARD_TITLE_GROUNDING, boardTitlePrompt, readBoardTitle } from '#shared/boardTitle'

defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'suggestBoardItemTitle', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Write a board item\'s title with AI',
    description: 'Reads a description (the first 4,000 characters) and has the AI propose a short title in the same language. Nothing is saved: the call returns the text, and you send it as `title` to `POST /v1/admin/board-items`. The description is treated as data. The panel, the app and the iOS share sheet call this when an item is created with no title, a second after the description stops changing, and from the title field\'s AI button. The AI call can take several seconds. Metered like every AI call; rate limited to 30 a minute per project.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['description'], properties: { description: { type: 'string', example: 'Customers keep asking to export their contacts as a spreadsheet…' } } } } } },
    responses: {
      200: { description: 'The proposed title.', content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' } } } } } },
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
  const body = (await readBody(event).catch(() => ({}))) as { description?: unknown }
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) throw createError({ statusCode: 400, statusMessage: 'description is required' })
  const route = await resolveAi(await workspaceOfRow(project))
  if (!route) throw createError({ statusCode: 501, statusMessage: 'No AI provider is configured. Add one in the workspace AI settings, or set LITELLM_API_BASE_URL on the server.' })
  await rateLimit(`sb:rl:boardtitle:${project.id}`, LIMITS.boardTitleAiPerProject.limit, LIMITS.boardTitleAiPerProject.window)
  let title: string | null = null
  try {
    const { text } = await chatCompletion(route, { messages: [{ role: 'system', content: BOARD_TITLE_GROUNDING }, { role: 'user', content: boardTitlePrompt(description) }], temperature: 0.3, max_tokens: 120 }, { timeoutMs: 30_000 })
    title = readBoardTitle(text)
  } catch (error) {
    console.error('[board] title AI failed', (error as Error).message)
  }
  if (!title) throw createError({ statusCode: 502, statusMessage: 'The AI could not write a title. Try again.' })
  return { title }
})
