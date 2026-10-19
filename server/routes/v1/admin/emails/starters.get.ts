import { EMAIL_TEMPLATES } from '#shared/email/templates'

defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'List starter email designs', operationId: 'listEmailStarters', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'The built-in designs a new template can start from (`POST /v1/admin/emails` with `starterId`).', responses: { 200: { description: '`{ starters: [{ id, name, document }] }`' } } } })

export default defineEventHandler(async (event) => {
  await requireMember(event)
  return { starters: EMAIL_TEMPLATES.map(t => ({ id: t.id, name: t.name, document: t.document })) }
})
