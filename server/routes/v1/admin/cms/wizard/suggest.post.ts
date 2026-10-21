defineRouteMeta({ openAPI: { tags: ['Pages'], summary: 'Suggest page wizard answers from GitHub', operationId: 'suggestCmsWizard', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Reads the project\'s linked GitHub repos (read-only; `repos` narrows them by full name, at most three are read) and asks the AI for answers to the page wizard\'s text questions, only from facts the repos show. Nothing is saved.', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], example: { project: 'p1', repos: ['acme/app'] } } } } }, responses: { 200: { description: '`{ answers }`' }, 400: { description: 'The project has no repos.' }, 501: { description: 'No AI provider.' }, 502: { description: 'GitHub or the AI could not be read.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const project = await cmsProject(ctx, event, body)
  const repos = Array.isArray(body.repos) ? body.repos.map(String) : []
  return { answers: await suggestWizardAnswers(ctx, project, repos) }
})
