defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'createBoardItemFromFeedback', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a board item from a feedback post',
    description: 'Files a new board item for a feedback post and links the post to it. When an AI provider is configured (workspace settings, or `LITELLM_API_BASE_URL`) the AI writes the item’s title, Markdown description, `priority` (from the post’s content, votes and comments) and labels, using only the labels the board defines; the post is treated as data. Without AI, or with `ai: false`, or when the AI’s answer is unusable, the item takes the post’s own title and text, so the call always works. The post stays linked to every other item it already feeds: a post can belong to many items, an item to many posts (attach more with `POST /v1/admin/board-items/{id}/links`). `ai` in the response says whether the AI wrote it. Metered like every AI call; rate limited to 20 AI drafts a minute per agent.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['postId'], properties: {
      postId: { type: 'string', example: '#12', description: 'The post’s id or `#N` number' },
      ai: { type: 'boolean', default: true, description: 'false skips the AI and copies the post' }
    } } } } },
    responses: { 200: { description: 'The created item, linked to the post.', content: { 'application/json': { schema: { type: 'object', properties: { item: { '$ref': '#/components/schemas/BoardItem' }, ai: { type: 'boolean' } } } } } }, 400: { description: 'Missing postId, or the item cannot be created.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project or post not found.' }, 429: { description: 'Rate limited.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const projectId = String(getQuery(event).project || '')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=<projectId>' })
  const project = await requireProject(ctx, projectId)
  const body = (await readBody(event).catch(() => ({}))) as { postId?: unknown, ai?: unknown }
  const postId = String(body.postId ?? '').trim()
  if (!postId) throw createError({ statusCode: 400, statusMessage: 'postId is required' })
  const { row, ai } = await createBoardItemFromFeedback(ctx, project, postId, { ai: body.ai !== false })
  return { item: await serializeBoardItem(project, row), ai }
})
