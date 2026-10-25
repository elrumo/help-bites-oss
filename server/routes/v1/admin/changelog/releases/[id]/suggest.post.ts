import { RELEASE_GROUNDING, readReleaseCopy, releasePrompt } from '#shared/changelogRelease'

defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'suggestChangelogReleaseCopy', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }],
    summary: 'Write a release\'s title and summary with AI',
    description: 'Reads the entries inside the release (drafts and published, not archived; the newest 150) and has the AI propose a headline and a short Markdown intro. Nothing is saved: the call returns the text, and you keep it with `PATCH /v1/admin/changelog/releases/{id}`. The entries are treated as data. The AI call can take several seconds. Metered like every AI call; rate limited to 20 a minute per project.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: { description: 'The proposed text. Either field can be empty when the model gave only one.', content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' } } } } } },
      400: { description: 'The release has no entries to read.' }, 401: { description: 'Admin session, API key or project secret required.' }, 404: { description: 'Release not found.' },
      429: { description: 'Rate limited.' }, 501: { description: 'No AI provider is configured.' }, 502: { description: 'The AI failed or gave an unusable answer.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  requireServerWriter(writer)
  const { project, row } = await loadWriterRelease(writer, getRouterParam(event, 'id') || '')
  const route = await resolveAi(await workspaceOfRow(project))
  if (!route) throw createError({ statusCode: 501, statusMessage: 'No AI provider is configured. Add one in the workspace AI settings, or set LITELLM_API_BASE_URL on the server.' })
  const entries = await listChangelogEntries(project, { release: row.id })
  if (!entries.length) throw createError({ statusCode: 400, statusMessage: 'This release has no entries yet. Add some first.' })
  await rateLimit(`sb:rl:clrelai:${project.id}`, LIMITS.changelogReleaseAiPerProject.limit, LIMITS.changelogReleaseAiPerProject.window)
  const version = String(row.get('version') || '')
  let copy
  try {
    const { text } = await chatCompletion(route, { messages: [{ role: 'system', content: RELEASE_GROUNDING }, { role: 'user', content: releasePrompt(version, entries) }], temperature: 0.3, max_tokens: 800 }, { timeoutMs: 60_000 })
    copy = readReleaseCopy(text)
  } catch (error) {
    console.error('[changelog] release AI failed', (error as Error).message)
  }
  if (!copy) throw createError({ statusCode: 502, statusMessage: 'The AI could not write this release. Try again.' })
  return copy
})
