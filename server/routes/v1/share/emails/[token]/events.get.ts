defineRouteMeta({ openAPI: { tags: ['Email'], summary: 'Live saves on a shared template (SSE)', operationId: 'streamSharedEmailEvents', security: [{}], description: 'Edit links only. Each `email.updated` carries the design (`name`, `document`, `variables`); none arrive once the link has expired.', parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'An open `text/event-stream` of `email.updated`.' }, 403: { description: 'View-only link.' }, 404: { description: 'Link revoked, expired or unknown.' } } } })

export default defineEventHandler(async (event) => {
  const { row } = await findSharedEmail(event, getRouterParam(event, 'token') || '', 'edit')
  const expiresAt = (row.get('shareExpiresAt') as Date).getTime()
  // The broadcast is the operators' view of the template; a link holder gets the design only.
  return streamEmailEvents(event, row.id || '', e => (Date.now() < expiresAt ? { ...e, template: sharedEmailTemplate(e.template) } : null))
})
