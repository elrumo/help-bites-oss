defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    operationId: 'listTransfers',
    summary: 'Recent imports',
    description: 'The last 20 imports into this workspace, newest first, each with its status (`queued`, `running`, `done`, `failed`), the class it is on, and when done what came in and what was left out. Owners and admins.',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: '`{ transfers: [{ id, source, host, scope, status, progress, summary, error, createdAt, finishedAt }] }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.export', allowInactive: true })
  return { transfers: await listTransfers(ctx.workspace) }
})
