import { MERGE_GROUNDING, MERGE_SUGGEST_MAX, mergePrompt, readMergeSuggestions, type MergeEntryInfo } from '#shared/changelogMerge'

defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'suggestChangelogMerges', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }],
    summary: 'Suggest which changelog entries to merge, with AI',
    description: `Reads 2 to ${MERGE_SUGGEST_MAX} entries (archived ones are refused) and has the AI propose which of them describe the same change, with the title, Markdown body and tag of each merged entry. **The AI may suggest nothing**: \`merges\` is empty when no merge would serve readers. Nothing is saved: apply a suggestion with \`POST /v1/admin/changelog/entries/merge\` (\`refs\` and \`entry\` straight from it). Every ref in a suggestion is one you sent, an entry is in at most one suggestion, and each folds 2 to 10 entries. The entries are treated as data. The AI call can take several seconds. Metered like every AI call; rate limited to 20 a minute per project.`,
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator names it; the project secret acts on its own project' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['refs'], properties: { refs: { type: 'array', minItems: 2, maxItems: MERGE_SUGGEST_MAX, items: { type: 'string' }, description: 'Entry ids' } } } } } },
    responses: {
      200: { description: 'The suggested merges, possibly none.', content: { 'application/json': { schema: { type: 'object', properties: { merges: { type: 'array', items: { type: 'object', properties: { refs: { type: 'array', items: { type: 'string' } }, title: { type: 'string' }, body: { type: 'string' }, tag: { type: 'string', enum: ['new', 'improved', 'fix', 'removed', 'breaking'] }, reason: { type: 'string' } } } } } } } } },
      400: { description: 'Fewer than 2 or more than the limit of refs, or one is not an active entry of the project.' }, 401: { description: 'Admin session, API key or project secret required.' },
      429: { description: 'Rate limited.' }, 501: { description: 'No AI provider is configured.' }, 502: { description: 'The AI failed or gave an unusable answer.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  requireServerWriter(writer)
  const project = await changelogWriterProject(event, writer)
  const body = (await readBody(event).catch(() => ({}))) as { refs?: unknown }
  const ids = Array.isArray(body?.refs) ? [...new Set(body.refs.filter((r): r is string => typeof r === 'string'))] : []
  if (ids.length < 2 || ids.length > MERGE_SUGGEST_MAX) throw createError({ statusCode: 400, statusMessage: `refs is a list of 2 to ${MERGE_SUGGEST_MAX} entry ids` })
  const route = await resolveAi(await workspaceOfRow(project))
  if (!route) throw createError({ statusCode: 501, statusMessage: 'No AI provider is configured. Add one in the workspace AI settings, or set LITELLM_API_BASE_URL on the server.' })
  const rows = await new (useParse()).Query('ChangelogEntry').equalTo('project', project).notEqualTo('status', 'archived').containedIn('objectId', ids).limit(MERGE_SUGGEST_MAX).find(MASTER)
  if (rows.length !== ids.length) throw createError({ statusCode: 400, statusMessage: 'Every ref must be the id of an active entry of this project' })
  const entries: MergeEntryInfo[] = rows.map(row => ({ id: row.id || '', title: String(row.get('title') || ''), tag: String(row.get('tag') || 'improved'), summary: String(row.get('summary') || ''), body: String(row.get('body') || ''), area: String(row.get('area') || '') }))
  await rateLimit(`sb:rl:clmrgai:${project.id}`, LIMITS.changelogMergeAiPerProject.limit, LIMITS.changelogMergeAiPerProject.window)
  try {
    const { text } = await chatCompletion(route, { messages: [{ role: 'system', content: MERGE_GROUNDING }, { role: 'user', content: mergePrompt(entries) }], temperature: 0.2, max_tokens: 3000 }, { timeoutMs: 90_000 })
    // A reply that parses to no merges is a valid "nothing to merge"; one that is not JSON at all is a failure.
    if (!/[[{]/.test(text)) throw new Error('not JSON')
    return { merges: readMergeSuggestions(text, entries) }
  } catch (error) {
    console.error('[changelog] merge AI failed', (error as Error).message)
    throw createError({ statusCode: 502, statusMessage: 'The AI could not review these entries. Try again.' })
  }
})
