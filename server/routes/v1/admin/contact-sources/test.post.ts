import type { SourceKind } from '../../../../utils/contactSources'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'testContactSource', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Connect to a database and list its fields',
    description: 'Before saving a source: `{ project, kind, config, secret }`. For a saved one: `{ project, source }` (its stored credential is used unless you pass `secret`). Returns the columns to map and a few rows (columns that look like passwords, hashes or tokens are left out of the sample).',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, source: { type: 'string' }, kind: { type: 'string', enum: ['parse', 'postgres', 'firestore'] }, config: { type: 'object' }, secret: { description: 'Parse: `{ masterKey }`. Postgres: `{ url }`. Firestore: the service account JSON.' } } } } } },
    responses: { 200: { description: '`{ fields, sample, idType }`' }, 400: { description: 'Bad settings, or a host HelpBites will not connect to.' }, 402: { description: 'The plan does not include database sync.' }, 502: { description: 'The database refused or failed.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  await assertFeature(ctx.workspace, 'contactSources')
  const body = await readObjectBody(event)
  const project = await requireProject(ctx, String(body.project || ''))
  const saved = typeof body.source === 'string' && body.source ? await getProjectSource(project, body.source) : null
  const kind = (saved?.get('kind') || body.kind) as SourceKind
  const driver = sourceDriver(kind)
  // Testing comes before mapping, so a missing mapping is fine here.
  const config = { ...readSourceConfig(kind, { ...(saved?.get('config') || {}), ...(body.config as object || {}), mapping: { email: 'email' } }) }
  const secret = driver.readSecret(body.secret !== undefined ? body.secret : saved ? sourceSecret(saved) : undefined)
  return driver.test(config, secret)
})
