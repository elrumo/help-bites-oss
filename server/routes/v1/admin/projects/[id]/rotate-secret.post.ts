defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Rotate a project secret',
    description: 'Tokens minted with the old secret stop verifying immediately; hosts must switch within their token TTL.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '{ project, secret }' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  assertSession(ctx)
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const secret = newSecret()
  project.set('secret', secret)
  await project.save(null, MASTER)
  forgetProject(String(project.get('publicKey')))
  await auditAccess(ctx, event, 'project.secret.rotate', project.id)
  return { project: serializeAdminProject(project), secret }
})
