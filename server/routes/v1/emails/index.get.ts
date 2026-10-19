import { senderVariables } from '#shared/email/resolve'

defineRouteMeta({ openAPI: { tags: ['Email'], operationId: 'listEmails', security: [{ ProjectSecret: [] }], summary: 'List a project\'s email templates', description: 'Every template the project can send (its own and the masters it links), with the key to fetch or send it by and the variables it takes.', responses: { 200: { description: '`{ templates: [{ id, key, name, subject, linked, variables, updatedAt }] }`' }, 401: { description: 'Project secret required.' } } } })

export default defineEventHandler(async (event) => {
  const project = await requireProjectSecret(event)
  const rows = await new (useParse()).Query('EmailTemplate').equalTo('project', project).include('master').ascending('key').limit(1000).find(MASTER)
  return {
    templates: rows.map((row) => {
      const t = serializeEmailTemplate(row)
      return { id: t.id, key: t.key, name: t.master?.name || t.name, subject: renderEmailTemplate(row, project).subject, linked: !!t.masterId, variables: senderVariables(t, t.master), updatedAt: new Date(Math.max(t.updatedAt, t.master?.updatedAt || 0)).toISOString() }
    })
  }
})
