import { createHmac, timingSafeEqual } from 'node:crypto'
import { createError } from 'h3'
import { iso, pointerId } from './parse'
import { isProbablyEmail } from './projects'
import { unsubscribeContactByEmail } from './contacts'
import { emitWebhooks } from './webhooks'

// Reading the send history, keeping it current from Mailgun's delivery
// webhooks, and the per-project list of addresses that are no longer mailed
// (hard bounces, spam complaints, unsubscribes, or added by hand).

export type EmailLogStatus = 'scheduled' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'unsubscribed' | 'bounced' | 'complained' | 'failed' | 'suppressed'
export const EMAIL_LOG_STATUSES: EmailLogStatus[] = ['scheduled', 'sent', 'delivered', 'opened', 'clicked', 'unsubscribed', 'bounced', 'complained', 'failed', 'suppressed']
/** Campaign, sequence and lead form welcome mail: its unsubscribes are a contact's, not the address's. */
export function isMarketingSource(source: unknown): boolean {
  return source === 'campaign' || source === 'sequence' || source === 'form'
}

export const EMAIL_LOG_SOURCES = ['api', 'admin', 'test', 'notification', 'feedback', 'system', 'campaign', 'sequence', 'form'] as const
export type EmailSuppressionReason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual'
export const EMAIL_SUPPRESSION_REASONS: EmailSuppressionReason[] = ['bounce', 'complaint', 'unsubscribe', 'manual']

export type EmailLogEvent = { type: string, at: string, detail: string }

export type EmailLogEntry = {
  id: string
  projectId: string | null
  batchId: string
  source: string
  kind: string
  template: { id: string | null, key: string, name: string } | null
  to: string
  toName: string
  cc: string[]
  bcc: string[]
  from: string
  replyTo: string
  subject: string
  status: EmailLogStatus
  error: string
  messageId: string
  tags: string[]
  metadata: Record<string, string>
  variables: { key: string, value: string }[]
  attachments: { filename: string, contentType: string, size: number, inline: boolean }[]
  headers: string[]
  events: EmailLogEvent[]
  scheduledAt: string | null
  testMode: boolean
  idempotencyKey: string
  actor: { type: string, id: string, name: string }
  ip: string
  userAgent: string
  durationMs: number
  hasContent: boolean
  /** Only on a single entry, and only when the project keeps message content. */
  html?: string
  text?: string
  createdAt: string | null
  updatedAt: string | null
}

export type EmailSuppression = { id: string, projectId: string | null, email: string, reason: EmailSuppressionReason, detail: string, source: string, createdAt: string | null }

const LIST_FIELDS = ['project', 'template', 'templateKey', 'templateName', 'batchId', 'source', 'kind', 'to', 'toName', 'cc', 'bcc', 'from', 'replyTo', 'subject', 'status', 'error', 'messageId', 'tags', 'metadata', 'variables', 'attachments', 'headerNames', 'events', 'scheduledAt', 'testMode', 'idempotencyKey', 'actorType', 'actorId', 'actorName', 'ip', 'userAgent', 'durationMs', 'hasContent']

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(v => String(v ?? '')) : [])

export function serializeEmailLog(row: ParseObject, options: { content?: boolean } = {}): EmailLogEntry {
  const templateKey = String(row.get('templateKey') || '')
  const templateName = String(row.get('templateName') || '')
  const templateId = pointerId(row.get('template')) || null
  const html = row.get('html') as string | undefined
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')) || null,
    batchId: String(row.get('batchId') || ''),
    source: String(row.get('source') || ''),
    kind: String(row.get('kind') || ''),
    // Built-in emails (notifications, resets) carry a name but no template.
    template: templateId || templateKey || templateName ? { id: templateId, key: templateKey, name: templateName } : null,
    to: String(row.get('to') || ''),
    toName: String(row.get('toName') || ''),
    cc: strings(row.get('cc')),
    bcc: strings(row.get('bcc')),
    from: String(row.get('from') || ''),
    replyTo: String(row.get('replyTo') || ''),
    subject: String(row.get('subject') || ''),
    status: (row.get('status') as EmailLogStatus) || 'sent',
    error: String(row.get('error') || ''),
    messageId: String(row.get('messageId') || ''),
    tags: strings(row.get('tags')),
    metadata: (row.get('metadata') as Record<string, string>) || {},
    variables: Array.isArray(row.get('variables')) ? row.get('variables') : [],
    attachments: Array.isArray(row.get('attachments')) ? row.get('attachments') : [],
    headers: strings(row.get('headerNames')),
    events: Array.isArray(row.get('events')) ? row.get('events') : [],
    scheduledAt: iso(row.get('scheduledAt')),
    testMode: row.get('testMode') === true,
    idempotencyKey: String(row.get('idempotencyKey') || ''),
    actor: { type: String(row.get('actorType') || ''), id: String(row.get('actorId') || ''), name: String(row.get('actorName') || '') },
    ip: String(row.get('ip') || ''),
    userAgent: String(row.get('userAgent') || ''),
    durationMs: Number(row.get('durationMs') || 0),
    hasContent: row.get('hasContent') === true,
    ...(options.content && typeof html === 'string' ? { html, text: String(row.get('text') || '') } : {}),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  }
}

// ---- listing -------------------------------------------------------------------

export type EmailLogFilters = {
  status?: EmailLogStatus
  source?: string
  kind?: string
  /** A send key, or a template id. */
  template?: string
  /** An exact address, or the start of one. */
  to?: string
  batchId?: string
  since?: Date
  until?: Date
  /** Page cursor: entries created before this instant. */
  before?: Date
  limit: number
}

function dateParam(value: unknown, name: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw createError({ statusCode: 400, statusMessage: `${name} must be an ISO date` })
  return date
}

/** Query string → filters. A bad status or date is refused rather than silently ignored. */
export function readEmailLogQuery(query: Record<string, unknown>): EmailLogFilters {
  const one = (key: string) => (Array.isArray(query[key]) ? String((query[key] as unknown[])[0] ?? '') : String(query[key] ?? '')).trim()
  const status = one('status')
  if (status && !EMAIL_LOG_STATUSES.includes(status as EmailLogStatus)) throw createError({ statusCode: 400, statusMessage: `status must be one of ${EMAIL_LOG_STATUSES.join(', ')}` })
  const limit = Math.min(Math.max(Number.parseInt(one('limit') || '50', 10) || 50, 1), 200)
  return {
    ...(status ? { status: status as EmailLogStatus } : {}),
    ...(one('source') ? { source: one('source') } : {}),
    ...(one('kind') ? { kind: one('kind') } : {}),
    ...(one('template') ? { template: one('template') } : {}),
    ...(one('to') || one('q') ? { to: (one('to') || one('q')).toLowerCase() } : {}),
    ...(one('batch') ? { batchId: one('batch') } : {}),
    since: dateParam(one('since'), 'since'),
    until: dateParam(one('until'), 'until'),
    before: dateParam(one('before'), 'before'),
    limit
  }
}

/**
 * Whose mail: one project's, or a workspace's (its projects' plus what it
 * sent without a project). Never everyone's.
 */
export type EmailLogScope = { project: ParseObject } | { workspace?: ParseObject, projects: ParseObject[] }

function scopedLogQuery(scope: EmailLogScope) {
  const Parse = useParse()
  if ('project' in scope) return new Parse.Query('EmailLog').equalTo('project', scope.project)
  const ofProjects = new Parse.Query('EmailLog').containedIn('project', scope.projects)
  return scope.workspace ? Parse.Query.or(ofProjects, new Parse.Query('EmailLog').equalTo('workspace', scope.workspace)) : ofProjects
}

export async function listEmailLogs(scope: EmailLogScope, filters: EmailLogFilters): Promise<{ logs: EmailLogEntry[], nextBefore: string | null }> {
  const Parse = useParse()
  let query = scopedLogQuery(scope)
  if (filters.template) {
    // A send key, or (10 characters, letters and digits) possibly a template id.
    const byKey = new Parse.Query('EmailLog').equalTo('templateKey', filters.template)
    const byTemplate = /^[A-Za-z0-9]{10}$/.test(filters.template)
      ? Parse.Query.or(byKey, new Parse.Query('EmailLog').equalTo('template', Parse.Object.extend('EmailTemplate').createWithoutData(filters.template)))
      : byKey
    query = Parse.Query.and(query, byTemplate)
  }
  query.descending('createdAt').limit(filters.limit + 1).select(...LIST_FIELDS)
  if (filters.status) query.equalTo('status', filters.status)
  if (filters.source) query.equalTo('source', filters.source)
  if (filters.kind) query.equalTo('kind', filters.kind)
  if (filters.batchId) query.equalTo('batchId', filters.batchId)
  if (filters.to) {
    if (filters.to.includes('@')) query.equalTo('to', filters.to)
    else query.startsWith('to', filters.to)
  }
  if (filters.since) query.greaterThanOrEqualTo('createdAt', filters.since)
  // One upper bound: a second lessThan on the same field would replace the first.
  const upper = [filters.until, filters.before].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0]
  if (upper) query.lessThan('createdAt', upper)
  const rows = await query.find(MASTER)
  const page = rows.slice(0, filters.limit)
  return {
    logs: page.map(row => serializeEmailLog(row)),
    nextBefore: rows.length > filters.limit ? iso(page.at(-1)?.createdAt) : null
  }
}

export async function getEmailLog(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('EmailLog').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Email log entry not found' })
  }
}

export type EmailLogStats = {
  days: number
  since: string
  total: number
  byStatus: Record<string, number>
  bySource: Record<string, number>
  byDay: { date: string, total: number, sent: number, failed: number }[]
  topTemplates: { key: string, name: string, count: number }[]
  /** True when the window held more rows than were counted. */
  truncated: boolean
}

const STATS_ROW_CAP = 50_000
export const FAILED_STATUSES = new Set(['failed', 'bounced', 'complained', 'suppressed'])

/** Counts over the last `days`, grouped in memory: a few fields per row, capped. */
export async function emailLogStats(scope: EmailLogScope, days: number): Promise<EmailLogStats> {
  const Parse = useParse()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  since.setUTCHours(0, 0, 0, 0)
  const rows: ParseObject[] = []
  let before: Date | undefined
  while (rows.length < STATS_ROW_CAP) {
    const query = scopedLogQuery(scope).greaterThanOrEqualTo('createdAt', since).descending('createdAt').select('status', 'source', 'templateKey', 'templateName').limit(1000)
    if (before) query.lessThan('createdAt', before)
    const page = await query.find(MASTER)
    rows.push(...page)
    if (page.length < 1000) break
    before = page.at(-1)!.createdAt
  }

  const byStatus: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  const templates = new Map<string, { key: string, name: string, count: number }>()
  const byDay = new Map<string, { date: string, total: number, sent: number, failed: number }>()
  for (let d = 0; d <= days; d++) {
    const date = new Date(since.getTime() + d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    byDay.set(date, { date, total: 0, sent: 0, failed: 0 })
  }
  for (const row of rows) {
    const status = String(row.get('status') || 'sent')
    byStatus[status] = (byStatus[status] || 0) + 1
    const source = String(row.get('source') || 'api')
    bySource[source] = (bySource[source] || 0) + 1
    const key = String(row.get('templateKey') || '')
    if (key) {
      const t = templates.get(key) || { key, name: String(row.get('templateName') || key), count: 0 }
      t.count++
      templates.set(key, t)
    }
    const day = byDay.get(row.createdAt!.toISOString().slice(0, 10))
    if (day) {
      day.total++
      if (FAILED_STATUSES.has(status)) day.failed++
      else day.sent++
    }
  }
  return {
    days,
    since: since.toISOString(),
    total: rows.length,
    byStatus,
    bySource,
    byDay: [...byDay.values()],
    topTemplates: [...templates.values()].sort((a, b) => b.count - a.count).slice(0, 50),
    truncated: rows.length >= STATS_ROW_CAP
  }
}

/**
 * Delete entries created before `before`, a batch at a time: one project's or
 * one workspace's, or (no scope: the retention job) everyone's.
 */
export async function purgeEmailLogs(options: { scope?: EmailLogScope, before: Date, max?: number }): Promise<number> {
  const Parse = useParse()
  const max = options.max ?? 20_000
  let deleted = 0
  while (deleted < max) {
    // Select one small field: a row can carry a copy of the whole message.
    const query = (options.scope ? scopedLogQuery(options.scope) : new Parse.Query('EmailLog')).lessThan('createdAt', options.before).select('status').limit(Math.min(500, max - deleted))
    const rows = await query.find(MASTER)
    if (!rows.length) break
    await Parse.Object.destroyAll(rows, MASTER)
    deleted += rows.length
  }
  return deleted
}

/** Days of history to keep (EMAIL_LOG_RETENTION_DAYS, default 180); 0 keeps everything. */
export function emailLogRetentionDays(): number {
  const raw = process.env.EMAIL_LOG_RETENTION_DAYS
  if (raw === undefined || raw.trim() === '') return 180
  const days = Number.parseInt(raw, 10)
  return Number.isFinite(days) && days > 0 ? days : 0
}

// ---- suppressions ----------------------------------------------------------------

export function serializeEmailSuppression(row: ParseObject): EmailSuppression {
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')) || null,
    email: String(row.get('email') || ''),
    reason: (row.get('reason') as EmailSuppressionReason) || 'manual',
    detail: String(row.get('detail') || ''),
    source: String(row.get('source') || ''),
    createdAt: iso(row.createdAt)
  }
}

/** Which of these addresses the project no longer mails, with the reason. */
export async function suppressedEmails(project: ParseObject, emails: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  // In batches: a big send can match more rows than one query returns, and a missed one is mail to someone who opted out.
  await eachBatch(() => new (useParse()).Query('EmailSuppression').equalTo('project', project).containedIn('email', unique), (rows) => {
    for (const row of rows) out.set(String(row.get('email')), String(row.get('reason') || 'manual'))
  }, { keys: ['email', 'reason'] })
  return out
}

/** Add addresses (existing ones keep their first reason). Returns how many were new. */
export async function addEmailSuppressions(project: ParseObject, entries: { email: string, reason: EmailSuppressionReason, detail?: string, source: string }[]): Promise<{ added: EmailSuppression[], existing: number }> {
  const Parse = useParse()
  const wanted = new Map<string, (typeof entries)[number]>()
  for (const entry of entries) {
    const email = entry.email.trim().toLowerCase()
    if (isProbablyEmail(email) && !wanted.has(email)) wanted.set(email, { ...entry, email })
  }
  const known = await suppressedEmails(project, [...wanted.keys()])
  const rows = [...wanted.values()].filter(e => !known.has(e.email)).map((entry) => {
    const row = new (Parse.Object.extend('EmailSuppression'))()
    row.set('project', project)
    row.set('email', entry.email)
    row.set('reason', entry.reason)
    row.set('detail', String(entry.detail || '').slice(0, 500))
    row.set('source', entry.source)
    return row
  })
  if (rows.length) await Parse.Object.saveAll(rows, MASTER)
  return { added: rows.map(serializeEmailSuppression), existing: wanted.size - rows.length }
}

/** One project's suppressions, or every project's in a workspace (`projects`). */
export async function listEmailSuppressions(scope: ParseObject | ParseObject[], options: { q?: string, reason?: string, limit?: number, before?: Date } = {}): Promise<{ suppressions: EmailSuppression[], nextBefore: string | null }> {
  const limit = Math.min(Math.max(options.limit || 100, 1), 500)
  const query = new (useParse()).Query('EmailSuppression').descending('createdAt').limit(limit + 1)
  if (Array.isArray(scope)) query.containedIn('project', scope)
  else query.equalTo('project', scope)
  if (options.q) query.startsWith('email', options.q.trim().toLowerCase())
  if (options.reason) query.equalTo('reason', options.reason)
  if (options.before) query.lessThan('createdAt', options.before)
  const rows = await query.find(MASTER)
  const page = rows.slice(0, limit)
  return { suppressions: page.map(serializeEmailSuppression), nextBefore: rows.length > limit ? iso(page.at(-1)?.createdAt) : null }
}

/** Mail this address again. False when it was not on the list. */
export async function removeEmailSuppression(project: ParseObject, email: string): Promise<boolean> {
  const rows = await new (useParse()).Query('EmailSuppression').equalTo('project', project).equalTo('email', email.trim().toLowerCase()).limit(10).find(MASTER)
  if (!rows.length) return false
  await useParse().Object.destroyAll(rows, MASTER)
  return true
}

/** Read `{ emails, reason?, detail? }`: a list or a comma/newline separated string. */
export function readSuppressionInput(body: Record<string, unknown>, allowed: EmailSuppressionReason[] = EMAIL_SUPPRESSION_REASONS): { emails: string[], reason: EmailSuppressionReason, detail: string } {
  const raw = body.emails ?? body.email
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;]+/)).map(v => String(v || '').trim().toLowerCase()).filter(Boolean)
  if (!list.length) throw createError({ statusCode: 400, statusMessage: 'Pass "emails": one address or a list' })
  if (list.length > 1000) throw createError({ statusCode: 400, statusMessage: 'At most 1000 addresses per request' })
  const invalid = list.find(e => !isProbablyEmail(e))
  if (invalid) throw createError({ statusCode: 400, statusMessage: `"${invalid.slice(0, 100)}" is not an email address` })
  const reason = String(body.reason || 'manual') as EmailSuppressionReason
  if (!allowed.includes(reason)) throw createError({ statusCode: 400, statusMessage: `reason must be one of ${allowed.join(', ')}` })
  return { emails: [...new Set(list)], reason, detail: String(body.detail || '').trim().slice(0, 500) }
}

// ---- Mailgun delivery webhooks -------------------------------------------------------

export type MailgunSignature = { timestamp?: string | number, token?: string, signature?: string }

/** Mailgun signs `timestamp + token` with the webhook signing key (HMAC-SHA256, hex). */
export function verifyMailgunSignature(sig: MailgunSignature | undefined, key: string): boolean {
  if (!key || !sig?.timestamp || !sig.token || !sig.signature) return false
  const expected = Buffer.from(createHmac('sha256', key).update(`${sig.timestamp}${sig.token}`).digest('hex'))
  const given = Buffer.from(String(sig.signature))
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export type MailgunEventUpdate = {
  /** The status this event moves the entry to, or null to only record it. */
  status: EmailLogStatus | null
  event: EmailLogEvent
  suppress?: { reason: EmailSuppressionReason, detail: string }
}

// A later event never moves an entry backwards: an open that arrives before
// its delivery report still leaves the entry "opened".
const STATUS_RANK: Record<EmailLogStatus, number> = { scheduled: 1, sent: 2, delivered: 3, opened: 4, clicked: 5, unsubscribed: 6, bounced: 7, complained: 8, failed: 9, suppressed: 9 }

export function statusAfter(current: EmailLogStatus, next: EmailLogStatus | null): EmailLogStatus {
  if (!next) return current
  return (STATUS_RANK[next] || 0) > (STATUS_RANK[current] || 0) ? next : current
}

/** What one Mailgun event means for the log. Null for events HelpBites does not track. */
export function mailgunEventUpdate(data: Record<string, any>): MailgunEventUpdate | null {
  const type = String(data?.event || '')
  const at = new Date(Number(data?.timestamp) * 1000 || Date.now()).toISOString()
  const status = data?.['delivery-status'] || {}
  const delivery = String(status.description || status.message || data?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  switch (type) {
    case 'delivered':
      return { status: 'delivered', event: { type, at, detail: delivery } }
    case 'opened': {
      const client = data?.['client-info'] || {}
      return { status: 'opened', event: { type, at, detail: [client['client-name'], client['device-type']].filter(Boolean).join(' · ') } }
    }
    case 'clicked':
      return { status: 'clicked', event: { type, at, detail: String(data?.url || '').slice(0, 300) } }
    case 'failed':
      if (data?.severity === 'permanent') {
        return { status: 'bounced', event: { type: 'bounced', at, detail: delivery }, suppress: { reason: 'bounce', detail: delivery } }
      }
      return { status: null, event: { type: 'deferred', at, detail: delivery } }
    case 'complained':
      return { status: 'complained', event: { type, at, detail: '' }, suppress: { reason: 'complaint', detail: 'Marked as spam' } }
    case 'unsubscribed':
      return { status: 'unsubscribed', event: { type, at, detail: '' }, suppress: { reason: 'unsubscribe', detail: 'Unsubscribed through Mailgun' } }
    case 'rejected':
      return { status: 'failed', event: { type, at, detail: String(data?.reject?.reason || delivery).slice(0, 300) } }
    default:
      return null
  }
}

/**
 * Apply one verified webhook event. Returns 'retry' when the message was sent
 * by HelpBites but its log row is not there yet (the webhook beat the save),
 * so the caller can ask Mailgun to try again later.
 */
export async function applyMailgunEvent(data: Record<string, any>): Promise<'applied' | 'ignored' | 'retry'> {
  const update = mailgunEventUpdate(data)
  if (!update) return 'ignored'
  const Parse = useParse()
  const vars = (data?.['user-variables'] || {}) as Record<string, string>
  const messageId = String(data?.message?.headers?.['message-id'] || '').replace(/^<|>$/g, '')
  const recipient = String(data?.recipient || '').trim().toLowerCase()

  let row: ParseObject | undefined
  if (messageId) {
    const rows = await new Parse.Query('EmailLog').equalTo('messageId', messageId).include('project').limit(20).find(MASTER)
    row = rows.find(r => r.get('to') === recipient) || rows[0]
  }
  if (!row && vars.hb_batch && recipient) {
    row = await new Parse.Query('EmailLog').equalTo('batchId', vars.hb_batch).equalTo('to', recipient).include('project').first(MASTER)
  }
  if (!row && vars.hb_batch) return 'retry'

  if (row) {
    const events = (Array.isArray(row.get('events')) ? row.get('events') : []) as EmailLogEvent[]
    // A recipient who opens twenty times is one open in the timeline, not twenty.
    if (!events.some(e => e.type === update.event.type && e.detail === update.event.detail && ['opened', 'clicked'].includes(e.type))) {
      row.set('events', [...events, update.event].slice(-30))
    }
    row.set('status', statusAfter(row.get('status') as EmailLogStatus, update.status))
    row.set('lastEventAt', new Date(update.event.at))
    await row.save(null, MASTER)
  }

  if (update.suppress && recipient) {
    const project = (row?.get('project') as ParseObject | undefined) || (vars.hb_project ? await loadProjectUnscoped(vars.hb_project).catch(() => null) : null)
    // Unsubscribing from a newsletter is not unsubscribing from password
    // resets: marketing mail unsubscribes the contact, not the address.
    if (project && update.suppress.reason === 'unsubscribe' && isMarketingSource(row?.get('source'))) await unsubscribeContactByEmail(project, recipient, 'mailgun')
    else if (project) {
      const { added } = await addEmailSuppressions(project, [{ email: recipient, reason: update.suppress.reason, detail: update.suppress.detail, source: 'webhook' }])
      if (added.length) await emitWebhooks(project, [{ type: 'email.suppressed', data: { email: recipient, reason: update.suppress.reason, detail: update.suppress.detail } }])
    }
  }
  return row ? 'applied' : 'ignored'
}
