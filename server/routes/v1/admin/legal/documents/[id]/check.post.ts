import { sectionsToMarkdown } from '#shared/legal/compose'

defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'checkLegalDocument', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Check a document against the rulepacks',
    description: 'Always returns the structural `coverage`: which applicable requirements some section answers and which none does (no AI). With `ai: true` it also has the model read the text and return per-requirement `findings` (ok, unclear, missing, conflict); it can cite only requirements that apply, and invented ids are dropped. Needs an AI provider for `ai: true` (501 otherwise).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { ai: true } } } } },
    responses: { 200: { description: 'Coverage, and findings when asked.' }, 501: { description: 'No AI provider configured.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scopedLegalDocument(ctx, event)
  const body = (await readBody(event).catch(() => ({}))) || {}
  const coverage = legalCoverage(row)
  if (body.ai !== true) return { coverage }
  const type = isLegalType(row.get('type')) ? row.get('type') : 'privacy'
  const analysis = await analyseLegalText(ctx, { type, text: sectionsToMarkdown(sectionsOf(row)), answers: row.get('answers') })
  return { coverage, ...analysis }
})
