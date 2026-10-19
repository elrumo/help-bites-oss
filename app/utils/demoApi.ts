import { DEFAULT_FEEDBACK_CONFIG } from '#shared/feedback'
import { DEFAULT_BOARD_CONFIG, ROADMAP_CATEGORIES } from '#shared/board'
import { DEFAULT_MARKETING_CONFIG } from '#shared/marketing'
import { DEFAULT_CHANGELOG_CONFIG } from '#shared/changelog'
import type { FeatureFlag } from '#shared/flags'
import { cloneBlankEmailDocument, cloneEmailTemplateDocument } from '#shared/email/templates'
import { extractTemplateVariables } from '#shared/email/placeholders'
import type { EmailDocument } from '#shared/email/blocks'
import type { TemplateVariable } from '#shared/email/resolve'
import { normalizeComponentInput, type EmailComponentDef } from '#shared/email/components'
import { messagePreview, toggleReactions, type Context, type Conversation, type ConversationType, type Message, type MessageReactionEmoji } from '#shared/support'
import { COUNTERS, GAUGES, UNLIMITED_PLAN } from '#shared/entitlements'
import type { EmailFolder, EmailTemplate } from '~~/server/utils/emails'
import type { EmailLogEntry, EmailLogStatus, EmailSuppression } from '~~/server/utils/emailLogs'
import type { AdminProject } from '~~/server/utils/projects'
import type { ProjectOverview } from '~~/server/utils/overview'

// The landing page's demo: the real panel, answered from memory instead of the
// API. Nothing leaves the tab and a reload starts over from these fixtures.
// Anything not handled below answers "not in the demo", which every page
// already shows as an ordinary error.

type EndUser = { id: string, externalId: string, name: string, email: string, projectId: string }
type Req = { params: string[], query: Record<string, string>, body: any }

const NOT_IN_DEMO = 'Not available in the demo. Self-host HelpBites to try this part.'
const ME = { id: 'agent_demo', username: 'demo', email: 'you@example.com', name: 'You' }
const SAM = { id: 'agent_sam', username: 'sam', email: 'sam@example.com', name: 'Sam Rivera' }
const WORKSPACE = { id: 'ws_demo', name: 'Acme Inc.', status: 'active', role: 'owner' as const, createdAt: null }

const start = Date.now()
const ago = (minutes: number) => new Date(start - minutes * 60_000).toISOString()
const now = () => new Date().toISOString()
let seq = 0
const newId = (prefix: string) => `${prefix}_demo${++seq}`
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
// What $fetch does to a body and a response: plain JSON, no shared references
// (and no Vue proxies, which structuredClone refuses).
const wire = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode })
}

// ---- fixtures -----------------------------------------------------------------

const supportType = (projectId: string): ConversationType => ({
  id: newId('type'), projectId, key: 'support', name: 'Support', description: '', icon: '',
  statuses: [
    { key: 'open', label: 'Open', category: 'open', isDefault: true },
    { key: 'done', label: 'Done', category: 'resolved', isTerminal: true, reopenTo: 'open' }
  ],
  fields: [], actions: [], assignable: true, userCanReopen: true, defaultPriority: 'normal'
})

const bugType = (projectId: string): ConversationType => ({
  id: newId('type'), projectId, key: 'bug', name: 'Bug report', description: 'Something in the app is broken.', icon: 'i-lucide-bug',
  statuses: [
    { key: 'new', label: 'New', category: 'open', isDefault: true },
    { key: 'triaged', label: 'Triaged', category: 'pending' },
    { key: 'fixed', label: 'Fixed', category: 'resolved', isTerminal: true, reopenTo: 'new' },
    { key: 'wontfix', label: "Won't fix", category: 'closed', isTerminal: true, reopenTo: 'new' }
  ],
  fields: [
    { key: 'severity', label: 'Severity', type: 'select', options: ['minor', 'major', 'blocker'], editableBy: 'agent' },
    { key: 'browser', label: 'Browser', type: 'text' }
  ],
  actions: [{ key: 'credit', label: 'Credit one month', confirm: 'Credit this customer one month?', statusAfter: 'fixed' }],
  assignable: true, userCanReopen: true, defaultPriority: 'normal'
})

function project(id: string, name: string, siteUrl: string, accent: string, flags: FeatureFlag[]): AdminProject {
  return {
    id, slug: slug(name), publicKey: `pk_demo_${id}`, name, siteUrl, allowedOrigins: [siteUrl], theme: { accent },
    allowAttachments: true, allowAnonymousUsers: false, chatNotice: '', brandLogoUrl: '', iconUrl: '', assistantLogoUrl: '', letUsersChooseType: false, allowOtherType: false,
    feedback: { ...DEFAULT_FEEDBACK_CONFIG, enabled: true, title: `${name} feedback` },
    board: DEFAULT_BOARD_CONFIG,
    changelog: DEFAULT_CHANGELOG_CONFIG,
    inboxPath: '/inbox', fromName: `${name} Support`, notifyEmails: [`support@${new URL(siteUrl).host}`],
    fromEmail: '', replyTo: '', mailDomain: '', emailLogContent: false,
    actionWebhookUrl: '', hasActionWebhookSecret: false, flags,
    marketing: { ...DEFAULT_MARKETING_CONFIG, postalAddress: '1 Demo Street, Lisbon, Portugal', topics: [{ key: 'product', name: 'Product updates', description: 'What shipped this month' }] }, eventWebhookUrl: '', hasEventWebhookSecret: false, errors: { connected: id === 'acme', provider: id === 'acme' ? 'glitchtip' : '', providerName: id === 'acme' ? 'GlitchTip' : '', dsn: id === 'acme' ? 'https://public@example.glitchtip.com/42' : '', url: id === 'acme' ? 'https://example.glitchtip.com/helpbites/issues' : '', alertWebhookUrl: '' }, createdAt: ago(60 * 24 * 90)
  }
}

const projects: AdminProject[] = [
  project('acme', 'Acme', 'https://acme.app', '#4f46e5', [
    { key: 'new_dashboard', description: 'The redesigned dashboard', state: 'admins', fallback: 'off', targets: ['frontend'], allow: ['maya@example.com'] },
    { key: 'csv_import', description: 'Import tasks from CSV', state: 'on', fallback: 'on', targets: ['frontend', 'backend'], allow: [] }
  ]),
  project('fieldnotes', 'Fieldnotes', 'https://fieldnotes.io', '#0f766e', [
    { key: 'ai_summaries', description: 'Summarise a notebook', state: 'off', fallback: 'off', targets: ['ios'], allow: [] }
  ])
]
const types: Record<string, ConversationType[]> = { acme: [supportType('acme'), bugType('acme')], fieldnotes: [supportType('fieldnotes')] }
const secrets: Record<string, string> = {}

const endUsers: EndUser[] = []
const segments: { id: string, projectId: string, name: string, filter: unknown, createdAt: string, updatedAt: string }[] = []
const contactExtras: Record<string, { tags?: string[], subscription?: string }> = {}
const DEMO_PLANS = ['free', 'pro', 'team']
const demoCampaigns = [{
  id: 'cmp_demo1', projectId: 'acme', name: 'September product update', status: 'sent', template: 'newsletter', templateName: 'Editorial digest', subject: 'What shipped in September, {{firstName}}',
  audience: { segment: '', topic: 'product' }, scheduledAt: ago(60 * 24 * 6), startedAt: ago(60 * 24 * 6), finishedAt: ago(60 * 24 * 6 - 4), testMode: false, lastError: '',
  stats: { audience: 1284, sent: 1279, failed: 0, suppressed: 5, delivered: 1262, opened: 611, clicked: 143, bounced: 9, complained: 1, unsubscribed: 7 },
  createdAt: ago(60 * 24 * 8), updatedAt: ago(60 * 24 * 6)
}]

function asContact(u: EndUser) {
  const n = Number(u.id.replace(/\D/g, '')) || 0
  const extra = contactExtras[u.id] || {}
  return {
    id: u.id, externalId: u.externalId, email: u.email, name: u.name, username: '', avatarUrl: '',
    attributes: { plan: DEMO_PLANS[n % 3]!, seats: (n % 5) + 1 }, tags: extra.tags || (n % 2 ? ['beta'] : []),
    subscription: extra.subscription || (n % 3 === 0 ? 'none' : 'subscribed'), unsubscribedTopics: [],
    consent: n % 3 === 0 ? null : { source: 'form', at: ago(60 * 24 * 20) }, sources: [], feedbackEmails: true,
    lastSeenAt: ago(n * 37), createdAt: ago(60 * 24 * 30 + n), updatedAt: ago(n)
  }
}
const conversations: Conversation[] = []
const messages: Message[] = []
const errorServers = [
  { id: 'srv-glitchtip', provider: 'glitchtip', providerName: 'GlitchTip', name: 'example.glitchtip.com', url: 'https://example.glitchtip.com', apiUrl: '', org: 'helpbites', hasToken: true, builtIn: false },
  { id: 'srv-bugsink', provider: 'bugsink', providerName: 'Bugsink', name: 'example.bugsink.com', url: 'https://example.bugsink.com', apiUrl: '', org: '', hasToken: true, builtIn: false }
]
const errorIssues = [
  { id: '1001', title: 'TypeError: Cannot read properties of undefined', culprit: 'checkout.ts:42', level: 'error', count: 12, lastSeen: ago(8), status: 'unresolved', url: 'https://example.glitchtip.com/helpbites/issues/1001', conversationId: '' },
  { id: '1002', title: 'Network request failed', culprit: 'api.ts:18', level: 'warning', count: 3, lastSeen: ago(90), status: 'resolved', url: 'https://example.glitchtip.com/helpbites/issues/1002', conversationId: '' }
]

function message(conversationId: string, sender: 'user' | 'agent', senderName: string, body: string, createdAt: string, extra: Partial<Message> = {}): Message {
  return { id: newId('msg'), conversationId, sender, senderName, body, attachments: [], reactions: [], context: null, replyToId: '', clientId: '', visibility: 'public', kind: 'message', createdAt, ...extra }
}

/** Point the conversation's preview at its latest public message, as the server does on every write. */
function summarize(conversation: Conversation) {
  const last = messages.filter(m => m.conversationId === conversation.id && m.visibility === 'public' && m.kind === 'message').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)
  conversation.lastMessageAt = last?.createdAt || conversation.createdAt
  conversation.lastMessagePreview = last ? messagePreview(last.body || (last.attachments.length ? 'Image' : '')) : ''
  conversation.lastMessageFrom = last?.sender || ''
}

function seed(projectId: string, user: Omit<EndUser, 'id' | 'projectId'>, subject: string, thread: [('user' | 'agent' | 'sam' | 'note'), string, number][], extra: Partial<Conversation> = {}) {
  const endUser = { id: newId('user'), projectId, ...user }
  endUsers.push(endUser)
  const type = types[projectId]!.find(t => t.key === (extra.type || 'support'))!
  const status = type.statuses.find(s => s.key === extra.status) || type.statuses.find(s => s.isDefault)!
  const id = newId('conv')
  const conversation: Conversation = {
    id, projectId, endUserId: endUser.id, assistantId: '', subject, status: status.key, statusCategory: status.category, type: type.key, priority: 'normal',
    assigneeId: '', assignedAt: null, tags: [], fields: {}, subjectRef: null, reopenedAt: null, closedAt: null, doneAt: null, context: null,
    lastMessageAt: null, lastMessagePreview: '', lastMessageFrom: '', unreadByAgent: 0, unreadByUser: 0, userReadAt: null, agentReadAt: null,
    createdAt: ago(thread[0]![2]), ...extra
  }
  const agentName = projects.find(p => p.id === projectId)!.fromName
  for (const [who, body, minutes] of thread) {
    if (who === 'user') messages.push(message(id, 'user', user.name, body, ago(minutes), minutes === thread[0]![2] ? { context: conversation.context } : {}))
    else if (who === 'note') messages.push(message(id, 'agent', SAM.name, body, ago(minutes), { visibility: 'internal' }))
    else messages.push(message(id, 'agent', who === 'sam' ? SAM.name : agentName, body, ago(minutes)))
  }
  summarize(conversation)
  conversations.push(conversation)
}

const page = (url: string, label: string): Context => ({ type: 'page', id: new URL(url).pathname, label, url })

seed('acme', { externalId: 'u_1042', name: 'Maya Chen', email: 'maya@example.com' }, 'Export stuck', [
  ['user', 'Hey — my export has been stuck on “preparing” for about ten minutes.', 14],
  ['user', 'It’s the Q3 report, if that helps.', 13]
], { unreadByAgent: 2, context: page('https://acme.app/settings/exports', 'Exports') })

seed('acme', { externalId: 'u_2281', name: 'Priya Natarajan', email: 'priya@example.com' }, 'Calendar shows tasks a day early', [
  ['user', 'Every task in the calendar view shows up one day before its due date. List view is fine.', 60 * 5],
  ['sam', 'Thanks Priya — I can reproduce it in Safari. We’re on it.', 60 * 4],
  ['note', 'Timezone offset bug in the calendar grid, only Safari. Fix is in review.', 60 * 4 - 5],
  ['user', 'Great, thanks for the quick reply!', 60 * 3]
], { type: 'bug', status: 'triaged', priority: 'high', assigneeId: SAM.id, assignedAt: ago(60 * 4), tags: ['calendar'], fields: { severity: 'major', browser: 'Safari 18' }, context: page('https://acme.app/calendar', 'Calendar') })

seed('acme', { externalId: 'u_0877', name: 'Lucas Moreau', email: 'lucas@example.com' }, 'Invoice for September', [
  ['user', 'Hi! Could you send me the invoice for September? I need it for our accountant.', 50],
  ['user', 'Our VAT number is FR 12 345678901, if it needs to be on it.', 48]
], { unreadByAgent: 2, context: page('https://acme.app/settings/billing', 'Billing') })

seed('acme', { externalId: 'u_3310', name: 'Jonas Weber', email: 'jonas@example.com' }, 'Workspace URL', [
  ['user', 'Can I change my workspace URL? We renamed the company.', 60 * 26],
  ['agent', 'You can! Settings → Workspace → URL. The old one keeps redirecting for 30 days.', 60 * 25],
  ['user', 'Perfect, done. Thanks!', 60 * 25 - 10]
], { status: 'done', doneAt: ago(60 * 25), closedAt: ago(60 * 25) })

seed('fieldnotes', { externalId: 'ios_5521', name: 'Ana Souza', email: 'ana@example.com' }, 'Sync stopped on iPad', [
  ['user', 'My iPad stopped syncing since this morning. iPhone is fine. I have notes for a meeting in an hour 😬', 6]
], { unreadByAgent: 1, priority: 'urgent', context: { type: 'screen', id: 'settings.sync', label: 'Settings › Sync' } })

seed('fieldnotes', { externalId: 'ios_1180', name: 'Ren Takahashi', email: '' }, 'Export to Markdown', [
  ['user', 'Is there a way to export a notebook as Markdown?', 60 * 2],
  ['agent', 'Yes — open the notebook, tap ••• and choose Export → Markdown. It makes a zip with one file per note.', 60 * 2 - 15]
])

seed('fieldnotes', { externalId: 'ios_0042', name: 'Tom Becker', email: 'tom@example.com' }, 'Widgets', [
  ['user', 'Just wanted to say the new home screen widgets are lovely.', 60 * 30],
  ['agent', 'That made our day — thank you, Tom!', 60 * 29]
], { status: 'done', doneAt: ago(60 * 29), closedAt: ago(60 * 29) })
messages.at(-1)!.reactions = [{ emoji: '❤️', actor: 'user', side: 'user', actorName: 'Tom Becker', at: ago(60 * 28) }]

const variablesOf = (doc: EmailDocument, declared: TemplateVariable[] = []) => {
  const byKey = new Map(declared.map(v => [v.key, v]))
  return extractTemplateVariables(doc).map(key => byKey.get(key) || { key })
}
function emailTemplate(projectId: string | null, name: string, document: EmailDocument | null, extra: Partial<EmailTemplate> = {}): EmailTemplate {
  return { id: newId('email'), projectId, masterId: null, folderId: null, key: slug(name), name, description: '', document, variables: document ? variablesOf(document) : [], variableValues: {}, shareMode: null, shareToken: null, shareExpiresAt: null, lastSharedEdit: null, lastActorId: null, updatedAt: Date.now(), master: null, ...extra }
}
const emails: EmailTemplate[] = [
  emailTemplate(null, 'Welcome', cloneEmailTemplateDocument('welcome-soft')!),
  emailTemplate(null, 'Monthly newsletter', cloneEmailTemplateDocument('newsletter-editorial')!),
  emailTemplate('acme', 'Export ready', cloneEmailTemplateDocument('transactional-utility')!)
]
const folders: EmailFolder[] = []
const components: EmailComponentDef[] = []

// A morning of sends for the email log.
function sent(to: string, toName: string, subject: string, status: EmailLogStatus, minutes: number, extra: Partial<EmailLogEntry> = {}): EmailLogEntry {
  const createdAt = ago(minutes)
  const later = (m: number) => ago(Math.max(minutes - m, 0))
  const events = status === 'delivered' || status === 'opened' || status === 'clicked'
    ? [{ type: 'delivered', at: later(1), detail: 'OK' }, ...(status !== 'delivered' ? [{ type: 'opened', at: later(9), detail: 'Apple Mail · mobile' }] : []), ...(status === 'clicked' ? [{ type: 'clicked', at: later(10), detail: 'https://acme.app/exports/7731' }] : [])]
    : status === 'bounced' ? [{ type: 'bounced', at: later(1), detail: '550 5.1.1 The email account that you tried to reach does not exist' }] : []
  return {
    id: newId('log'), projectId: 'acme', batchId: newId('eb'), source: 'api', kind: 'template', template: null, to, toName, cc: [], bcc: [],
    from: 'Acme <hello@mail.acme.app>', replyTo: 'support@acme.app', subject, status, error: '', messageId: `${minutes}.demo@mail.acme.app`,
    tags: [], metadata: {}, variables: [], attachments: [], headers: [], events, scheduledAt: null, testMode: false, idempotencyKey: '',
    actor: { type: 'project', id: 'acme', name: 'Acme' }, ip: '203.0.113.7', userAgent: 'node', durationMs: 180, hasContent: false, createdAt, updatedAt: createdAt, ...extra
  }
}
const topKeys = (rows: EmailLogEntry[]) => {
  const counts = new Map<string, { key: string, name: string, count: number }>()
  for (const l of rows) {
    if (!l.template?.key) continue
    const t = counts.get(l.template.key) || { key: l.template.key, name: l.template.name || l.template.key, count: 0 }
    t.count++
    counts.set(l.template.key, t)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}
const exportTemplate = (): EmailLogEntry['template'] => ({ id: emails[2]!.id, key: emails[2]!.key, name: emails[2]!.name })
const emailLogs: EmailLogEntry[] = [
  sent('maya@example.com', 'Maya Chen', 'Your export is ready', 'clicked', 12, { template: exportTemplate(), variables: [{ key: 'firstName', value: 'Maya' }, { key: 'downloadUrl', value: '[redacted]' }], tags: ['exports'], metadata: { exportId: '7731' } }),
  sent('lucas@example.com', 'Lucas Moreau', 'Re: Invoice for September', 'delivered', 47, { source: 'notification', kind: 'message', template: { id: null, key: '', name: 'Conversation: reply' }, actor: { type: 'system', id: '', name: 'HelpBites' }, from: 'You from Acme <hello@mail.acme.app>' }),
  sent('old-address@example.com', '', 'Your export is ready', 'bounced', 95, { template: exportTemplate() }),
  sent('priya@example.com', 'Priya Natarajan', 'Your export is ready', 'opened', 180, { template: exportTemplate() }),
  sent('jonas@example.com', 'Jonas Weber', 'Workspace URL changed', 'suppressed', 240, { kind: 'html', error: 'On the suppression list (unsubscribe)', events: [], messageId: '' })
]
const emailSuppressions: EmailSuppression[] = [
  { id: newId('sup'), projectId: 'acme', email: 'old-address@example.com', reason: 'bounce', detail: '550 5.1.1 The email account that you tried to reach does not exist', source: 'webhook', createdAt: ago(94) },
  { id: newId('sup'), projectId: 'acme', email: 'jonas@example.com', reason: 'unsubscribe', detail: 'Unsubscribed in the app', source: 'api', createdAt: ago(60 * 26) }
]

// ---- helpers ------------------------------------------------------------------

const find = <T extends { id: string }>(list: T[], id: string | undefined, what: string): T => list.find(item => item.id === id) || fail(404, `${what} not found`)
const typeOf = (c: Conversation) => types[c.projectId]?.find(t => t.key === c.type) || supportType(c.projectId)
const userOf = (c: Conversation) => endUsers.find(u => u.id === c.endUserId)!
const serializeUser = ({ projectId: _, ...user }: EndUser) => user

function setStatus(c: Conversation, key: string) {
  const next = typeOf(c).statuses.find(s => s.key === key) || fail(400, `Unknown status ${key}`)
  c.status = next.key
  c.statusCategory = next.category
  c.closedAt = next.isTerminal ? now() : null
  c.doneAt = next.isTerminal && next.key === 'done' ? now() : null
}

function withMaster(t: EmailTemplate): EmailTemplate {
  const master = t.masterId ? emails.find(m => m.id === t.masterId) : null
  return { ...t, master: master ? { id: master.id, name: master.name, document: master.document, variables: master.variables, updatedAt: master.updatedAt } : null }
}

function applyProject(p: AdminProject, body: Record<string, any>) {
  const { notifyEmails, feedback, board, theme, actionWebhookSecret, ...rest } = body
  for (const key of Object.keys(rest)) if (key in p) (p as any)[key] = rest[key]
  if (notifyEmails !== undefined) p.notifyEmails = Array.isArray(notifyEmails) ? notifyEmails : String(notifyEmails).split(/[,\s]+/).filter(Boolean)
  if (feedback) p.feedback = { ...p.feedback, ...feedback }
  if (board) p.board = { ...p.board, ...board, roadmap: { ...p.board.roadmap, ...board.roadmap } }
  if (theme) p.theme = { ...p.theme, ...theme }
  if (actionWebhookSecret) p.hasActionWebhookSecret = true
}

// ---- routes -------------------------------------------------------------------

const routes: [string, RegExp, (req: Req) => unknown][] = [
  ['GET', /^\/admin\/me$/, () => ({ agent: ME, workspace: WORKSPACE, role: 'owner', workspaces: [WORKSPACE], edition: 'community', plan: { id: UNLIMITED_PLAN.id, name: UNLIMITED_PLAN.name, unlimited: true }, features: { ...UNLIMITED_PLAN.features, teammatePasswords: true }, links: { sourceCode: '/source' } })],
  ['GET', /^\/admin\/workspace$/, () => ({ workspace: WORKSPACE })],
  ['PATCH', /^\/admin\/workspace$/, ({ body }) => {
    if (typeof body.name === 'string' && body.name.trim()) WORKSPACE.name = body.name.trim()
    return { workspace: WORKSPACE }
  }],
  ['GET', /^\/admin\/invitations$/, () => ({ invitations: [] })],
  // The community plan, as on any self-hosted install: nothing is limited.
  ['GET', /^\/admin\/usage$/, () => ({
    plan: { id: UNLIMITED_PLAN.id, name: UNLIMITED_PLAN.name }, unlimited: true, limits: UNLIMITED_PLAN.limits, soft: {}, features: UNLIMITED_PLAN.features, apiPerMinute: null, emailLogDays: null,
    usage: { ...Object.fromEntries([...GAUGES, ...COUNTERS].map(metric => [metric, 0])), projects: projects.length, seats: 2, contacts: endUsers.length, conversations: conversations.length, emails: emailLogs.length }
  })],
  ['GET', /^\/admin\/workspace\/ai$/, () => ({ ai: null, platform: { available: true, metered: false }, allowed: true })],
  ['PATCH', /^\/admin\/me$/, ({ body }) => {
    if (typeof body.name === 'string') ME.name = body.name.trim()
    if (typeof body.email === 'string') ME.email = body.email.trim()
    return { agent: ME }
  }],
  ['POST', /^\/admin\/logout$/, () => ({})],
  ['GET', /^\/admin\/agents$/, () => ({ agents: [{ ...ME, role: 'owner' }, { ...SAM, role: 'agent' }] })],

  // projects
  ['GET', /^\/admin\/projects$/, () => ({ projects })],
  ['POST', /^\/admin\/projects$/, ({ body }) => {
    const p = project(newId('proj'), String(body.name || 'Untitled'), body.siteUrl || 'https://example.com', '#0f766e', [])
    projects.push(p)
    types[p.id] = [supportType(p.id)]
    return { project: p, secret: (secrets[p.id] = `sk_demo_${newId('secret')}`) }
  }],
  ['PATCH', /^\/admin\/projects\/([^/]+)$/, ({ params, body }) => {
    const p = find(projects, params[0], 'Project')
    applyProject(p, body)
    return { project: p }
  }],
  ['GET', /^\/admin\/projects\/([^/]+)\/overview$/, ({ params }): ProjectOverview => {
    const p = find(projects, params[0], 'Project')
    const scoped = conversations.filter(c => c.projectId === p.id)
    const mail = emailLogs.filter(e => e.projectId === p.id)
    const failed = mail.filter(e => ['failed', 'bounced', 'complained', 'suppressed'].includes(e.status)).length
    const unread = scoped.filter(c => c.unreadByAgent > 0).length
    const origins = p.allowedOrigins.length
    return {
      stats: [
        { key: 'open', label: 'Open conversations', value: scoped.filter(c => c.statusCategory === 'open' || c.statusCategory === 'pending').length, section: 'conversations' },
        { key: 'new', label: 'New this week', value: scoped.length, section: 'conversations' },
        { key: 'emails', label: 'Emails sent · 7d', value: mail.length, section: 'email?view=log' }
      ],
      health: [
        { key: 'chat', label: 'Chat widget', state: origins ? 'ok' : 'warn', detail: origins ? `${origins} allowed origin${origins === 1 ? '' : 's'}` : 'No allowed origins', section: 'dev' },
        { key: 'email', label: 'Email sending', state: 'ok', detail: p.fromEmail || 'Default sender', section: 'settings' },
        { key: 'feedback', label: 'Feedback board', state: p.feedback.enabled ? 'ok' : 'off', detail: p.feedback.enabled ? 'On' : 'Off', section: 'feedback' },
        { key: 'errors', label: 'Error tracking', state: p.errors.connected ? 'ok' : 'off', detail: p.errors.connected ? p.errors.providerName : 'Not connected', section: 'errors' }
      ],
      attention: [
        { key: 'unread', label: 'Unread conversations', count: unread, section: 'conversations' },
        { key: 'emails', label: 'Failed emails · 7d', count: failed, section: 'email?view=log' }
      ].filter(item => item.count > 0),
      activity: scoped.filter(c => c.lastMessageAt).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt))).slice(0, 10)
        .map(c => ({ id: `c:${c.id}`, title: userOf(c).name || userOf(c).email || 'Conversation', detail: c.lastMessagePreview, at: String(c.lastMessageAt), section: 'conversations', conversationId: c.id }))
    }
  }],
  ['GET', /^\/admin\/projects\/([^/]+)\/secret$/, ({ params }) => ({ secret: (secrets[params[0]!] ||= `sk_demo_${newId('secret')}`) })],
  ['POST', /^\/admin\/projects\/([^/]+)\/rotate-secret$/, ({ params }) => ({ secret: (secrets[params[0]!] = `sk_demo_${newId('secret')}`) })],
  ['GET', /^\/admin\/projects\/([^/]+)\/types$/, ({ params }) => ({ types: types[params[0]!] || [] })],
  ['POST', /^\/admin\/projects\/([^/]+)\/types$/, ({ params, body }) => {
    const list = (types[params[0]!] ||= [])
    if (list.some(t => t.key === body.key)) fail(409, 'A type with that key exists')
    const type = { ...supportType(params[0]!), icon: '', defaultPriority: 'normal' as const, ...body }
    list.push(type)
    return { type }
  }],
  ['PATCH', /^\/admin\/projects\/([^/]+)\/types\/([^/]+)$/, ({ params, body }) => {
    const type = types[params[0]!]?.find(t => t.id === params[1]) || fail(404, 'Type not found')
    Object.assign(type, body, { key: type.key })
    return { type }
  }],
  ['DELETE', /^\/admin\/projects\/([^/]+)\/types\/([^/]+)$/, ({ params }) => {
    types[params[0]!] = (types[params[0]!] || []).filter(t => t.id !== params[1])
    return { deleted: true }
  }],
  ['GET', /^\/admin\/errors\/servers$/, () => ({ servers: errorServers, providers: [
    { id: 'glitchtip', name: 'GlitchTip', required: ['url', 'token', 'org'], manualAlerts: false },
    { id: 'bugsink', name: 'Bugsink', required: ['url', 'token'], manualAlerts: true }
  ] })],
  ['POST', /^\/admin\/errors\/servers$/, ({ body }) => {
    const id = `srv${errorServers.length + 1}`
    errorServers.push({ id, provider: body.provider, providerName: body.provider === 'bugsink' ? 'Bugsink' : 'GlitchTip', name: body.name || new URL(body.url).host, url: body.url, apiUrl: '', org: body.org || '', hasToken: Boolean(body.token), builtIn: false })
    return { id, servers: errorServers }
  }],
  ['POST', /^\/admin\/errors\/connect$/, ({ body }) => {
    const p = find(projects, body.project, 'Project')
    p.errors = errorServers.find(server => server.id === body.server)?.provider === 'bugsink'
      ? { connected: true, provider: 'bugsink', providerName: 'Bugsink', dsn: 'https://public@example.bugsink.com/42', url: 'https://example.bugsink.com/issues/42/', alertWebhookUrl: `https://help.example.com/v1/webhooks/bugsink/${p.id}?token=demo` }
      : { connected: true, provider: 'glitchtip', providerName: 'GlitchTip', dsn: 'https://public@example.glitchtip.com/42', url: 'https://example.glitchtip.com/helpbites/issues', alertWebhookUrl: '' }
    return { project: p }
  }],
  ['GET', /^\/admin\/errors$/, ({ query }) => ({ issues: errorIssues.filter(issue => !query.status || issue.status === query.status), next: '' })],
  ['PUT', /^\/admin\/errors\/([^/]+)$/, ({ params, body }) => {
    const issue = errorIssues.find(item => item.id === params[0]) || fail(404, 'Error not found')
    issue.status = body.status === 'open' ? 'unresolved' : body.status === 'closed' ? 'ignored' : 'resolved'
    return { conversation: null }
  }],

  // inbox
  ['GET', /^\/admin\/conversations$/, ({ query }) => {
    const q = (query.q || '').toLowerCase()
    const scoped = conversations.filter(c => !query.project || c.projectId === query.project)
    const rows = scoped
      .filter(c => (!query.status || c.status === query.status) && (!query.priority || c.priority === query.priority) && (!query.type || c.type === query.type) && (!query.endUser || c.endUserId === query.endUser))
      .filter(c => !q || Object.values(userOf(c)).some(v => v.toLowerCase().includes(q)))
      .sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)))
    const counts = { status: {} as Record<string, number>, type: {} as Record<string, number>, assignee: {} as Record<string, number> }
    for (const c of scoped) for (const [bucket, key] of [['status', c.status], ['type', c.type], ['assignee', c.assigneeId || 'unassigned']] as const) counts[bucket][key] = (counts[bucket][key] || 0) + 1
    return {
      conversations: rows,
      endUsers: Object.fromEntries(rows.map(c => [c.endUserId, serializeUser(userOf(c))])),
      hasMore: false,
      totalUnread: conversations.reduce((sum, c) => sum + c.unreadByAgent, 0),
      counts
    }
  }],
  ['POST', /^\/admin\/conversations$/, ({ body }) => {
    const p = find(projects, body.projectId, 'Project')
    let user = endUsers.find(u => u.projectId === p.id && u.externalId === body.externalId)
    if (!user) endUsers.push(user = { id: newId('user'), projectId: p.id, externalId: String(body.externalId || newId('ext')), name: String(body.name || ''), email: String(body.email || '') })
    const status = supportType(p.id).statuses[0]!
    const conversation: Conversation = {
      id: newId('conv'), projectId: p.id, endUserId: user.id, assistantId: '', subject: String(body.subject || ''), status: status.key, statusCategory: status.category, type: 'support', priority: 'normal',
      assigneeId: ME.id, assignedAt: now(), tags: [], fields: {}, subjectRef: null, reopenedAt: null, closedAt: null, doneAt: null, context: null,
      lastMessageAt: null, lastMessagePreview: '', lastMessageFrom: '', unreadByAgent: 0, unreadByUser: 1, userReadAt: null, agentReadAt: now(), createdAt: now()
    }
    conversations.push(conversation)
    messages.push(message(conversation.id, 'agent', p.fromName, String(body.body || ''), now()))
    summarize(conversation)
    return { conversation }
  }],
  ['GET', /^\/admin\/conversations\/([^/]+)$/, ({ params }) => {
    const c = find(conversations, params[0], 'Conversation')
    return { conversation: c, endUser: serializeUser(userOf(c)), project: projects.find(p => p.id === c.projectId) }
  }],
  ['PATCH', /^\/admin\/conversations\/([^/]+)$/, ({ params, body }) => {
    const c = find(conversations, params[0], 'Conversation')
    if (typeof body.status === 'string') setStatus(c, body.status)
    if (typeof body.priority === 'string') c.priority = body.priority
    if (Array.isArray(body.tags)) c.tags = body.tags.map((t: string) => String(t).toLowerCase())
    if ('assigneeId' in body) { c.assigneeId = String(body.assigneeId || ''); c.assignedAt = c.assigneeId ? now() : null }
    if (body.fields && typeof body.fields === 'object') c.fields = { ...c.fields, ...body.fields }
    return { conversation: c }
  }],
  ['GET', /^\/admin\/conversations\/([^/]+)\/messages$/, ({ params }) => ({ messages: messages.filter(m => m.conversationId === params[0]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) })],
  ['POST', /^\/admin\/conversations\/([^/]+)\/messages$/, ({ params, body }) => {
    const c = find(conversations, params[0], 'Conversation')
    const m = message(c.id, 'agent', projects.find(p => p.id === c.projectId)?.fromName || ME.name, String(body.body || ''), now(), { replyToId: body.replyToId || '', clientId: body.clientId || '', attachments: body.attachments || [] })
    messages.push(m)
    c.unreadByUser += 1
    summarize(c)
    return { message: m, conversation: c, emailSent: false, emailError: '' }
  }],
  ['POST', /^\/admin\/conversations\/([^/]+)\/read$/, ({ params, body }) => {
    const c = find(conversations, params[0], 'Conversation')
    const read = body.read !== false
    c.unreadByAgent = read ? 0 : Math.max(1, c.unreadByAgent)
    c.agentReadAt = read ? now() : null
    return { conversation: c }
  }],
  ['POST', /^\/admin\/conversations\/([^/]+)\/status$/, ({ params, body }) => {
    const c = find(conversations, params[0], 'Conversation')
    setStatus(c, String(body.status || ''))
    return { conversation: c }
  }],
  ['POST', /^\/admin\/conversations\/([^/]+)\/notes$/, ({ params, body }) => {
    const c = find(conversations, params[0], 'Conversation')
    if (!String(body.body || '').trim()) fail(400, 'Note body is required')
    const m = message(c.id, 'agent', ME.name, String(body.body), now(), { visibility: 'internal' })
    messages.push(m)
    return { message: m }
  }],
  ['POST', /^\/admin\/conversations\/([^/]+)\/actions\/([^/]+)$/, ({ params }) => {
    const c = find(conversations, params[0], 'Conversation')
    const action = typeOf(c).actions.find(a => a.key === params[1]) || fail(404, 'Action not found')
    if (action.statusAfter) setStatus(c, action.statusAfter)
    const event = message(c.id, 'agent', 'System', '', now(), { visibility: 'internal', kind: 'event', event: { type: 'action.performed', actionKey: action.label, result: 'done (demo)', byName: ME.name } })
    messages.push(event)
    return { conversation: c, event }
  }],
  ['DELETE', /^\/admin\/messages\/([^/]+)$/, ({ params }) => {
    const m = find(messages, params[0], 'Message')
    messages.splice(messages.indexOf(m), 1)
    summarize(find(conversations, m.conversationId, 'Conversation'))
    return { deleted: true }
  }],
  ['POST', /^\/admin\/messages\/([^/]+)\/reactions$/, ({ params, body }) => {
    const m = find(messages, params[0], 'Message')
    m.reactions = toggleReactions(m.reactions, body.emoji as MessageReactionEmoji, { actor: `agent:${ME.id}`, side: 'agent', actorName: ME.name }, now())
    return { message: m }
  }],
  ['GET', /^\/admin\/end-users$/, ({ query }) => {
    const q = (query.q || '').toLowerCase()
    return { endUsers: endUsers.filter(u => (!query.project || u.projectId === query.project) && (!q || [u.name, u.email, u.externalId].some(v => v.toLowerCase().includes(q)))) }
  }],

  // email templates
  ['GET', /^\/admin\/emails$/, ({ query }) => ({ templates: emails.filter(t => t.projectId === (query.project || null)).map(withMaster), usage: {} })],
  ['POST', /^\/admin\/emails$/, ({ body }) => {
    const projectId = body.project || null
    let template: EmailTemplate
    if (body.master) {
      const master = find(emails, body.master, 'Template')
      template = emailTemplate(projectId, master.name, null, { masterId: master.id })
    } else {
      const document: EmailDocument = body.document || (body.starterId && cloneEmailTemplateDocument(body.starterId)) || cloneBlankEmailDocument()
      template = emailTemplate(projectId, String(body.name || document.settings?.title || 'Untitled email'), document, { variables: variablesOf(document, body.variables) })
    }
    template.folderId = body.folder || null
    emails.push(template)
    return { template: withMaster(template) }
  }],
  ['GET', /^\/admin\/emails\/([^/]+)$/, ({ params }) => ({ template: withMaster(find(emails, params[0], 'Template')) })],
  ['PATCH', /^\/admin\/emails\/([^/]+)$/, ({ params, body }) => {
    const t = find(emails, params[0], 'Template')
    for (const key of ['name', 'key', 'description', 'variableValues'] as const) if (body[key] !== undefined) (t as any)[key] = body[key]
    if ('folder' in body) t.folderId = body.folder || null
    if (body.document) t.document = body.document
    if (t.document && (body.document || body.variables)) t.variables = variablesOf(t.document, body.variables || t.variables)
    t.lastActorId = body.actorId || null
    t.updatedAt = Date.now()
    return { template: withMaster(t) }
  }],
  ['DELETE', /^\/admin\/emails\/([^/]+)$/, ({ params }) => {
    const t = find(emails, params[0], 'Template')
    emails.splice(emails.indexOf(t), 1)
    return { deleted: true }
  }],
  ['POST', /^\/admin\/emails\/([^/]+)\/duplicate$/, ({ params }) => {
    const t = find(emails, params[0], 'Template')
    const copy = { ...wire(t), id: newId('email'), name: `${t.name} copy`, key: `${t.key}-copy`, updatedAt: Date.now() }
    emails.push(copy)
    return { template: withMaster(copy) }
  }],
  ['POST', /^\/admin\/emails\/([^/]+)\/detach$/, ({ params }) => {
    const t = find(emails, params[0], 'Template')
    const master = withMaster(t).master
    Object.assign(t, { masterId: null, document: wire(master?.document) || cloneBlankEmailDocument(), variables: master?.variables || [] })
    return { template: withMaster(t) }
  }],
  ['GET', /^\/admin\/emails\/([^/]+)\/chat$/, () => ({ messages: [] })],
  ['GET', /^\/admin\/email-folders$/, ({ query }) => ({ folders: folders.filter(f => f.projectId === (query.project || null)) })],
  ['POST', /^\/admin\/email-folders$/, ({ body }) => {
    const folder = { id: newId('folder'), projectId: body.project || null, parentId: body.parent || null, name: String(body.name || 'Folder') }
    folders.push(folder)
    return { folder }
  }],
  ['PATCH', /^\/admin\/email-folders\/([^/]+)$/, ({ params, body }) => {
    const folder = find(folders, params[0], 'Folder')
    if (body.name) folder.name = String(body.name)
    return { folder }
  }],
  ['DELETE', /^\/admin\/email-folders\/([^/]+)$/, ({ params }) => {
    const folder = find(folders, params[0], 'Folder')
    for (const f of folders) if (f.parentId === folder.id) f.parentId = folder.parentId
    for (const t of emails) if (t.folderId === folder.id) t.folderId = folder.parentId
    folders.splice(folders.indexOf(folder), 1)
    return { deleted: true }
  }],

  // the component library, empty until something is saved
  ['GET', /^\/admin\/email-components$/, ({ query }) => ({ components: components.filter(c => !c.projectId || c.projectId === query.project) })],
  ['POST', /^\/admin\/email-components$/, ({ body }) => {
    const checked = normalizeComponentInput(body)
    if (!checked.ok) fail(400, checked.error)
    const component = { ...checked.value, id: newId('component'), projectId: body.project || null, updatedAt: new Date().toISOString() }
    components.push(component)
    return { component }
  }],
  ['PATCH', /^\/admin\/email-components\/([^/]+)$/, ({ params, body }) => {
    const component = find(components, params[0], 'Component')
    const checked = normalizeComponentInput({ ...component, ...body })
    if (!checked.ok) fail(400, checked.error)
    Object.assign(component, checked.value, 'project' in body ? { projectId: body.project || null } : {}, { updatedAt: new Date().toISOString() })
    return { component }
  }],
  ['DELETE', /^\/admin\/email-components\/([^/]+)$/, ({ params }) => {
    components.splice(components.indexOf(find(components, params[0], 'Component')), 1)
    return { ok: true }
  }],

  // email log and suppressions
  ['GET', /^\/admin\/email-logs$/, ({ query }) => ({
    logs: emailLogs.filter(l => (!query.project || l.projectId === query.project) && (!query.status || l.status === query.status) && (!query.source || l.source === query.source) && (!query.batch || l.batchId === query.batch) && (!query.template || l.template?.key === query.template) && (!query.to || l.to.startsWith(query.to.toLowerCase()))),
    nextBefore: null
  })],
  ['GET', /^\/admin\/email-logs\/stats$/, ({ query }) => {
    const scoped = emailLogs.filter(l => !query.project || l.projectId === query.project)
    const byStatus: Record<string, number> = {}
    for (const l of scoped) byStatus[l.status] = (byStatus[l.status] || 0) + 1
    return { days: 30, since: ago(60 * 24 * 30), total: scoped.length, byStatus, bySource: {}, byDay: [], topTemplates: topKeys(scoped), truncated: false }
  }],
  ['GET', /^\/admin\/email-logs\/([^/]+)$/, ({ params }) => ({ log: find(emailLogs, params[0], 'Entry') })],
  ['GET', /^\/admin\/email-settings$/, () => ({ configured: true, provider: 'mailgun', domain: 'mail.acme.app', fromEmail: 'hello@mail.acme.app', apiBaseUrl: 'https://api.eu.mailgun.net', webhook: { configured: true, url: 'https://help.example.com/v1/webhooks/mailgun' }, retentionDays: 180 })],
  ['GET', /^\/admin\/email-suppressions$/, ({ query }) => ({ suppressions: emailSuppressions.filter(r => (!query.project || r.projectId === query.project) && (!query.reason || r.reason === query.reason) && (!query.q || r.email.startsWith(query.q.toLowerCase()))), nextBefore: null })],
  ['DELETE', /^\/admin\/email-suppressions\/([^/]+)$/, ({ params }) => {
    const row = find(emailSuppressions, params[0], 'Suppression')
    emailSuppressions.splice(emailSuppressions.indexOf(row), 1)
    return { ok: true }
  }],

  // feedback board settings; the board itself starts empty in the demo
  ['GET', /^\/feedback\/config$/, ({ query }) => ({ config: find(projects, query.project, 'Project').feedback })],
  ['GET', /^\/feedback$/, () => ({ posts: [] })],
  // the project board starts empty too; creating items is not in the demo
  ['GET', /^\/admin\/board-items$/, ({ query }) => { find(projects, query.project, 'Project'); return { items: [] } }],
  // the changelog starts empty too
  ['GET', /^\/admin\/changelog\/entries$/, ({ query }) => { find(projects, query.project, 'Project'); return { entries: [] } }],
  ['GET', /^\/admin\/changelog\/releases$/, ({ query }) => { find(projects, query.project, 'Project'); return { releases: [] } }],
  ['GET', /^\/feedback\/roadmap$/, ({ query }) => {
    const { board } = find(projects, query.project, 'Project')
    return { options: board.roadmap, statuses: board.statuses.filter(s => ROADMAP_CATEGORIES.includes(s.category)), items: [] }
  }],

  // contacts: the demo's end users, seen as the CRM sees them
  ['GET', /^\/contacts$/, ({ query }) => {
    const q = (query.q || '').toLowerCase()
    const rows = endUsers.filter(u => u.projectId === query.project && (!q || [u.name, u.email, u.externalId].some(v => v.toLowerCase().includes(q)))).map(asContact)
    return { contacts: rows.filter(c => !query.subscription || c.subscription === query.subscription), nextCursor: null }
  }],
  ['GET', /^\/contacts\/([^/]+)$/, ({ params }) => ({ contact: asContact(find(endUsers, params[0], 'Contact')) })],
  ['PATCH', /^\/contacts\/([^/]+)$/, ({ params, body }) => {
    const user = find(endUsers, params[0], 'Contact')
    if (typeof body.name === 'string') user.name = body.name
    contactExtras[user.id] = { ...contactExtras[user.id], ...(body.tags ? { tags: body.tags } : {}), ...(body.subscription ? { subscription: body.subscription } : {}) }
    return { contact: asContact(user) }
  }],
  ['GET', /^\/segments$/, ({ query }) => ({ segments: segments.filter(s => s.projectId === query.project) })],
  ['POST', /^\/segments$/, ({ body }) => {
    const segment = { id: newId('seg'), projectId: String(body.project), name: String(body.name || 'Segment'), filter: body.filter || { match: 'all', rules: [] }, createdAt: now(), updatedAt: now() }
    segments.push(segment)
    return { segment }
  }],
  ['PATCH', /^\/segments\/([^/]+)$/, ({ params, body }) => {
    const segment = find(segments, params[0], 'Segment')
    Object.assign(segment, body.name ? { name: body.name } : {}, body.filter ? { filter: body.filter } : {}, { updatedAt: now() })
    return { segment }
  }],
  ['DELETE', /^\/segments\/([^/]+)$/, ({ params }) => {
    segments.splice(segments.indexOf(find(segments, params[0], 'Segment')), 1)
    return { deleted: true }
  }],
  // The demo does not evaluate rules: every segment is the whole project.
  ['POST', /^\/segments\/preview$/, ({ body }) => {
    const rows = endUsers.filter(u => u.projectId === body.project).map(asContact)
    return { count: rows.length, sample: rows.slice(0, 10) }
  }],

  ['GET', /^\/admin\/contact-sources$/, () => ({ sources: [], kinds: [{ kind: 'parse', label: 'Parse Server' }, { kind: 'postgres', label: 'Postgres / Supabase' }, { kind: 'firestore', label: 'Firebase / Firestore' }], ready: true })],

  // campaigns and sequences start empty: sending is not in the demo
  ['GET', /^\/campaigns$/, ({ query }) => ({ campaigns: demoCampaigns.filter(c => c.projectId === query.project) })],
  ['GET', /^\/campaigns\/([^/]+)$/, ({ params }) => ({ campaign: find(demoCampaigns, params[0], 'Campaign'), audienceCount: null, problems: [] })],
  ['GET', /^\/sequences$/, () => ({ sequences: [] })],

  // sections the demo leaves empty: their pages show their own empty states
  ['GET', /^\/admin\/support-agents$/, () => ({ agents: [] })],
  ['GET', /^\/admin\/knowledge\/models$/, () => ({ models: [] })],
  ['GET', /^\/admin\/api-keys$/, () => ({ keys: [] })]
]

export async function demoApi<T>(path: string, options: { method?: string, body?: unknown, query?: Record<string, unknown> } = {}): Promise<T> {
  const [pathname = '', search = ''] = path.split('?')
  const method = options.method || 'GET'
  const query: Record<string, string> = Object.fromEntries(new URLSearchParams(search))
  for (const [key, value] of Object.entries(options.query || {})) if (value !== undefined && value !== null && value !== '') query[key] = String(value)
  // A beat of latency so loading states look the way they do for real.
  await new Promise(resolve => setTimeout(resolve, 120))
  for (const [m, pattern, handler] of routes) {
    const match = m === method && pathname.match(pattern)
    if (match) return wire(handler({ params: match.slice(1), query, body: wire(options.body) || {} })) as T
  }
  fail(403, NOT_IN_DEMO)
}
