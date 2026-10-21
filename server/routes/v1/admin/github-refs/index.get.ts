defineRouteMeta({
  openAPI: {
    tags: ['GitHub'], operationId: 'listGithubRefs', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Commits and pull requests linked to an item',
    description: 'The commits pushed to the default branch and the pull requests merged into it that mention a board item or a feedback post as `#12` (docs/GITHUB.md), newest first. `closes` is true when a closing keyword (`fixes #12`) came with it. Needs the GitHub App\'s webhook to be on.',
    parameters: [
      { name: 'project', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'kind', in: 'query', required: true, schema: { type: 'string', enum: ['board', 'feedback'] } },
      { name: 'id', in: 'query', required: true, schema: { type: 'string' }, description: 'The item or post id (or its number)' }
    ],
    responses: { 200: { description: 'The links.', content: { 'application/json': { schema: { type: 'object', properties: { refs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['commit', 'pull_request'] }, ref: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' }, closes: { type: 'boolean' }, at: { type: 'string', nullable: true } } } } } } } } }, 400: { description: 'Missing or unknown kind or id.' }, 401: { description: 'Admin session or API key required.' }, 404: { description: 'Project or item not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const projectId = String(query.project || '')
  const kind = String(query.kind || '')
  const id = String(query.id || '').trim()
  if (!projectId || !id || (kind !== 'board' && kind !== 'feedback')) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=, ?kind=board|feedback and ?id=' })
  const project = await requireProject(ctx, projectId)
  let targetId: string
  if (kind === 'board') {
    targetId = (await scoped.boardItem(ctx, id, projectId)).row.id || ''
  } else {
    const post = await findFeedbackPost(project, id.replace(/^#/, ''))
    if (!post) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
    targetId = post.id || ''
  }
  return { refs: await listGithubRefs(project, kind, targetId) }
})
