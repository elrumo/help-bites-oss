defineRouteMeta({
  openAPI: {
    tags: ['Meta'], operationId: 'healthLive',
    summary: 'Liveness',
    description: 'Whether this process answers at all, and in which role (APP_ROLE). Checks no dependency, so a container is not restarted for an outage elsewhere; GET /v1/health reports those. Unauthenticated.',
    responses: { 200: { description: 'The process is up.', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'role', 'time'], properties: { ok: { type: 'boolean' }, role: { type: 'string', enum: ['all', 'web', 'worker', 'embedder'] }, time: { type: 'string', format: 'date-time' } }, example: { ok: true, role: 'web', time: '2026-09-20T10:00:00.000Z' } } } } } }
  }
})

export default defineEventHandler(() => ({ ok: true, role: appRole(), time: new Date().toISOString() }))
