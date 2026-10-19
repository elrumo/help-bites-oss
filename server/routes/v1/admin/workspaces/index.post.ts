defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Create a workspace',
    description: 'A new, empty workspace with you as its owner. Send `X-Workspace: <id>` (or switch in the panel) to work in it.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } } },
    responses: { 200: { description: '{ workspace }' }, 403: { description: 'Not allowed to create another workspace' } }
  }
})

export default defineEventHandler(async (event) => {
  const { agent } = await requireAgentIdentity(event)
  const name = workspaceName(((await readBody(event).catch(() => ({}))) as Record<string, unknown>).name)
  const allowed = await edition().canCreateWorkspace(agent)
  if (allowed !== true) throw createError({ statusCode: 403, statusMessage: allowed, data: { code: 'workspace_limit' } })
  const workspace = await createWorkspace({ name, owner: agent })
  return { workspace: serializeWorkspace(workspace, 'owner') }
})
