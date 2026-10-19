defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'The latest data export',
    description: 'When the workspace was last exported, with a fresh download link that works for an hour. `lastExport` is null until an export has finished. Owners and admins.',
    responses: { 200: { description: '`{ lastExport: { at, url } | null }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.export', allowInactive: true })
  return { lastExport: await lastWorkspaceExport(ctx.workspace) }
})
