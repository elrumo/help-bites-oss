defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Detach a linked master', operationId: 'detachEmailTemplate', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Turns a project\'s link into its own copy (accent and values baked in). Later edits to the master no longer reach it.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ template }`' }, 400: { description: 'Not a linked template.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.emailTemplate(ctx, getRouterParam(event, 'id') || '')
  if (!row.get('master')) throw createError({ statusCode: 400, statusMessage: 'This template is not linked to a master' })
  detachEmailTemplate(row, await requireProject(ctx, pointerId(row.get('project'))))
  return { template: await saveAndBroadcast(row) }
})
