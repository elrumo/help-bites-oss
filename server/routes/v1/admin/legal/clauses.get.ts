import { LEGAL_CLAUSES } from '#shared/legal/clauses'

defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'listLegalClauses', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'The clause library',
    description: 'The reviewed clauses the composer assembles, with the condition each needs and the requirements it answers. Narrow with `?type=`.',
    parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['privacy', 'terms', 'cookies', 'refund'] } }],
    responses: { 200: { description: 'Clauses.' } }
  }
})

export default defineEventHandler(async (event) => {
  await requireMember(event, { can: 'content' })
  const type = getQuery(event).type
  return { clauses: isLegalType(type) ? LEGAL_CLAUSES.filter(c => c.docType === type) : LEGAL_CLAUSES }
})
