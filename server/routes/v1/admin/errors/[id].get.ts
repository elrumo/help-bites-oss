import { clampText } from '#shared/support'
import { errorDetailOf, flattenEvent } from '#shared/errors'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Get one error issue with its latest event', operationId: 'getErrorIssue', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const query = getQuery(event)
  const project = await requireProject(ctx, clampText(query.project, 40))
  const link = errorLinkOf(project, clampText(query.link, 40))
  if (!link) throw createError({ statusCode: 404, statusMessage: 'Error tracking is not connected' })
  const { issue, event: latest } = await errorIssueDetail(project, providerOf(link).id, getRouterParam(event, 'id') || '', link.linkId)
  return errorDetailOf(issue, flattenEvent(latest))
})
