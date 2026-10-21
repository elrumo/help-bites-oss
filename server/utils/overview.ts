// A project's Overview page: headline numbers, the setup checklist, what needs
// attention and the latest activity, all derived from rows that already exist.
// `section` is a web section path both apps link to, optionally with a `?query`
// or `#anchor`. `title` is English; the panel translates the activity by `titleKey`
// with `params`, and keeps the English for a key it does not know.
// Below it, the workspace overview (shared/overview.ts): every project at once.

import { OVERVIEW_UNREAD_LIMIT, revenueChange, type WorkspaceOverview, type WorkspaceRevenue } from '#shared/overview'
import { can } from '#shared/roles'
import { PAYING_STATUSES, REVENUE_RANGES, fromMinor, type RevenueRange } from '#shared/stripe'
import { sortAttention, type AttentionItem } from '#shared/attention'
import type { ProjectSetup } from '#shared/setup'

export type ProjectOverview = {
  stats: { key: string, label: string, value: number, section: string }[]
  /** What is wired up, and what is not: see shared/setup.ts. */
  setup: ProjectSetup
  /** What waits on someone (see shared/attention.ts), with the unread conversations first. */
  attention: AttentionItem[]
  activity: { id: string, title: string, titleKey?: string, params?: Record<string, string | number>, detail: string, at: string, section: string, conversationId?: string }[]
}

const OPEN_CATEGORIES = ['open', 'pending']

export async function projectOverview(ctx: MemberContext, project: ParseObject): Promise<ProjectOverview> {
  const Parse = useParse()
  const p = serializeAdminProject(project)
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const q = (className: string) => new Parse.Query(className).equalTo('project', project)

  const [open, newThisWeek, emailsSent, feedbackPosts, unread, waiting, setup, conversations, posts, completed] = await Promise.all([
    q('Conversation').containedIn('statusCategory', OPEN_CATEGORIES).count(MASTER),
    q('Conversation').greaterThanOrEqualTo('createdAt', week).count(MASTER),
    q('EmailLog').greaterThanOrEqualTo('createdAt', week).count(MASTER),
    p.feedback.enabled ? q('FeedbackPost').notEqualTo('hidden', true).greaterThanOrEqualTo('postedAt', week).count(MASTER) : 0,
    q('Conversation').greaterThan('unreadByAgent', 0).count(MASTER),
    projectAttention(project),
    projectSetup(ctx, project),
    q('Conversation').exists('lastMessageAt').descending('lastMessageAt').include('endUser').limit(10).find(MASTER),
    q('FeedbackPost').notEqualTo('hidden', true).exists('postedAt').descending('postedAt').limit(5).find(MASTER),
    q('BoardItem').exists('completedAt').descending('completedAt').limit(5).find(MASTER)
  ])

  const stats: ProjectOverview['stats'] = [
    { key: 'open', label: 'Open conversations', value: open, section: 'conversations' },
    { key: 'new', label: 'New this week', value: newThisWeek, section: 'conversations' },
    { key: 'emails', label: 'Emails sent · 7d', value: emailsSent, section: 'email?view=log' }
  ]
  if (p.feedback.enabled) stats.push({ key: 'feedback', label: 'Feedback · 7d', value: feedbackPosts, section: 'feedback' })

  // Unread conversations are this list's own row (the workspace list leaves them to the inbox badge).
  const attention: AttentionItem[] = [
    ...(unread ? [{ key: `unread:${project.id}`, kind: 'unread' as const, projectId: project.id || '', count: unread, value: '', detail: '', section: 'conversations', at: null }] : []),
    ...sortAttention(waiting)
  ]

  // ponytail: a timeline from each row's latest timestamp, not an audit log; add an Activity class if full history is needed.
  const activity: ProjectOverview['activity'] = [
    ...conversations.map((row) => {
      const user = row.get('endUser') as ParseObject | undefined
      return { id: `c:${row.id}`, title: String(user?.get('name') || user?.get('email') || row.get('subject') || 'Conversation'), detail: String(row.get('lastMessagePreview') || ''), at: iso(row.get('lastMessageAt')) || '', section: 'conversations', conversationId: row.id }
    }),
    ...posts.map(row => ({ id: `f:${row.id}`, title: `New feedback: ${row.get('title') || 'Untitled'}`, titleKey: 'newFeedback', params: { title: String(row.get('title') || 'Untitled') }, detail: String(row.get('authorName') || ''), at: iso(row.get('postedAt')) || '', section: 'feedback' })),
    ...completed.map((row) => {
      const item = `${row.get('number') ? `#${row.get('number')} ` : ''}${row.get('title') || ''}`.trim()
      return { id: `b:${row.id}`, title: `Completed ${item}`, titleKey: 'completed', params: { item }, detail: '', at: iso(row.get('completedAt')) || '', section: 'board' }
    })
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20)

  return { stats, setup, attention, activity }
}

// ---- the workspace overview -------------------------------------------------------

const DAY = 86_400
const aggregate = (className: string, pipeline: Record<string, unknown>[]) =>
  new (useParse()).Query(className).aggregate(pipeline, MASTER) as Promise<Record<string, any>[]>

/** The page the panel opens on: each project's counts, the latest unread conversations and, for admins and owners, revenue. */
export async function workspaceOverview(ctx: MemberContext, range: RevenueRange): Promise<WorkspaceOverview> {
  const Parse = useParse()
  const rows = (await new Parse.Query('Project').equalTo('workspace', ctx.workspace).ascending('name').select('name').limit(200).find(MASTER))
    .filter(row => !ctx.apiKeyProjectIds || ctx.apiKeyProjectIds.includes(row.id || ''))
  const each = (where: (query: InstanceType<typeof Parse.Query>) => InstanceType<typeof Parse.Query>) =>
    Promise.all(rows.map(project => where(new Parse.Query('Conversation').equalTo('project', project)).count(MASTER)))
  // The inbox's unread: outside the archive, as the sidebar badge counts it.
  const waiting = () => new Parse.Query('Conversation').containedIn('project', rows).doesNotExist('archivedAt').greaterThan('unreadByAgent', 0)

  const [open, errors, unreadRows, latest, revenue] = await Promise.all([
    each(query => query.containedIn('statusCategory', OPEN_CATEGORIES)),
    each(query => query.equalTo('type', 'error').containedIn('statusCategory', OPEN_CATEGORIES)),
    // ponytail: unread totals stop at 1,000 conversations, as the inbox's do.
    rows.length ? waiting().select('unreadByAgent', 'project').limit(1000).find(MASTER) : [],
    rows.length ? waiting().descending('lastMessageAt').include('endUser').limit(OVERVIEW_UNREAD_LIMIT).find(MASTER) : [],
    can(ctx.role, 'marketing') ? workspaceRevenue(rows.map(row => row.id || ''), range) : null
  ])

  const unreadBy = new Map<string, number>()
  for (const row of unreadRows) unreadBy.set(pointerId(row.get('project')), (unreadBy.get(pointerId(row.get('project'))) || 0) + 1)
  const projects = rows.map((row, i) => ({ id: row.id || '', name: String(row.get('name') || ''), open: open[i] || 0, unread: unreadBy.get(row.id || '') || 0, errors: errors[i] || 0 }))
  const sum = (pick: (p: typeof projects[number]) => number) => projects.reduce((total, p) => total + pick(p), 0)

  return {
    totals: { unreadMessages: unreadRows.reduce((total, row) => total + (Number(row.get('unreadByAgent')) || 0), 0), unread: unreadRows.length, open: sum(p => p.open), errors: sum(p => p.errors) },
    projects,
    unread: latest.map((row) => {
      const user = row.get('endUser') as ParseObject | undefined
      return {
        conversationId: row.id || '', projectId: pointerId(row.get('project')),
        name: String(user?.get('name') || ''), email: String(user?.get('email') || ''), subject: String(row.get('subject') || ''),
        preview: String(row.get('lastMessagePreview') || ''), unread: Number(row.get('unreadByAgent')) || 0,
        at: iso(row.get('lastMessageAt')) || iso(row.createdAt) || ''
      }
    }),
    revenue
  }
}

/** Revenue for each of these projects that has Stripe connected, in its own currency, with totals per currency. */
export async function workspaceRevenue(projectIds: string[], range: RevenueRange): Promise<WorkspaceRevenue> {
  const accounts = projectIds.length ? await new (useParse()).Query('StripeAccount').containedIn('projectId', projectIds).select('projectId', 'currency').limit(1000).find(MASTER) : []
  const days = REVENUE_RANGES.find(r => r.value === range)?.days || 0
  const since = days ? Math.floor(Date.now() / 1000) - days * DAY : 0
  const months = lastMonths(new Date())
  // A project counts in its main currency only (an account with no currency has not synced yet), so each currency is summed on its own.
  const byCurrency = new Map<string, string[]>()
  for (const row of accounts) {
    const currency = String(row.get('currency') || '')
    if (currency) byCurrency.set(currency, [...(byCurrency.get(currency) || []), String(row.get('projectId'))])
  }
  const keyed = (rows: Record<string, any>[] | null, field: string) => new Map((rows || []).map(r => [String(r.objectId), Number(r[field]) || 0]))

  const groups = await Promise.all([...byCurrency].map(async ([currency, ids]) => {
    const paid = { projectId: { $in: ids }, currency, status: 'succeeded' }
    const [period, before, subs, monthly] = await Promise.all([
      aggregate('StripePayment', [{ $match: { ...paid, paidAtSec: { $gte: since } } }, { $group: { _id: '$projectId', net: { $sum: '$net' }, payments: { $sum: 1 } } }]),
      days ? aggregate('StripePayment', [{ $match: { ...paid, paidAtSec: { $gte: since - days * DAY, $lt: since } } }, { $group: { _id: '$projectId', net: { $sum: '$net' } } }]) : null,
      aggregate('StripeSubscription', [{ $match: { projectId: { $in: ids }, currency, status: { $in: PAYING_STATUSES } } }, { $group: { _id: '$projectId', mrr: { $sum: '$mrr' }, n: { $sum: 1 } } }]),
      aggregate('StripePayment', [{ $match: { ...paid, month: { $gte: months[0] } } }, { $group: { _id: '$month', net: { $sum: '$net' } } }])
    ])
    const [net, payments, previous, mrr, subscribers, byMonth] = [keyed(period, 'net'), keyed(period, 'payments'), keyed(before, 'net'), keyed(subs, 'mrr'), keyed(subs, 'n'), keyed(monthly, 'net')]
    const projects = ids.map((projectId) => {
      const amount = fromMinor(net.get(projectId) || 0, currency)
      const previousNet = before ? fromMinor(previous.get(projectId) || 0, currency) : null
      return { projectId, currency, net: amount, previousNet, change: revenueChange(amount, previousNet), mrr: fromMinor(mrr.get(projectId) || 0, currency), subscribers: subscribers.get(projectId) || 0, payments: payments.get(projectId) || 0 }
    })
    const total = (pick: (p: typeof projects[number]) => number) => Math.round(projects.reduce((sum, p) => sum + pick(p), 0) * 100) / 100
    const totalNet = total(p => p.net)
    const previousNet = before ? total(p => p.previousNet || 0) : null
    return {
      projects,
      total: {
        currency, net: totalNet, previousNet, change: revenueChange(totalNet, previousNet), mrr: total(p => p.mrr), subscribers: total(p => p.subscribers),
        months: months.map(month => ({ month, net: fromMinor(byMonth.get(month) || 0, currency) }))
      }
    }
  }))

  const order = (a: { net: number, mrr: number }, b: { net: number, mrr: number }) => b.net - a.net || b.mrr - a.mrr
  return { range, connected: accounts.length, totals: groups.map(g => g.total).sort(order), projects: groups.flatMap(g => g.projects).sort(order) }
}
