import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'AI triage of all unresolved errors: what is pressing and how to fix it', operationId: 'analyzeErrorOverview', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const body = (await readBody(event).catch(() => ({}))) as { project?: string }
  return await analyzeErrorOverview(await requireProject(ctx, clampText(body.project, 40)))
})
