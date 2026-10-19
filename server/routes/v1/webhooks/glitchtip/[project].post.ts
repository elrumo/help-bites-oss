import { parseAlertWebhook } from '#shared/errors'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Receive a GlitchTip issue alert', operationId: 'ingestGlitchTipAlert', security: [{}] } })

export default defineEventHandler(async (event) => {
  const { project, link } = verifyErrorWebhook(event, await loadProjectUnscoped(getRouterParam(event, 'project') || '').catch(() => null), 'glitchtip')
  const body = await readBody(event).catch(() => ({}))
  for (const issue of parseAlertWebhook(body)) await ingestErrorAlert(project, link, issue)
  return { ok: true }
})
