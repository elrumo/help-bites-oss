import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'AI analyses saved for a project: one per error, plus the overview', operationId: 'listErrorAnalyses', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return await savedAnalyses(await requireProject(ctx, clampText(getQuery(event).project, 40)))
})
