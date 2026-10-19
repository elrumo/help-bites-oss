defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Create a project',
    description: 'Returns the project with its secret — the only time the secret is shown in full.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: {
      name: { type: 'string' }, slug: { type: 'string' }, siteUrl: { type: 'string' }, inboxPath: { type: 'string' }, fromName: { type: 'string' },
      allowedOrigins: { type: 'array', items: { type: 'string' } }, notifyEmails: { type: 'array', items: { type: 'string' } },
      theme: { type: 'object', properties: { accent: { type: 'string' }, dark: { type: 'boolean' } } }, allowAttachments: { type: 'boolean' }
    } } } } },
    responses: { 200: { description: '{ project, secret }' }, 402: { description: 'The plan\'s project limit is reached, or it does not include event webhooks.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const payload = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (typeof payload.name !== 'string' || !payload.name.trim()) throw createError({ statusCode: 400, statusMessage: 'name is required' })
  await checkGauge(ctx.workspace, 'projects')

  const Parse = useParse()
  const project = new (Parse.Object.extend('Project'))()
  const secret = newSecret()
  project.set('publicKey', newPublicKey())
  project.set('secret', secret)
  project.set('allowAttachments', true)
  project.set('workspace', ctx.workspace)
  await applyProjectInput(project, payload)
  await project.save(null, MASTER)
  await forgetWorkspaceProjects(ctx.workspaceId)
  return { project: serializeAdminProject(project), secret }
})
