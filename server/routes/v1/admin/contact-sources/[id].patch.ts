import type { SourceConfig, SourceKind } from '../../../../utils/contactSources'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'updateContactSource', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Change a source',
    description: 'Partial: `name`, `config` (merged), `secret` (replaces the stored one), `enabled`. A new connection or table is tested first; changing which table or column it reads starts the next sync from the beginning.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, name: { type: 'string' }, config: { type: 'object' }, secret: {}, enabled: { type: 'boolean' } } } } } },
    responses: { 200: { description: '`{ source }`' }, 404: { description: 'Not in this project.' } }
  }
})

const WHERE_KEYS = ['serverUrl', 'appId', 'className', 'table', 'idField', 'collection', 'updatedField'] as const

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  assertSession(ctx)
  const body = await readObjectBody(event)
  const project = await requireProject(ctx, String(body.project || ''))
  const row = await getProjectSource(project, getRouterParam(event, 'id') || '')
  const kind = row.get('kind') as SourceKind
  const driver = sourceDriver(kind)
  const before = row.get('config') as SourceConfig
  let config = body.config !== undefined ? readSourceConfig(kind, body.config, before) : before
  const moved = WHERE_KEYS.some(k => config[k] !== before[k])
  assertSecretStaysHome(before, config, body.secret !== undefined)

  if (body.secret !== undefined) row.set('secretSealed', sealSourceSecret(kind, body.secret))
  if (moved || body.secret !== undefined) {
    const tested = await driver.test(config, driver.readSecret(body.secret !== undefined ? body.secret : sourceSecret(row)))
    config = { ...config, idType: tested.idType || undefined }
  }
  if (moved) row.set('cursor', {})
  row.set('config', config)
  if (typeof body.name === 'string' && body.name.trim()) row.set('name', body.name.trim().slice(0, 80))
  if (typeof body.enabled === 'boolean') row.set('enabled', body.enabled)
  if (row.get('enabled') !== false && (moved || body.config !== undefined)) row.set('nextRunAt', new Date())
  await row.save(null, MASTER)
  return { source: serializeContactSource(row) }
})
