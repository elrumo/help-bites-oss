defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Create an email folder', operationId: 'createEmailFolder', security: [{ AgentSession: [] }, { AdminApiKey: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, project: { type: 'string' }, parent: { type: 'string' } } } } } }, responses: { 200: { description: '`{ folder }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true, can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const name = String(body.name || '').trim().slice(0, 80)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })
  const project = body.project ? await requireProject(ctx, String(body.project)) : null
  const folder = new (useParse().Object.extend('EmailFolder'))()
  folder.set('name', name)
  folder.set('workspace', ctx.workspace)
  if (project) folder.set('project', project)
  if (body.parent) {
    const parent = await scoped.emailFolder(ctx, String(body.parent))
    if ((pointerId(parent.get('project')) || null) !== (project?.id || null)) throw createError({ statusCode: 400, statusMessage: 'Parent folder belongs to another project' })
    folder.set('parent', parent)
  }
  await folder.save(null, MASTER)
  return { folder: serializeEmailFolder(folder) }
})
