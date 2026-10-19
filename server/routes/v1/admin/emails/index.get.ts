defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List email templates', operationId: 'listEmailTemplates', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'With `?project=` that project\'s templates (linked masters include the master\'s design); without it the master templates, plus how many projects link each one.', parameters: [{ name: 'project', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: '`{ templates, usage? }`' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const projectId = String(getQuery(event).project || '')
  const Parse = useParse()
  // ponytail: documents ride along for the card previews; page this when a project passes a few hundred templates.
  const query = new Parse.Query('EmailTemplate').include('master').descending('updatedAt').limit(1000)
  if (projectId) query.equalTo('project', await requireProject(ctx, projectId))
  else {
    assertWorkspaceWide(ctx)
    query.equalTo('workspace', ctx.workspace).doesNotExist('project')
  }
  const templates = (await query.find(MASTER)).map(row => serializeEmailTemplate(row))
  if (projectId) return { templates }

  const usage: Record<string, number> = {}
  await eachBatch(() => new Parse.Query('EmailTemplate').equalTo('workspace', ctx.workspace).exists('master'), (links) => {
    for (const link of links) {
      const id = pointerId(link.get('master'))
      usage[id] = (usage[id] || 0) + 1
    }
  }, { keys: ['master'] })
  return { templates, usage }
})
