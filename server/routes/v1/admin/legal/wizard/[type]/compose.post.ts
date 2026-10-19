import { composeDocument, sectionsToMarkdown } from '#shared/legal/compose'
import { validateAnswers } from '#shared/legal/wizard'

defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'previewLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Preview a document from wizard answers',
    description: 'Composes the sections and checks them against the applicable rulepacks, without saving or using AI. Pass `project` to fill gaps from its saved identity.',
    parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['privacy', 'terms', 'cookies', 'refund'] } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { project: 'p1', answers: { regions: ['eu', 'uk'], data_collected: ['account'] } } } } } },
    responses: { 200: { description: 'Sections, Markdown and coverage.' }, 400: { description: 'Invalid answers.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const type = getRouterParam(event, 'type')
  if (!isLegalType(type)) throw createError({ statusCode: 404, statusMessage: 'Unknown document type' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const named = body.project || getQuery(event).project
  const answers = named ? prepareAnswers(await legalProject(ctx, event, body), type, body.answers) : (() => {
    const { answers, errors } = validateAnswers(type, body.answers)
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    return answers
  })()
  const composed = composeDocument(type, answers)
  return { notice: 'A drafting aid, not legal advice. Have a qualified lawyer review your documents before relying on them.', ...composed, answers, markdown: sectionsToMarkdown(composed.sections), coverage: coverageReport(type, answers, composed.sections) }
})
