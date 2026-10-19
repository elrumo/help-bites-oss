import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'List error tracker issues', operationId: 'listErrorIssues', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const project = await requireProject(ctx, clampText(query.project, 40))
  const result = await listIssues(project, { status: clampText(query.status, 40), userId: clampText(query.user, 200), search: clampText(query.q, 300), cursor: clampText(query.cursor, 500), limit: Number(query.limit) }, clampText(query.link, 40))
  const Parse = useParse()
  const issues = await Promise.all(result.issues.map(async (issue) => {
    const conversation = await new Parse.Query('Conversation').equalTo('project', project).equalTo('idempotencyKey', errorConversationKey(issue.provider, issue.id)).first(MASTER)
    return { ...issue, conversationId: conversation?.id || '' }
  }))
  return { issues, next: result.next }
})
