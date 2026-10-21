defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'completeOnboardingFlow', security: [{ EndUserToken: [] }],
    summary: 'Report that a person finished or skipped a flow',
    description: 'Send the person\'s identity token. HelpBites remembers the outcome on their contact, so segments can ask for "Finished onboarding" and automations can follow up. `public/onboarding.js` calls this itself when you pass `data-token`. Safe to repeat: the latest outcome wins.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { outcome: { type: 'string', enum: ['completed', 'skipped'] } } }, example: { outcome: 'completed' } } } },
    responses: { 200: { description: '`{ ok: true }`' }, 401: { description: 'Missing or invalid identity token.' }, 404: { description: 'No such flow in the token\'s project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { project, endUser } = await requireEndUser(event, { ensure: true, write: true })
  if (getRouterParam(event, 'pk') !== project.get('publicKey')) throw createError({ statusCode: 404, statusMessage: 'Flow not found' })
  const body = await readBody(event).catch(() => ({})) as { outcome?: unknown }
  await recordOnboardingOutcome(project, endUser!, String(getRouterParam(event, 'key') || '').toLowerCase(), body?.outcome === 'skipped' ? 'skipped' : 'completed')
  return { ok: true }
})
