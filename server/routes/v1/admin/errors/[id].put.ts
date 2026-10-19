defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Set an issue status', operationId: 'setErrorIssueStatus', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const body = (await readBody(event).catch(() => ({}))) as { project?: string, status?: string, link?: string }
  const project = await requireProject(ctx, String(body.project || ''))
  const issueId = getRouterParam(event, 'id') || ''
  const status = String(body.status || '')
  if (!['open', 'resolved', 'closed'].includes(status)) throw createError({ statusCode: 400, statusMessage: 'Invalid error status' })
  const link = errorLinkOf(project, String(body.link || ''))
  if (!link) throw createError({ statusCode: 404, statusMessage: 'Error tracking is not connected' })
  const providerId = providerOf(link).id
  await setErrorIssueStatus(project, providerId, issueId, status, link.linkId)
  const conversation = await new (useParse()).Query('Conversation').equalTo('project', project).equalTo('idempotencyKey', errorConversationKey(providerId, issueId)).first(MASTER)
  if (conversation) await setStatus(conversation, status)
  return { conversation: conversation ? serializeConversation(conversation) : null }
})
