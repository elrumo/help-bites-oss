defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    operationId: 'getStorageUsage',
    summary: 'Storage by type and project',
    description: 'Where the workspace\'s storage goes, read from the bucket: totals per kind of file (conversations, feedback, team, branding, cms, forms, emails, blog, onboarding, knowledge, other) and per project, with what the plan counts (`used`) and its limit (null: none). Lists every stored file, so it takes a moment on a big workspace.',
    security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    responses: { 200: { description: '`{ used, limit, bytes, files, types: [{ type, bytes, files }], projects: [{ id, name, bytes, files, types }] }`; the project with id null holds what belongs to the whole workspace.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true })
  return await storageBreakdown(ctx.workspace)
})
