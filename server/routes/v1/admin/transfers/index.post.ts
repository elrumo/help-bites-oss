defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    operationId: 'importFromInstance',
    summary: 'Import from another HelpBites',
    description: 'Queues a background import that pulls a workspace, or one project, straight from another HelpBites instance (self-hosted or cloud) with an admin API key or a username and password, and creates it in this workspace as new projects. The login is kept sealed until the import ends, then removed. Nothing is changed on the other instance. If the import fails, nothing it created is left behind. Poll `GET /v1/admin/transfers`. Owners and admins.',
    security: [{ bearerAuth: [] }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['source'], properties: {
      source: { type: 'object', required: ['url'], properties: {
        url: { type: 'string', description: 'The other instance\'s address, e.g. https://help.example.com' },
        apiKey: { type: 'string', description: 'An admin API key (`ak_…`) of an owner or admin there.' },
        login: { type: 'string' }, password: { type: 'string' },
        workspaceId: { type: 'string', description: 'With a login that belongs to several workspaces there: which one.' }
      } },
      projectId: { type: 'string', description: 'A project id on the other instance; leave out for its whole workspace.' }
    } } } } },
    responses: { 202: { description: 'The queued import (same shape as an item of `GET /v1/admin/transfers`).' }, 400: { description: 'The other instance could not be reached or refused the login.' }, 409: { description: 'An import is already running here.' }, 429: { description: 'More than 10 imports in an hour.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.export' })
  const body = (await readBody(event).catch(() => ({}))) as { source?: Record<string, unknown>, projectId?: unknown }
  const row = await queuePull(ctx, readSource(body.source), String(body.projectId || ''), clientIp(event))
  setResponseStatus(event, 202)
  return serializeTransfer(row)
})
