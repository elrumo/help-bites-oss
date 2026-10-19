defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Rename or move an email folder', operationId: 'updateEmailFolder', security: [{ AgentSession: [] }, { AdminApiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, parent: { type: 'string', nullable: true } } } } } }, responses: { 200: { description: '`{ folder }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true, can: 'content' })
  const folder = await scoped.emailFolder(ctx, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (typeof body.name === 'string' && body.name.trim()) folder.set('name', body.name.trim().slice(0, 80))
  if ('parent' in body) {
    if (!body.parent) folder.unset('parent')
    else {
      const parent = await scoped.emailFolder(ctx, String(body.parent))
      if (pointerId(parent.get('project')) !== pointerId(folder.get('project'))) throw createError({ statusCode: 400, statusMessage: 'Parent folder belongs to another project' })
      // No cycles: the new parent must not sit inside this folder.
      for (let at: ParseObject | null = parent; at; at = at.get('parent') ? await scoped.emailFolder(ctx, pointerId(at.get('parent'))) : null) {
        if (at.id === folder.id) throw createError({ statusCode: 400, statusMessage: 'A folder cannot move into itself' })
      }
      folder.set('parent', parent)
    }
  }
  await folder.save(null, MASTER)
  return { folder: serializeEmailFolder(folder) }
})
