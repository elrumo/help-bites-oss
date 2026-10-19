import { parseAlertWebhook } from '#shared/errors'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Receive a GlitchTip issue alert', operationId: 'ingestGlitchTipAlert', security: [{}] } })

export default defineEventHandler(async (event) => {
  const project = await loadProjectUnscoped(getRouterParam(event, 'project') || '')
  verifyErrorWebhook(event, project, 'glitchtip')
  const body = await readBody(event).catch(() => ({}))
  for (const issue of parseAlertWebhook(body)) await ingestErrorAlert(project, 'glitchtip', issue)
  return { ok: true }
})
