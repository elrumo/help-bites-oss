import type { SourceKind } from '../../../../utils/contactSources'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'createContactSource', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Sync contacts from a database',
    description: 'Tests the connection, then saves the source and starts the first sync. `config.mapping` says which column is the email, the user id, the name, tags, an opt-in flag and attributes. `config.consent: "subscribed"` records that everyone in this source agreed to marketing email; otherwise consent comes from the mapped opt-in column, or stays as it is.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'kind', 'config', 'secret'], properties: { project: { type: 'string' }, kind: { type: 'string', enum: ['parse', 'postgres', 'firestore'] }, name: { type: 'string' }, config: { type: 'object' }, secret: {} } }, example: { project: 'p1', kind: 'parse', name: 'App users', config: { serverUrl: 'https://api.example.com/parse', appId: 'myapp', className: '_User', mapping: { externalId: 'objectId', email: 'email', name: 'username', attributes: { plan: 'plan' } }, everyMinutes: 60 }, secret: { masterKey: '…' } } } } },
    responses: { 200: { description: '`{ source }`' }, 400: { description: 'Bad settings.' }, 402: { description: 'The plan does not include database sync.' }, 502: { description: 'Could not connect.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  assertSession(ctx)
  await assertFeature(ctx.workspace, 'contactSources')
  const body = await readObjectBody(event)
  const project = await requireProject(ctx, String(body.project || ''))
  const kind = body.kind as SourceKind
  const driver = sourceDriver(kind)
  let config = readSourceConfig(kind, body.config)
  const sealed = sealSourceSecret(kind, body.secret)
  const tested = await driver.test(config, driver.readSecret(body.secret))
  config = { ...config, idType: tested.idType || undefined }

  const row = new (useParse().Object.extend('ContactSource'))()
  row.set('project', project)
  row.set('kind', kind)
  row.set('name', String(body.name || '').trim().slice(0, 80) || driver.label)
  row.set('config', config)
  row.set('secretSealed', sealed)
  row.set('enabled', true)
  row.set('status', 'idle')
  row.set('cursor', {})
  row.set('stats', {})
  row.set('nextRunAt', new Date())
  await row.save(null, MASTER)
  return { source: serializeContactSource(row) }
})
