defineRouteMeta({
  openAPI: {
    tags: ['Revenue'], operationId: 'getTestflight', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'TestFlight usage',
    description: 'The App Store Connect account\'s apps (up to 10), each with its 8 newest builds and their TestFlight usage: installs, sessions, crashes, invites and feedback, summed per build and per app. Read through the connected App Store source\'s key, which needs a role that can see apps (Developer, App Manager or Admin); one that only reads sales is answered 502. Cached for ten minutes; `fresh=1` skips the cache.',
    parameters: [{ name: 'project', in: 'query', required: true, schema: { type: 'string' } }, { name: 'fresh', in: 'query', schema: { type: 'string', enum: ['1'] } }],
    responses: { 200: { description: '`{ report: TestflightReport }`' }, 404: { description: 'Project not found, or the App Store is not connected.' }, 502: { description: 'Apple refused the key or the request.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const query = getQuery(event)
  const project = await requireProject(ctx, String(query.project || ''))
  const row = await requireRevenueSource(project, 'apple')
  setHeader(event, 'Cache-Control', 'no-store')
  return { report: await cachedTestflightReport(project.id || '', credentialsOf(row), query.fresh === '1') }
})
