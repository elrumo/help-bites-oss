defineRouteMeta({
  openAPI: {
    tags: ['Agent'], summary: 'Create a general admin API key', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    description: 'The returned `key` is shown once. It acts as you, in this workspace only, on every `/v1/admin` operation your role allows, so keep it in server-side secret storage.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', example: 'Production automation' }, projectIds: { type: 'array', items: { type: 'string' }, description: 'Limit the key to these projects. Leave out for every project and the workspace itself.' } } } } } },
    responses: { 200: { description: '{ apiKey, key }' }, 400: { description: 'Name is required, or `projectIds` is empty or names a project outside this workspace.' }, 402: { description: 'The plan\'s API key limit is reached.' }, 403: { description: '`email_unverified`: the workspace owner has not confirmed their email address yet (hosted edition).' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'apiKeys.manage' })
  await assertWorkspaceVerified(ctx.workspaceId)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const name = String(body.name || '').trim().slice(0, 80)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Name is required' })
  let projectIds: string[] | null = null
  if (body.projectIds !== undefined && body.projectIds !== null) {
    const own = await workspaceProjectIds(ctx.workspaceId)
    projectIds = Array.isArray(body.projectIds) ? [...new Set(body.projectIds.map(String))] : []
    if (!projectIds.length || projectIds.some(id => !own.includes(id))) throw createError({ statusCode: 400, statusMessage: 'Pick at least one project of this workspace' })
  }
  await checkGauge(ctx.workspace, 'apiKeys')
  const Parse = useParse()
  const value = newAdminApiKey()
  const row = new (Parse.Object.extend('AdminApiKey'))()
  row.set('agent', ctx.agent)
  row.set('workspace', ctx.workspace)
  row.set('name', name)
  row.set('hash', value.hash)
  row.set('prefix', value.prefix)
  if (projectIds) row.set('projectIds', projectIds)
  await row.save(null, MASTER)
  return { apiKey: serializeAdminApiKey(row), key: value.token }
})
