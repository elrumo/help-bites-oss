// A project's Overview page: headline numbers, setup health, what needs
// attention and the latest activity, all derived from rows that already exist.
// `section` is a web section path (optionally with a query) both apps link to.

export type OverviewTone = 'ok' | 'warn' | 'off'
export type ProjectOverview = {
  stats: { key: string, label: string, value: number, section: string }[]
  health: { key: string, label: string, state: OverviewTone, detail: string, section: string }[]
  /** Only what has a non-zero count. */
  attention: { key: string, label: string, count: number, section: string }[]
  activity: { id: string, title: string, detail: string, at: string, section: string, conversationId?: string }[]
}

const OPEN_CATEGORIES = ['open', 'pending']

export async function projectOverview(project: ParseObject): Promise<ProjectOverview> {
  const Parse = useParse()
  const p = serializeAdminProject(project)
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const q = (className: string) => new Parse.Query(className).equalTo('project', project)
  const triageKeys = p.feedback.enabled ? p.feedback.statuses.filter(s => s.category === 'open').map(s => s.key) : []
  const models = q('KnowledgeModel')

  const [open, newThisWeek, emailsSent, feedbackPosts, unread, openErrors, failedEmails, failedDocs, toTriage, conversations, posts, completed] = await Promise.all([
    q('Conversation').containedIn('statusCategory', OPEN_CATEGORIES).count(MASTER),
    q('Conversation').greaterThanOrEqualTo('createdAt', week).count(MASTER),
    q('EmailLog').greaterThanOrEqualTo('createdAt', week).count(MASTER),
    p.feedback.enabled ? q('FeedbackPost').notEqualTo('hidden', true).greaterThanOrEqualTo('postedAt', week).count(MASTER) : 0,
    q('Conversation').greaterThan('unreadByAgent', 0).count(MASTER),
    q('Conversation').equalTo('type', 'error').containedIn('statusCategory', OPEN_CATEGORIES).count(MASTER),
    q('EmailLog').containedIn('status', [...FAILED_STATUSES]).greaterThanOrEqualTo('createdAt', week).count(MASTER),
    new Parse.Query('KnowledgeDocument').matchesQuery('knowledgeModel', models).equalTo('isCurrent', true).equalTo('status', 'failed').count(MASTER),
    triageKeys.length ? q('FeedbackPost').notEqualTo('hidden', true).containedIn('status', triageKeys).count(MASTER) : 0,
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

  const origins = p.allowedOrigins.length
  const mail = isMailerConfigured({ fromEmail: p.fromEmail, domain: p.mailDomain })
  const health: ProjectOverview['health'] = [
    { key: 'chat', label: 'Chat widget', state: origins ? 'ok' : 'warn', detail: origins ? `${origins} allowed origin${origins === 1 ? '' : 's'}` : 'No allowed origins', section: 'dev' },
    { key: 'email', label: 'Email sending', state: mail ? 'ok' : 'warn', detail: mail ? p.fromEmail || 'Default sender' : 'Not configured', section: 'settings' },
    { key: 'notify', label: 'Team notifications', state: p.notifyEmails.length ? 'ok' : 'off', detail: p.notifyEmails.length ? p.notifyEmails.join(', ') : 'Nobody is emailed', section: 'settings' },
    { key: 'feedback', label: 'Feedback board', state: p.feedback.enabled ? 'ok' : 'off', detail: p.feedback.enabled ? 'On' : 'Off', section: 'feedback' },
    { key: 'errors', label: 'Error tracking', state: p.errors.connected ? 'ok' : 'off', detail: p.errors.connected ? p.errors.providerName : 'Not connected', section: 'errors' }
  ]

  const attention: ProjectOverview['attention'] = [
    { key: 'unread', label: 'Unread conversations', count: unread, section: 'conversations' },
    { key: 'errors', label: 'Open error reports', count: openErrors, section: 'errors' },
    { key: 'emails', label: 'Failed emails · 7d', count: failedEmails, section: 'email?view=log' },
    { key: 'documents', label: 'Knowledge documents failed to process', count: failedDocs, section: 'knowledge' },
    { key: 'feedback', label: 'Feedback awaiting triage', count: toTriage, section: 'feedback' }
  ].filter(item => item.count > 0)

  // ponytail: a timeline from each row's latest timestamp, not an audit log; add an Activity class if full history is needed.
  const activity: ProjectOverview['activity'] = [
    ...conversations.map((row) => {
      const user = row.get('endUser') as ParseObject | undefined
      return { id: `c:${row.id}`, title: String(user?.get('name') || user?.get('email') || row.get('subject') || 'Conversation'), detail: String(row.get('lastMessagePreview') || ''), at: iso(row.get('lastMessageAt')) || '', section: 'conversations', conversationId: row.id }
    }),
    ...posts.map(row => ({ id: `f:${row.id}`, title: `New feedback: ${row.get('title') || 'Untitled'}`, detail: String(row.get('authorName') || ''), at: iso(row.get('postedAt')) || '', section: 'feedback' })),
    ...completed.map(row => ({ id: `b:${row.id}`, title: `Completed ${row.get('number') ? `#${row.get('number')} ` : ''}${row.get('title') || ''}`.trim(), detail: '', at: iso(row.get('completedAt')) || '', section: 'board' }))
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20)

  return { stats, health, attention, activity }
}
