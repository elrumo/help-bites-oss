defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Receive a GlitchTip issue alert', operationId: 'ingestGlitchTipAlert', security: [{}] } })

export default defineEventHandler(async (event) => {
  const { project } = verifyErrorWebhook(event, await loadProjectUnscoped(getRouterParam(event, 'project') || '').catch(() => null), 'glitchtip')
  // An alert no longer opens a conversation; it just has the project's alert rules checked now rather than at the next minute.
  void runErrorAlerts(project).catch(error => console.warn('[error-alerts]', (error as Error).message))
  return { ok: true }
})
