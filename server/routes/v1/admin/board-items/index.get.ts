import { BOARD_ITEM_KINDS, type BoardItemKind } from '#shared/board'
import { CONVERSATION_PRIORITIES } from '#shared/support'

defineRouteMeta({
  openAPI: {
    tags: ['Board'], operationId: 'listBoardItems', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List a project board',
    description: 'Every item on the project board in rank order (up to 1,000), with its linked feedback posts and conversations resolved. Links whose post or conversation was deleted are skipped. `voteCount` sums the votes of the linked posts that are not hidden. Narrow to the items linked to one conversation or one post with `conversation` or `feedbackPost`, to one `kind` (task, epic or release), or to the cards of one epic or release with `epic` or `release`. Filter further with `status`, `assignee`, `priority`, `label` and `q`; they combine. An epic or release carries `progress` (its cards and how many are done).',
    parameters: [
      { name: 'project', in: 'query', required: true, schema: { type: 'string' }, description: 'Project id' },
      { name: 'conversation', in: 'query', schema: { type: 'string' }, description: 'Only items linked to this conversation id' },
      { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Only items in this status key' },
      { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Page size; omit for every item' },
      { name: 'offset', in: 'query', schema: { type: 'integer' }, description: 'Items to skip' },
      { name: 'feedbackPost', in: 'query', schema: { type: 'string' }, description: 'Only items linked to this post (id or number)' },
      { name: 'kind', in: 'query', schema: { type: 'string', enum: ['task', 'epic', 'release'] }, description: 'Only cards, only epics or only releases' },
      { name: 'epic', in: 'query', schema: { type: 'string' }, description: 'Only the cards of this epic (its id or #N)' },
      { name: 'release', in: 'query', schema: { type: 'string' }, description: 'Only the items of this release (its id or #N)' },
      { name: 'assignee', in: 'query', schema: { type: 'string' }, description: 'Only items assigned to this member id; `none` for unassigned items' },
      { name: 'priority', in: 'query', schema: { type: 'string', enum: ['low', 'normal', 'high', 'urgent', 'none'] }, description: 'Only items with this priority; `none` for items without one' },
      { name: 'label', in: 'query', schema: { type: 'string' }, description: 'Only items carrying this label key' },
      { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Only items whose title or description contains this text, or whose number matches (`#12` or `12`)' }
    ],
    responses: { 200: { description: 'Items, in rank order.', content: { 'application/json': { schema: { type: 'object', properties: { total: { type: 'integer' }, items: { type: 'array', items: { '$ref': '#/components/schemas/BoardItem' } } } } } } }, 400: { description: 'Missing project.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const projectId = String(query.project || '')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=<projectId>' })
  const project = await requireProject(ctx, projectId)
  const filter: Parameters<typeof listBoardItems>[1] = {}
  if (query.conversation) filter.conversation = String(query.conversation)
  if (query.feedbackPost) {
    const post = await findFeedbackPost(project, String(query.feedbackPost).replace(/^#/, ''))
    if (!post) return { total: 0, items: [] }
    filter.feedbackPost = post.id
  }
  if (query.kind) {
    if (!(BOARD_ITEM_KINDS as readonly string[]).includes(String(query.kind))) throw createError({ statusCode: 400, statusMessage: `kind must be one of ${BOARD_ITEM_KINDS.join(', ')}` })
    filter.kind = String(query.kind) as BoardItemKind
  }
  for (const [name, field] of [['epic', 'epicId'], ['release', 'releaseId']] as const) {
    if (!query[name]) continue
    const parent = await findBoardItem(project, String(query[name]))
    if (!parent) return { total: 0, items: [] }
    filter[field] = parent.id
  }
  let items = await listBoardItems(project, filter)
  if (query.status) items = items.filter(item => item.status === String(query.status))
  if (query.assignee) items = items.filter(item => (String(query.assignee) === 'none' ? !item.assigneeId : item.assigneeId === String(query.assignee)))
  if (query.priority) {
    const priority = String(query.priority)
    if (priority !== 'none' && !(CONVERSATION_PRIORITIES as readonly string[]).includes(priority)) throw createError({ statusCode: 400, statusMessage: `priority must be one of ${CONVERSATION_PRIORITIES.join(', ')}, none` })
    items = items.filter(item => item.priority === (priority === 'none' ? '' : priority))
  }
  if (query.label) items = items.filter(item => item.labels.includes(String(query.label)))
  if (query.q) {
    const needle = String(query.q).trim().toLowerCase()
    const number = /^#?\d+$/.test(needle) ? Number(needle.replace('#', '')) : null
    items = items.filter(item => item.number === number || item.title.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle))
  }
  const total = items.length
  const offset = Math.max(0, Number(query.offset) || 0)
  const limit = Number(query.limit) > 0 ? Number(query.limit) : total
  return { total, items: items.slice(offset, offset + limit) }
})
