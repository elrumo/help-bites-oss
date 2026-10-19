defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'importEmailTemplates', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Import email templates',
    description: 'Creates or updates up to 100 templates by send key: a project\'s with `project`, masters without. Each item carries a `document`, or `html` (kept as one custom-HTML block, with `subject`, `preheader`, `text` and `settings`), or `master` (the id or exact name of a master to link, with `variableValues`). `mode: "create"` (default) skips keys that exist; `"upsert"` updates them. `dryRun: true` reports what would happen and writes nothing. `GET /v1/admin/emails/export` produces this format.',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['templates'],
            properties: {
              project: { type: 'string' },
              mode: { type: 'string', enum: ['create', 'upsert'] },
              dryRun: { type: 'boolean' },
              templates: { type: 'array', maxItems: 100, items: { type: 'object', required: ['key'], properties: { key: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, folder: { type: 'string', description: 'A path such as `Account/Security`; created when missing.' }, document: { type: 'object' }, html: { type: 'string' }, subject: { type: 'string' }, preheader: { type: 'string' }, text: { type: 'string' }, settings: { type: 'object' }, variables: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, defaultValue: { type: 'string' } } } }, master: { type: 'string' }, variableValues: { type: 'object' } } } }
            }
          },
          example: { project: 'Xy12AbCdEf', mode: 'upsert', templates: [{ key: 'password-reset', name: 'Password reset', folder: 'Account', subject: 'Reset your password', html: '<p>Reset it here: <a href="{{link}}">{{link}}</a></p>', variables: [{ key: 'link', label: 'Reset link' }] }] }
        }
      }
    },
    responses: { 200: { description: '`{ dryRun, mode, created, updated, unchanged, skipped, failed, results: [{ key, action, id, name, error? }] }`' }, 400: { description: 'No templates, or more than 100.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const items = Array.isArray(body.templates) ? body.templates as EmailImportItem[] : []
  if (!items.length) throw createError({ statusCode: 400, statusMessage: 'Pass "templates": a list of templates to import' })
  if (items.length > MAX_IMPORT_ITEMS) throw createError({ statusCode: 400, statusMessage: `At most ${MAX_IMPORT_ITEMS} templates per import` })
  const mode = body.mode === 'upsert' ? 'upsert' : 'create'
  const dryRun = body.dryRun === true
  const project = body.project ? await requireProject(ctx, String(body.project)) : null
  const results = await importEmailTemplates(project, ctx.workspace, items, { mode, dryRun })
  const count = (action: EmailImportAction) => results.filter(r => r.action === action).length
  return { dryRun, mode, created: count('created'), updated: count('updated'), unchanged: count('unchanged'), skipped: count('skipped'), failed: count('failed'), results }
})
