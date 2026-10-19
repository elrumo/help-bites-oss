import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'AI analysis of an error with a suggested fix, or the prompt for a coding agent', operationId: 'analyzeErrorIssue', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

// `prompt: true` returns the error context (event + the project's source files) without calling the AI,
// for pasting into a coding agent.
export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const body = (await readBody(event).catch(() => ({}))) as { project?: string, link?: string, prompt?: boolean, refresh?: boolean }
  const project = await requireProject(ctx, clampText(body.project, 40))
  const link = errorLinkOf(project, clampText(body.link, 40))
  if (!link) throw createError({ statusCode: 404, statusMessage: 'Error tracking is not connected' })
  const providerId = providerOf(link).id
  const issueId = getRouterParam(event, 'id') || ''
  if (body.prompt) return await errorPrompt(project, providerId, issueId, link.linkId || MAIN_LINK)
  return await analyzeError(project, providerId, issueId, link.linkId || MAIN_LINK, body.refresh === true)
})
