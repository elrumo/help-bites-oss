defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'deleteLeadFile', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Delete a file sent through a lead form',
    description: 'Removes the file for good and gives its bytes back to the workspace\'s storage. The contact stays. Erasing a contact removes all of their files.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Deleted.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const row = await scoped.leadFile(ctx, getRouterParam(event, 'id') || '')
  await deleteLeadFiles(await requireProject(ctx, pointerId(row.get('project'))), [row])
  return { ok: true }
})
