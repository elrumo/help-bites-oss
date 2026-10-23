import { ALERT_WINDOW_MS, EMAIL_FAILURE_WINDOW_DAYS, attentionTotal, sortAttention, type AttentionItem, type WorkspaceAttention } from '#shared/attention'
import { normalizeFeedbackConfig } from '#shared/feedback'
import { revenueSource } from '#shared/revenue'

// Everything that waits on someone, in one list: drafts to approve, syncs that
// failed, mail that bounced, alerts that fired, and the project's own backlog
// (error reports, documents that would not process, feedback to triage). One
// project at a time, so the project overview and the workspace list are the same
// definition; the workspace adds what belongs to no project (a paused sender).

const OPEN_CATEGORIES = ['open', 'pending']
// The list is polled by every open panel, so a burst of tabs costs one pass.
const CACHE_SECONDS = 15

type Counted = { count: number, newest: ParseObject | undefined }

/** How many rows match, and the latest of them, in one query. */
async function countNewest(query: InstanceType<ReturnType<typeof useParse>['Query']>, dateKey = 'createdAt'): Promise<Counted> {
  const { results, count } = await query.descending(dateKey).limit(1).withCount(true).find(MASTER) as unknown as { results: ParseObject[], count: number }
  return { count, newest: results[0] }
}

/** What waits in one project. Each kind is a query or two, run together. */
export async function projectAttention(project: ParseObject): Promise<AttentionItem[]> {
  const Parse = useParse()
  const projectId = project.id || ''
  const failedSince = new Date(Date.now() - EMAIL_FAILURE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const q = (className: string) => new Parse.Query(className).equalTo('project', project)
  const feedback = normalizeFeedbackConfig(project.get('feedback'))
  const triageKeys = feedback.enabled ? feedback.statuses.filter(s => s.category === 'open').map(s => s.key) : []

  const [drafts, sources, stripe, otherRevenue, bounced, errors, documents, triage, alerts] = await Promise.all([
    countNewest(q('ChangelogEntry').equalTo('status', 'draft').equalTo('reviewStatus', 'pending')),
    q('ContactSource').equalTo('status', 'error').limit(20).find(MASTER),
    new Parse.Query('StripeAccount').equalTo('project', project).equalTo('status', 'error').first(MASTER),
    new Parse.Query('RevenueSource').equalTo('project', project).equalTo('status', 'error').limit(20).find(MASTER),
    countNewest(q('EmailLog').containedIn('status', [...FAILED_STATUSES]).greaterThanOrEqualTo('createdAt', failedSince)),
    q('Conversation').equalTo('type', 'error').containedIn('statusCategory', OPEN_CATEGORIES).count(MASTER),
    new Parse.Query('KnowledgeDocument').matchesQuery('knowledgeModel', q('KnowledgeModel')).equalTo('isCurrent', true).equalTo('status', 'failed').count(MASTER),
    triageKeys.length ? q('FeedbackPost').notEqualTo('hidden', true).containedIn('status', triageKeys).count(MASTER) : 0,
    recentErrorAlerts(projectId).then(list => list.filter(alert => Date.now() - alert.at < ALERT_WINDOW_MS))
  ])

  const items: AttentionItem[] = []
  const add = (kind: AttentionItem['kind'], key: string, count: number, section: string, extra: Partial<Pick<AttentionItem, 'value' | 'detail' | 'at'>> = {}) => {
    if (count > 0) items.push({ key: `${kind}:${key}`, kind, projectId, count, value: '', detail: '', at: null, section, ...extra })
  }

  add('drafts', projectId, drafts.count, 'changelog', { value: String(drafts.newest?.get('title') || ''), at: iso(drafts.newest?.createdAt) })
  for (const source of sources) {
    add('sync', `source:${source.id}`, 1, 'contacts?view=sources', { value: String(source.get('name') || 'Contact sync'), detail: String(source.get('lastError') || ''), at: iso(source.get('lastRunAt')) })
  }
  if (stripe) add('sync', `stripe:${projectId}`, 1, 'revenue', { value: 'Stripe', detail: String(stripe.get('lastError') || ''), at: iso(stripe.get('lastRunAt')) })
  for (const row of otherRevenue) {
    add('sync', `revenue:${row.get('source')}:${projectId}`, 1, 'revenue', { value: revenueSource(String(row.get('source')))?.name || 'Revenue', detail: String(row.get('lastError') || ''), at: iso(row.get('lastRunAt')) })
  }
  add('bounces', projectId, bounced.count, 'email?view=log', { at: iso(bounced.newest?.createdAt) })
  const newestAlert = alerts[0]
  add('alerts', projectId, alerts.length, 'errors', { value: newestAlert?.title || '', at: newestAlert ? new Date(newestAlert.at).toISOString() : null })
  add('errors', projectId, errors, 'errors')
  add('documents', projectId, documents, 'knowledge')
  add('triage', projectId, triage, 'feedback')
  return items
}

/** Every project of the workspace that the caller may see, plus what belongs to the workspace itself, newest first. */
export async function workspaceAttention(ctx: MemberContext): Promise<AttentionItem[]> {
  const Parse = useParse()
  const rows = (await new Parse.Query('Project').equalTo('workspace', ctx.workspace).ascending('name').limit(200).find(MASTER))
    .filter(row => !ctx.apiKeyProjectIds || ctx.apiKeyProjectIds.includes(row.id || ''))
  const [perProject, paused] = await Promise.all([
    Promise.all(rows.map(project => projectAttention(project))),
    // Workspace-wide, so a key limited to some projects does not see it.
    ctx.apiKeyProjectIds ? null : Promise.resolve(sendingPauseReason(ctx.workspace.get('sendingPaused')))
  ])
  const items = perProject.flat()
  if (paused) items.push({ key: `paused:${ctx.workspaceId}`, kind: 'paused', projectId: '', count: 1, value: '', detail: paused, section: '', at: iso((ctx.workspace.get('sendingPaused') as { at?: string } | undefined)?.at) })
  return sortAttention(items)
}

/** The workspace's unread badge: customer messages waiting outside the archive, as the inbox counts them. */
export async function unreadMessages(ctx: MemberContext): Promise<number> {
  const Parse = useParse()
  const pointers = await projectPointers(ctx)
  if (!pointers.length) return 0
  // ponytail: stops at 1,000 conversations, as the inbox's and the overview's totals do.
  const rows = await new Parse.Query('Conversation').containedIn('project', pointers).doesNotExist('archivedAt').greaterThan('unreadByAgent', 0).select('unreadByAgent').limit(1000).find(MASTER)
  return rows.reduce((total, row) => total + (Number(row.get('unreadByAgent')) || 0), 0)
}

/** What the badges and the Overview list read: cached for a few seconds per workspace and key scope. */
export async function attentionSummary(ctx: MemberContext, options: { fresh?: boolean } = {}): Promise<WorkspaceAttention> {
  const redis = useRedis()
  const cacheKey = `sb:attention:${ctx.workspaceId}:${ctx.apiKeyProjectIds ? [...ctx.apiKeyProjectIds].sort().join(',') : '*'}`
  const hit = options.fresh ? null : await redis.get(cacheKey).catch(() => null)
  if (hit) { try { return JSON.parse(hit) as WorkspaceAttention } catch { /* recompute */ } }
  const [items, unread] = await Promise.all([workspaceAttention(ctx), unreadMessages(ctx)])
  const summary: WorkspaceAttention = { unreadMessages: unread, total: attentionTotal(items), items }
  void redis.set(cacheKey, JSON.stringify(summary), 'EX', CACHE_SECONDS).catch(() => {})
  return summary
}
