defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'createLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a legal document',
    description: 'Creates a draft. `mode: "blank"` starts empty. `mode: "template"` composes it from reviewed clauses and the wizard `answers` (GET /v1/admin/legal/wizard/{type} lists the questions) with no AI. `mode: "ai"` has the model write it in full, grounded in the applicable rulepacks. `mode: "import"` takes a document you already have: send it as `text` (Markdown, HTML or plain text; `format` is detected unless you set `markdown`, `html` or `text`) and it is split at its headings into editable sections, untouched and never sent to an AI. `answers` is optional for an import (`regions` decides which rules apply when you analyse it). Add `saveAnswers: true` to remember the answers for your other documents; they pre-fill new ones, and any `answers` you omit fall back to those saved ones.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'type'], examples: { template: { value: { project: 'p1', type: 'privacy', mode: 'template', answers: { app_name: 'Acme', entity_name: 'Acme Ltd', contact_email: 'legal@acme.test', regions: ['eu'] }, saveAnswers: true } }, import: { value: { project: 'p1', type: 'privacy', mode: 'import', text: '# Privacy Policy\n\n## What we collect\n\nYour email.', answers: { regions: ['eu', 'uk'] } } } } } } },
    responses: { 200: { description: 'The new draft.' }, 400: { description: 'Invalid type, mode, answers or text.' }, 501: { description: 'mode "ai" needs an AI provider.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const project = await legalProject(ctx, event, body)
  await assertFeature(ctx.workspace, 'legalDocs')
  if (!isLegalType(body.type)) throw createError({ statusCode: 400, statusMessage: 'type is one of privacy, terms, cookies, refund' })
  const mode = body.mode === undefined ? 'template' : body.mode
  if (mode !== 'blank' && mode !== 'template' && mode !== 'ai' && mode !== 'import') throw createError({ statusCode: 400, statusMessage: 'mode is blank, template, ai or import' })
  const input = { type: body.type, answers: body.answers, title: typeof body.title === 'string' ? body.title : undefined, slug: typeof body.slug === 'string' ? body.slug : undefined, locale: typeof body.locale === 'string' ? body.locale : undefined }
  const row = mode === 'ai'
    ? await draftLegalDocumentWithAi(ctx, project, input)
    : mode === 'import' ? await importLegalDocument(project, { ...input, text: body.text, format: body.format }) : await createLegalDocument(project, { ...input, mode })
  if (body.saveAnswers === true) await saveSharedAnswers(project, serializeLegalDocument(project, row).answers)
  return { document: serializeLegalDocument(project, row) }
})
