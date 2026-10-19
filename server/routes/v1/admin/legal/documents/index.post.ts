defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'createLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a legal document',
    description: 'Creates a draft. `mode: "blank"` starts empty. `mode: "template"` composes it from reviewed clauses and the wizard `answers` (GET /v1/admin/legal/wizard/{type} lists the questions) with no AI. `mode: "ai"` has the model write it in full, grounded in the applicable rulepacks.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'type'], example: { project: 'p1', type: 'privacy', mode: 'template', answers: { app_name: 'Acme', entity_name: 'Acme Ltd', contact_email: 'legal@acme.test', regions: ['eu'] } } } } } },
    responses: { 200: { description: 'The new draft.' }, 400: { description: 'Invalid type, mode or answers.' }, 501: { description: 'mode "ai" needs an AI provider.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const project = await legalProject(ctx, event, body)
  await assertFeature(ctx.workspace, 'legalDocs')
  if (!isLegalType(body.type)) throw createError({ statusCode: 400, statusMessage: 'type is one of privacy, terms, cookies, refund' })
  const mode = body.mode === undefined ? 'template' : body.mode
  if (mode !== 'blank' && mode !== 'template' && mode !== 'ai') throw createError({ statusCode: 400, statusMessage: 'mode is blank, template or ai' })
  const input = { type: body.type, answers: body.answers, title: typeof body.title === 'string' ? body.title : undefined, slug: typeof body.slug === 'string' ? body.slug : undefined, locale: typeof body.locale === 'string' ? body.locale : undefined }
  const row = mode === 'ai' ? await draftLegalDocumentWithAi(ctx, project, input) : await createLegalDocument(project, { ...input, mode })
  return { document: serializeLegalDocument(project, row) }
})
