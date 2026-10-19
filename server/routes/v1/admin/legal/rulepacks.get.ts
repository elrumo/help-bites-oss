import { LEGAL_RULEPACKS } from '#shared/legal/rulepacks'

defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'listLegalRulepacks', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'The rulepacks that ground the checks',
    description: 'The curated requirement checklists (laws, platform policies, best-practice) with their sources. `lastReviewed` is null until a person has compared the pack with its sources. Narrow with `?type=`.',
    parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['privacy', 'terms', 'cookies', 'refund'] } }],
    responses: { 200: { description: 'Rulepacks.' } }
  }
})

export default defineEventHandler(async (event) => {
  await requireMember(event, { can: 'content' })
  const type = getQuery(event).type
  const packs = isLegalType(type) ? LEGAL_RULEPACKS.map(p => ({ ...p, requirements: p.requirements.filter(r => r.docTypes.includes(type)) })).filter(p => p.requirements.length) : LEGAL_RULEPACKS
  return { rulepacks: packs }
})
