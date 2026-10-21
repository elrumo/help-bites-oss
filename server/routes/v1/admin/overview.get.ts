import { REVENUE_RANGES, type RevenueRange } from '#shared/stripe'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'getWorkspaceOverview', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Workspace overview',
    description: 'Every project at once: its open, unread and error conversations, the latest conversations with unread messages, and revenue from each project with Stripe connected, in that project\'s own currency with totals per currency. `revenue` is null for agents. A key limited to some projects sees only those. See docs/OVERVIEW.md.',
    parameters: [{ name: 'range', in: 'query', schema: { type: 'string', enum: ['30d', '90d', '12m', 'all'], default: '30d' }, description: 'The revenue period, compared with the one before it' }],
    responses: {
      200: {
        description: 'The overview.',
        content: { 'application/json': { example: {
          totals: { unreadMessages: 5, unread: 3, open: 12, errors: 1 },
          projects: [{ id: 'proj_123', name: 'Acme', open: 9, unread: 2, errors: 1 }],
          unread: [{ conversationId: 'conv_123', projectId: 'proj_123', name: 'Maya Chen', email: 'maya@example.com', subject: '', preview: 'The export button does nothing', unread: 2, at: '2026-10-21T09:12:00.000Z' }],
          revenue: { range: '30d', connected: 1, totals: [{ currency: 'usd', net: 4210, previousNet: 3760, change: 0.12, mrr: 3980, subscribers: 211, months: [{ month: '2026-10', net: 2950 }] }], projects: [{ projectId: 'proj_123', currency: 'usd', net: 4210, previousNet: 3760, change: 0.12, mrr: 3980, subscribers: 211, payments: 236 }] }
        } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  const range = REVENUE_RANGES.find(r => r.value === getQuery(event).range)?.value || '30d' as RevenueRange
  return workspaceOverview(ctx, range)
})
