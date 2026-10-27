import { clientSource } from '../../../../utils/clientSource'

defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'createBoardItemsFromFeedback', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create board items from a feedback post',
    description: 'Files board items for a feedback post and links the post to each. When an AI provider is configured (workspace settings, or `LITELLM_API_BASE_URL`) the AI decides whether the post is one piece of work (nearly always) or up to 5 separate ones, and writes each item’s title, Markdown description, `priority` (from the post’s content, votes and comments) and labels, using only the labels the board defines; the post is treated as data. Without AI, or with `ai: false`, or when the AI’s answer is unusable, one item takes the post’s own title and text, so the call always works. The AI call can take several seconds. The post stays linked to every other item it already feeds: a post can belong to many items, an item to many posts (attach more with `POST /v1/admin/board-items/{id}/links`). `items` lists every item created (`item` is the first); `ai` says whether the AI wrote them. Metered like every AI call; rate limited to 20 AI drafts a minute per agent.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['postId'], properties: {
      postId: { type: 'string', example: '#12', description: 'The post’s id or `#N` number' },
      ai: { type: 'boolean', default: true, description: 'false skips the AI and copies the post' }
    } } } } },
    responses: { 200: { description: 'The created items, each linked to the post.', content: { 'application/json': { schema: { type: 'object', properties: { item: { '$ref': '#/components/schemas/BoardItem' }, items: { type: 'array', items: { '$ref': '#/components/schemas/BoardItem' } }, ai: { type: 'boolean' } } } } } }, 400: { description: 'Missing postId, or the item cannot be created.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project or post not found.' }, 429: { description: 'Rate limited.' } }
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
  const { rows, ai } = await createBoardItemsFromFeedback(ctx, project, postId, { ai: body.ai !== false, source: clientSource(event) })
  const items = await serializeBoardItems(project, rows)
  return { item: items[0], items, ai }
})
