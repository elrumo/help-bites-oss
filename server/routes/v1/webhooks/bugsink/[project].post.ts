import { parseBugsinkWebhook } from '#shared/errors'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Receive a Bugsink custom webhook alert', operationId: 'ingestBugsinkAlert', security: [{}] } })

export default defineEventHandler(async (event) => {
  const { project, link } = verifyErrorWebhook(event, await loadProjectUnscoped(getRouterParam(event, 'project') || '').catch(() => null), 'bugsink')
  const body = await readBody(event).catch(() => ({}))
  for (const issue of parseBugsinkWebhook(body)) await ingestErrorAlert(project, link, issue)
  return { ok: true }
})
