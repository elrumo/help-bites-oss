import { COMMIT_RANGE_MAX_DAYS } from '#shared/changelogCommits'

defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'generateChangelogFromCommits', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }],
    summary: 'Draft changelog entries from the project\'s GitHub commits, with AI',
    description: 'Reads the commit messages of the project\'s GitHub repos (default branch; see `PUT /v1/admin/projects/{id}/repos`) and has the AI write entries from them. Runs in the background: poll `GET /v1/admin/changelog/generate`. Entries are always created as **drafts** waiting for review (`aiGenerated: true`), never published. A commit already cited by an entry is not written up again. Reads at most the newest 300 commits. Not for an admin token.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator names it; the project secret acts on its own project' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 3650, nullable: true, description: 'Only commits from the last this many days; omit or null for all' } } } } } },
    responses: { 202: { description: 'Queued.' }, 400: { description: 'Invalid range, or the project has no GitHub repos.' }, 403: { description: 'An admin token cannot generate.' }, 409: { description: 'A run is already in progress.' }, 429: { description: 'Too many runs this hour.' }, 501: { description: 'No AI provider or GitHub is not set up.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  requireServerWriter(writer)
  const project = await changelogWriterProject(event, writer)
  const body = (await readBody(event).catch(() => ({}))) as { days?: unknown }
  const days = body?.days === undefined || body.days === null ? null : Number(body.days)
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= COMMIT_RANGE_MAX_DAYS)) throw createError({ statusCode: 400, statusMessage: `days is a whole number from 1 to ${COMMIT_RANGE_MAX_DAYS}` })
  if (!githubConfigured()) throw createError({ statusCode: 501, statusMessage: 'GitHub is not set up on this server (docs/GITHUB.md).' })
  if (!projectRepos(project).length) throw createError({ statusCode: 400, statusMessage: 'This project has no GitHub repos. Connect GitHub in Settings and pick its repos first.' })
  const run = readChangelogRun(project)
  // A run that never reported back (the worker died) stops blocking after the job lease.
  if (run?.state === 'running' && Date.now() - Date.parse(run.startedAt) < 20 * 60_000) throw createError({ statusCode: 409, statusMessage: 'A run is already in progress' })
  await rateLimit(`sb:rl:clgen:${project.id}`, LIMITS.changelogGeneratePerProject.limit, LIMITS.changelogGeneratePerProject.window)
  await queueChangelogCommits(project, { days })
  setResponseStatus(event, 202)
  return { queued: true }
})
