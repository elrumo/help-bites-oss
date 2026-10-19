defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Delete an email folder', operationId: 'deleteEmailFolder', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Templates and subfolders inside move up to the parent; nothing is deleted with it.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ ok: true }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true, can: 'content' })
  const Parse = useParse()
  const folder = await scoped.emailFolder(ctx, getRouterParam(event, 'id') || '')
  const parent = folder.get('parent') as ParseObject | undefined
  for (const [className, field] of [['EmailTemplate', 'folder'], ['EmailFolder', 'parent']] as const) {
    await eachBatch(() => new Parse.Query(className).equalTo('workspace', ctx.workspace).equalTo(field, folder), async (children) => {
      for (const child of children) {
        if (parent) child.set(field, parent)
        else child.unset(field)
      }
      await Parse.Object.saveAll(children, MASTER)
    })
  }
  await folder.destroy(MASTER)
  return { ok: true }
})
