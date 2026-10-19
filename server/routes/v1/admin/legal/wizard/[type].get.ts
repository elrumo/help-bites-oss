import { LEGAL_DOC_LABELS, LEGAL_REGION_LABELS } from '#shared/legal/types'
import { LEGAL_PROCESSORS, questionsFor } from '#shared/legal/wizard'

defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'getLegalWizard', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'The wizard questions for a document type',
    description: 'The questions, the regions and the services you can pick, so any client can render the same wizard as the panel. With `?project=`, `defaults` holds the answers the project\'s saved identity already supplies.',
    parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['privacy', 'terms', 'cookies', 'refund'] } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: 'Questions.' }, 404: { description: 'Unknown type.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const type = getRouterParam(event, 'type')
  if (!isLegalType(type)) throw createError({ statusCode: 404, statusMessage: 'Unknown document type' })
  const defaults = getQuery(event).project ? legalDefaults(await legalProject(ctx, event)) : {}
  return { notice: 'A drafting aid, not legal advice. Have a qualified lawyer review your documents before relying on them.', type, label: LEGAL_DOC_LABELS[type], questions: questionsFor(type), regions: LEGAL_REGION_LABELS, processors: LEGAL_PROCESSORS, defaults }
})
