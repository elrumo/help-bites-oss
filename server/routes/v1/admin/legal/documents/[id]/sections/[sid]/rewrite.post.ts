defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'rewriteLegalSection', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Rewrite one section with AI',
    description: 'The model rewrites one section following your `instruction`, grounded in the requirements that section answers. By default it only returns a `proposal`; pass `apply: true` to save it (the section is then marked `ai`). A locked section is refused with 409. Needs an AI provider (501 otherwise).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'sid', in: 'path', required: true, schema: { type: 'string' }, description: 'Section id' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['instruction'], example: { instruction: 'Mention that we keep logs for 30 days', apply: false } } } } },
    responses: { 200: { description: 'The proposal, or the updated document when applied.' }, 409: { description: 'Section is locked.' }, 501: { description: 'No AI provider configured.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLegalDocument(ctx, event)
  const body = (await readBody(event).catch(() => ({}))) || {}
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 1000) : ''
  if (!instruction) throw createError({ statusCode: 400, statusMessage: 'instruction is required' })
  const { section, body: proposal } = await proposeSectionRewrite(ctx, row, getRouterParam(event, 'sid') || '', instruction)
  if (body.apply !== true) return { proposal, sectionId: section.id }
  await replaceSectionBody(row, section.id, proposal)
  return { proposal, sectionId: section.id, document: serializeLegalDocument(project, row), coverage: legalCoverage(row) }
})
