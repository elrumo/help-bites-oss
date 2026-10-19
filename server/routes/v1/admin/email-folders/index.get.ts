defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List email folders', operationId: 'listEmailFolders', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'A project\'s folders with `?project=`, the masters\' folders without.', parameters: [{ name: 'project', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: '`{ folders }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true })
  const projectId = String(getQuery(event).project || '')
  const query = new (useParse()).Query('EmailFolder').equalTo('workspace', ctx.workspace).ascending('name').limit(1000)
  if (projectId) query.equalTo('project', await requireProject(ctx, projectId))
  else query.doesNotExist('project')
  return { folders: (await query.find(MASTER)).map(serializeEmailFolder) }
})
