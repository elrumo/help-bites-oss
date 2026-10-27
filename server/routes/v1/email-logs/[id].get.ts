import { can } from '#shared/roles'

defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'getEmailLog', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'One sent message',
    description: 'A log entry with its delivery events, and the message\'s HTML and text when the project keeps message content. The id is a send result\'s `logId`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: '`{ log }`' }, 404: { description: 'No such entry in this project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const row = await getEmailLog(getRouterParam(event, 'id') || '')
  if (pointerId(row.get('project')) !== project.id) throw createError({ statusCode: 404, statusMessage: 'Email log entry not found' })
  // The host's own server (project secret) reads its mail; an operator needs to be a signed-in admin, as in the panel.
  const content = !caller.member || (!caller.member.apiKeyId && can(caller.member.role, 'projects.manage'))
  return { log: serializeEmailLog(row, { content }) }
})
