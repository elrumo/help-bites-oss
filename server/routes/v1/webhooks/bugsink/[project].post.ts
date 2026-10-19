import { parseBugsinkWebhook } from '#shared/errors'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Receive a Bugsink custom webhook alert', operationId: 'ingestBugsinkAlert', security: [{}] } })

export default defineEventHandler(async (event) => {
  const project = await loadProjectUnscoped(getRouterParam(event, 'project') || '')
  verifyErrorWebhook(event, project, 'bugsink')
  const body = await readBody(event).catch(() => ({}))
  for (const issue of parseBugsinkWebhook(body)) await ingestErrorAlert(project, 'bugsink', issue)
  return { ok: true }
})
