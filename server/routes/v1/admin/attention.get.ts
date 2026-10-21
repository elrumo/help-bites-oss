defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'getWorkspaceAttention', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'What needs attention',
    description: 'One list for the workspace: changelog drafts awaiting approval, contact and Stripe syncs that failed, emails that bounced or failed in the last 7 days, error alerts fired in the last day, a paused sender, and each project\'s open error reports, knowledge documents that would not process and feedback awaiting triage. Items are grouped per project and kind, newest first. `unreadMessages` is the inbox badge. A key limited to some projects sees only those. The list is cached for 15 seconds; `GET /v1/admin/unread` is live. See docs/OVERVIEW.md.',
    parameters: [{ name: 'fresh', in: 'query', schema: { type: 'boolean' }, description: 'Skip the 15-second cache and read it again now (the Overview page does, so what you just approved is gone).' }],
    responses: {
      200: {
        description: 'The list.',
        content: { 'application/json': { example: {
          unreadMessages: 5, total: 4,
          items: [
            { key: 'drafts:proj_123', kind: 'drafts', projectId: 'proj_123', count: 2, value: 'CSV export', detail: '', section: 'changelog', at: '2026-10-21T09:12:00.000Z' },
            { key: 'sync:stripe:proj_123', kind: 'sync', projectId: 'proj_123', count: 1, value: 'Stripe', detail: 'Stripe answered 401: Invalid API Key', section: 'revenue', at: '2026-10-21T08:00:00.000Z' }
          ]
        } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  return attentionSummary(await requireMember(event), { fresh: ['1', 'true'].includes(String(getQuery(event).fresh || '')) })
})
