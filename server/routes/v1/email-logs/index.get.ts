defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'listEmailLogs', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'The project\'s send history',
    description: 'Every message the project sent or tried to send, newest first: one entry per recipient, with the template, recipient, subject, status (kept current by delivery webhooks), error, tags, metadata and the variables it was sent with (values that look like links, codes or tokens are redacted). Page with `before` = the previous page\'s `nextBefore`. Operators and admin keys pass `project`.',
    parameters: [
      { name: 'to', in: 'query', schema: { type: 'string' }, description: 'An exact address, or the start of one.' },
      { name: 'template', in: 'query', schema: { type: 'string' }, description: 'Send key or template id.' },
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['scheduled', 'sent', 'delivered', 'opened', 'clicked', 'unsubscribed', 'bounced', 'complained', 'failed', 'suppressed'] } },
      { name: 'source', in: 'query', schema: { type: 'string', enum: ['api', 'admin', 'test', 'notification', 'feedback', 'system'] } },
      { name: 'batch', in: 'query', schema: { type: 'string' }, description: 'The `id` a send returned: all of its recipients.' },
      { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'until', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } }
    ],
    responses: { 200: { description: '`{ logs, nextBefore }`' }, 401: { description: 'Project secret, admin key or session required.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  return listEmailLogs({ project }, readEmailLogQuery(getQuery(event)))
})
