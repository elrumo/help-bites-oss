defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Inbox',
    description: 'Conversations across every project, newest activity first. Page with `before` (ISO lastMessageAt of the last row).',
    operationId: 'listAgentConversations',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    parameters: [
      { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id' },
      { name: 'status', in: 'query', schema: { type: 'string' } },
      { name: 'type', in: 'query', schema: { type: 'string' } },
      { name: 'assignee', in: 'query', schema: { type: 'string' } },
      { name: 'priority', in: 'query', schema: { type: 'string' } },
      { name: 'tag', in: 'query', schema: { type: 'string' } },
      { name: 'archived', in: 'query', schema: { type: 'string', enum: ['true', 'any'] }, description: 'Archived conversations are left out of the queue by default. `true` lists only the archived; `any` lists both.' },
      { name: 'unread', in: 'query', schema: { type: 'boolean' }, description: 'Only conversations with unread user messages' },
      { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Matches end-user name, email or external id' },
      { name: 'endUser', in: 'query', schema: { type: 'string' }, description: 'One contact\'s conversations (EndUser id)' },
      { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
    ],
    responses: { 200: { description: 'Inbox page and queue facets. `counts` is grouped by status, type, and assignee.', content: { 'application/json': { schema: { type: 'object', required: ['conversations', 'endUsers', 'hasMore', 'totalUnread', 'counts'], properties: { conversations: { type: 'array', items: { '$ref': '#/components/schemas/Conversation' } }, endUsers: { type: 'object', additionalProperties: { type: 'object', description: 'Serialized end user.' } }, hasMore: { type: 'boolean', example: false }, totalUnread: { type: 'integer', example: 4 }, archivedCount: { type: 'integer', example: 2, description: 'Archived conversations in scope.' }, counts: { type: 'object', example: { status: { open: 3 }, type: { report: 2, support: 1 }, assignee: { unassigned: 2, agent_123: 1 } } }, unreadByProject: { type: 'object', additionalProperties: { type: 'integer' }, description: 'Conversations with unread agent messages, keyed by project id.', example: { proj_123: 2 } } } } } } } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const Parse = useParse()
  const { project, status, type, assignee, priority, tag, unread, archived, q, endUser, before, limit } = getQuery(event)
  const size = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), 200)
  const only = typeof project === 'string' && project ? await requireProject(ctx, project) : null
  const workspaceProjects = await projectPointers(ctx)
  // The page, the contact match and the facets follow ?project, else the whole
  // workspace; the unread totals (sidebar badges) always cover the workspace.
  const inScope = <Q extends InstanceType<typeof Parse.Query>>(query: Q): Q => only ? query.equalTo('project', only) : query.containedIn('project', workspaceProjects)

  const query = inScope(new Parse.Query('Conversation').descending('lastMessageAt').limit(size).include('endUser'))
  // The queue hides archived threads; ?archived=true is the Archived view, ?archived=any both.
  if (archived === 'true' || archived === '1') query.exists('archivedAt')
  else if (archived !== 'any') query.doesNotExist('archivedAt')
  if (typeof status === 'string' && status) query.equalTo('status', status)
  if (typeof type === 'string' && type) query.equalTo('type', type)
  if (typeof assignee === 'string' && assignee) query.equalTo('assignee', Parse.Object.extend('_User').createWithoutData(assignee))
  if (typeof priority === 'string' && priority) query.equalTo('priority', priority)
  if (typeof tag === 'string' && tag) query.equalTo('tags', tag.toLowerCase())
  if (unread === 'true' || unread === '1') query.greaterThan('unreadByAgent', 0)
  if (typeof endUser === 'string' && endUser) query.equalTo('endUser', Parse.Object.extend('EndUser').createWithoutData(endUser))
  if (typeof before === 'string' && before) {
    const date = new Date(before)
    if (!Number.isNaN(date.getTime())) query.lessThan('lastMessageAt', date)
  }
  if (typeof q === 'string' && q.trim()) {
    const term = q.trim()
    const byName = inScope(new Parse.Query('EndUser').matches('name', escapeRegex(term), 'i'))
    const byEmail = inScope(new Parse.Query('EndUser').matches('email', escapeRegex(term), 'i'))
    const byExternal = inScope(new Parse.Query('EndUser').equalTo('externalId', term))
    const users = await Parse.Query.or(byName, byEmail, byExternal).limit(200).find(MASTER)
    query.containedIn('endUser', users)
  }

  const rows = await query.find(MASTER)
  const endUsers: Record<string, ReturnType<typeof serializeEndUser>> = {}
  for (const row of rows) {
    const user = row.get('endUser') as ParseObject | undefined
    if (user?.id) endUsers[user.id] = serializeEndUser(user)
  }

  const totalUnreadRows = await new Parse.Query('Conversation').containedIn('project', workspaceProjects).doesNotExist('archivedAt').greaterThan('unreadByAgent', 0).select('unreadByAgent', 'project').limit(1000).find(MASTER)
  const unreadByProject: Record<string, number> = {}
  for (const row of totalUnreadRows) { const pid = pointerId(row.get('project')); if (pid) unreadByProject[pid] = (unreadByProject[pid] || 0) + 1 }
  const facetQuery = inScope(new Parse.Query('Conversation').doesNotExist('archivedAt').select('status', 'type', 'assignee').limit(1000))
  const archivedCount = await inScope(new Parse.Query('Conversation').exists('archivedAt')).count(MASTER)
  // ponytail: dashboard facets are capped at 1,000 rows; use Mongo aggregation only when a project outgrows that queue.
  const facets = await facetQuery.find(MASTER)
  const counts = { status: {} as Record<string, number>, type: {} as Record<string, number>, assignee: {} as Record<string, number> }
  for (const row of facets) {
    for (const [bucket, key] of [['status', String(row.get('status') || 'open')], ['type', String(row.get('type') || 'support')], ['assignee', pointerId(row.get('assignee')) || 'unassigned']] as const) counts[bucket][key] = (counts[bucket][key] || 0) + 1
  }
  return {
    conversations: rows.map(serializeConversation),
    endUsers,
    hasMore: rows.length >= size,
    totalUnread: totalUnreadRows.reduce((sum, row) => sum + Number(row.get('unreadByAgent') || 0), 0),
    counts,
    archivedCount,
    unreadByProject
  }
})

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
