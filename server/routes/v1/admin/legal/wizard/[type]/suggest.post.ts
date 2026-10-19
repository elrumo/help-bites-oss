defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'suggestLegalAnswers', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Suggest wizard answers from the project\'s GitHub repos',
    description: 'Reads the project\'s connected GitHub repos (read-only: the file list and a few dependency manifests) and maps the SDKs and services found to wizard answers, with the evidence for each. Nothing is saved. `ai: true` also asks the AI provider about dependencies the built-in table does not know (privacy policy only); it sends dependency names, never code.',
    parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['privacy', 'terms', 'cookies', 'refund'] } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { project: { type: 'string' }, ai: { type: 'boolean' } }, required: ['project'] } } } },
    responses: { 200: { description: '`{ answers, evidence: { [questionId]: string[] }, repos: [{ repo, read }], ai }`' }, 400: { description: 'The project has no repos.' }, 501: { description: '`ai: true` but no AI provider.' }, 502: { description: 'GitHub could not be read.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const type = getRouterParam(event, 'type')
  if (!isLegalType(type)) throw createError({ statusCode: 404, statusMessage: 'Unknown document type' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  return await suggestLegalFromRepos(ctx, await legalProject(ctx, event, body), type, body.ai === true)
})
