import { readChangelogNotifyRunInput } from '#shared/changelog'

defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'runChangelogNotify', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }],
    summary: 'Run a changelog notification job now',
    description: 'Runs one beat of the scheduler for the project by hand: the `instant` sweep (entries published and gone quiet) or the `weekly` digest (if it is due and not already sent). With `dryRun: true` it only reports what it would do: nothing is sent or marked. The scheduler itself runs every five minutes when the server has `ENABLE_CHANGELOG_NOTIFY=true`. Not for an admin token.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator names it; the project secret acts on its own project' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['job'], properties: { job: { type: 'string', enum: ['instant', 'weekly'] }, dryRun: { type: 'boolean' }, now: { type: 'string', format: 'date-time', description: 'Run the beat as of this moment: a catch-up after downtime, or a test' } } } } } },
    responses: { 200: { description: 'What the job did (or would do).' }, 400: { description: 'No valid job.' }, 403: { description: 'An admin token cannot run it.' }, 404: { description: 'No notifications on this changelog.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  requireServerWriter(writer)
  const project = await changelogWriterProject(event, writer)
  requireChangelogNotify(project)
  const { job, dryRun, now, errors } = readChangelogNotifyRunInput(await readBody(event).catch(() => ({})))
  if (errors.length || !job) throw createError({ statusCode: 400, statusMessage: errors.join('; ') || 'job must be instant or weekly' })
  return job === 'instant' ? await runChangelogInstantSweep(project, now ?? new Date(), { dryRun }) : await runChangelogWeeklyDigest(project, now ?? new Date(), { dryRun })
})
