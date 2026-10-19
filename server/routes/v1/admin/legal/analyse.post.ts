import { sectionsToMarkdown } from '#shared/legal/compose'

defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'analyseLegalText', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Analyse any legal text',
    description: 'Reads a privacy policy, terms, cookie or refund text you paste (or one of your documents, by `documentId`) against the rulepack requirements that apply to the regions in `answers.regions`, and reports per requirement whether it is ok, unclear, missing or in conflict. It cites only supplied requirements. Needs an AI provider (501 otherwise). Not legal advice.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { type: 'privacy', text: 'We collect your email...', answers: { regions: ['eu', 'uk'] } } } } } },
    responses: { 200: { description: 'Findings.' }, 400: { description: 'No text or unknown type.' }, 404: { description: 'Document not found.' }, 501: { description: 'No AI provider configured.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  if (typeof body.documentId === 'string' && body.documentId) {
    const row = await scoped.legalDocument(ctx, body.documentId)
    await requireProject(ctx, pointerId(row.get('project')))
    const type = isLegalType(row.get('type')) ? row.get('type') : 'privacy'
    return await analyseLegalText(ctx, { type, text: sectionsToMarkdown(sectionsOf(row)), answers: row.get('answers') })
  }
  if (!isLegalType(body.type)) throw createError({ statusCode: 400, statusMessage: 'type is one of privacy, terms, cookies, refund' })
  return await analyseLegalText(ctx, { type: body.type, text: typeof body.text === 'string' ? body.text : '', answers: body.answers })
})
