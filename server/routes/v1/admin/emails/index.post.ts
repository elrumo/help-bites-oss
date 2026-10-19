import { cloneBlankEmailDocument, cloneEmailTemplateDocument } from '#shared/email/templates'

defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Create an email template', operationId: 'createEmailTemplate', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Without `project` it is a master. With `master` (and `project`) it links that master into the project. Otherwise the design comes from `document`, a starter (`starterId`) or a blank page.', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { project: { type: 'string' }, master: { type: 'string' }, name: { type: 'string' }, starterId: { type: 'string' }, document: { type: 'object' }, variables: { type: 'array', items: { type: 'object' } }, folder: { type: 'string' } } } } } }, responses: { 200: { description: '`{ template }`' }, 400: { description: 'Invalid input.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const Parse = useParse()
  const project = body.project ? await requireProject(ctx, String(body.project)) : null
  const row = new (Parse.Object.extend('EmailTemplate'))()
  row.set('workspace', ctx.workspace)
  if (project) row.set('project', project)
  else assertWorkspaceWide(ctx)

  if (body.master) {
    if (!project) throw createError({ statusCode: 400, statusMessage: 'Linking a master needs a project' })
    const master = await scoped.emailTemplate(ctx, String(body.master))
    if (master.get('project') || master.get('master')) throw createError({ statusCode: 400, statusMessage: 'That template is not a master' })
    row.set('master', master)
    row.set('name', master.get('name'))
    row.set('key', await freeKey(project.id || null, ctx.workspaceId, String(master.get('name'))))
    row.set('values', [])
  } else {
    const starter = body.starterId ? cloneEmailTemplateDocument(String(body.starterId)) : null
    if (body.starterId && !starter) throw createError({ statusCode: 400, statusMessage: 'Unknown starter template' })
    const document = body.document !== undefined ? validateDocument(body.document) : starter || cloneBlankEmailDocument()
    const name = String(body.name || document.settings.title || 'Untitled email').trim().slice(0, 120)
    row.set('name', name)
    row.set('key', await freeKey(project?.id || null, ctx.workspaceId, name))
    row.set('document', document)
    row.set('variables', reconcileVariables(document, body.variables))
  }
  await applyEmailInput(row, { folder: body.folder || null })
  await row.save(null, MASTER)
  return { template: serializeEmailTemplate(row) }
})
