defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'getChangelogGenerateRun', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }, { EndUserToken: [] }],
    summary: 'The last AI changelog run from commits',
    description: 'The state of the most recent run, started by hand or by a GitHub push: `running`, `done` or `failed`, with how many entries it created and how many commits it skipped (already written up). `run` is null before the first.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator names it; the project secret and an admin token act on their own project' }],
    responses: { 200: { description: '`{ run }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  return { run: readChangelogRun(await changelogWriterProject(event, writer)) }
})
