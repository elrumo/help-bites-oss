defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'listSequenceEnrollments', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Who is on a sequence',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'completed', 'exited'] } }, { name: 'project', in: 'query', schema: { type: 'string' } }],
    responses: { 200: { description: '`{ enrollments: [{ id, contact, step, status, nextAt, lastSentAt, lastError, createdAt }] }` (the 200 most recent)' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const project = await callerProject(event, caller)
  const sequence = await getProjectSequence(project, getRouterParam(event, 'id') || '')
  const query = new (useParse()).Query('SequenceEnrollment').equalTo('sequence', sequence).include('contact').descending('createdAt').limit(200)
  const status = String(getQuery(event).status || '')
  if (status) query.equalTo('status', status)
  const rows = await query.find(MASTER)
  return {
    enrollments: rows.map(r => ({
      id: r.id,
      contact: r.get('contact') ? serializeContact(r.get('contact')) : null,
      step: Number(r.get('step') || 0),
      status: String(r.get('status') || ''),
      nextAt: iso(r.get('nextAt')),
      lastSentAt: iso(r.get('lastSentAt')),
      lastError: String(r.get('lastError') || ''),
      createdAt: iso(r.createdAt)
    }))
  }
})
