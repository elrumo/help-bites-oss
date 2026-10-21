import { createError } from 'h3'
import type { EmailDocument } from '#shared/email/blocks'
import { applyProjectAccent, senderVariables } from '#shared/email/resolve'
import { extractTemplateVariables } from '#shared/email/placeholders'
import { campaignBatchId, campaignStatsFrom, canMoveCampaign, CAMPAIGN_STATUSES, EMPTY_CAMPAIGN_STATS, normalizeMarketingConfig, type Campaign, type CampaignStats, type CampaignStatus } from '#shared/marketing'
import type { ContactAttributeValue } from '#shared/contacts'
import { contactQuery, getProjectSegment, serializeSegment } from './contacts'
import { resolveSegmentWhere } from './segmentRelations'
import { deliverEmails, projectEmailSender, type DeliveryResult, type EmailActor, type EmailSender, type OutgoingEmail } from './emailDelivery'
import { emailSendingPaused } from './emailReputation'
import { isMailerConfigured } from './mailer'
import { buildOutgoingEmails, type EmailSendRequest } from './emailSend'
import { blogNewsletterSnapshot } from './blogNewsletter'
import { brandOf, findProjectEmail, serializeEmailTemplate } from './emails'
import { MASTER, iso, pointerId, useParse, type ParseObject } from './parse'
import { runExclusive } from './redis'
import { signLinkToken } from './secrets'
import { workspaceIsActive } from './tenancy'
import { planFeatureError, projectWorkspaceId, workspacePlan } from './usage'

// Broadcast campaigns: one template to everyone in an audience, sent in the
// background a hundred at a time. The design is frozen when sending starts
// (a snapshot on the row), so editing the template mid-send changes nothing.
// Every message goes through the same path as the send API —
// buildOutgoingEmails → deliverEmails — so suppressions, the log, Mailgun's
// webhook and tracking all work as for any email. Each recipient's log row
// carries the campaign's batch id, which is how a resumed run knows who
// already got it and how the numbers are counted. One campaign per workspace
// sends at a time, so one workspace's lists never hold up everyone else's.

const CHUNK = 100
const RUN_BUDGET_MS = 25_000
// Mailgun is down or throttling: stop, keep the cursor, try again later. With no
// mailer at all the campaign pauses instead (see CAMPAIGN_NO_MAILER): waiting fixes nothing.
const PROVIDER_DOWN_RE = /Mailgun (429|5\d\d)|not configured|timed? ?out|fetch failed|ECONN/i
const PROVIDER_RETRY_MS = 5 * 60_000
// A suspended workspace's campaign waits where it is, and is looked at again this much later.
const INACTIVE_RETRY_MS = 60 * 60_000
// How many due campaigns dueCampaigns looks through to find one per workspace.
const DUE_SCAN = 1000

export type CampaignSnapshot = { document: EmailDocument, defaults: Record<string, string>, templateId: string, templateKey: string, templateName: string }

export function serializeCampaign(row: ParseObject): Campaign {
  const audience = (row.get('audience') || {}) as { segment?: string, topic?: string }
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    name: String(row.get('name') || ''),
    status: (row.get('status') as CampaignStatus) || 'draft',
    template: String(row.get('template') || ''),
    templateName: String(row.get('templateName') || ''),
    blogPostId: pointerId(row.get('blogPost')),
    subject: String(row.get('subject') || ''),
    audience: { segment: audience.segment || '', topic: audience.topic || '' },
    scheduledAt: iso(row.get('scheduledAt')),
    startedAt: iso(row.get('startedAt')),
    finishedAt: iso(row.get('finishedAt')),
    testMode: row.get('testMode') === true,
    stats: { ...EMPTY_CAMPAIGN_STATS, ...(row.get('stats') || {}) },
    lastError: String(row.get('lastError') || ''),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  }
}

export async function getProjectCampaign(project: ParseObject, id: string): Promise<ParseObject> {
  const row = id ? await new (useParse()).Query('Campaign').equalTo('project', project).equalTo('objectId', id).first(MASTER) : null
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Campaign not found' })
  return row
}

/** Apply a create/PATCH body's content fields (not the status). Only drafts and scheduled campaigns change. */
export async function applyCampaignInput(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const status = (row.get('status') as CampaignStatus) || 'draft'
  const editable = ['name', 'template', 'subject', 'audience', 'testMode']
  if (editable.some(k => body[k] !== undefined) && status !== 'draft' && status !== 'scheduled') {
    throw createError({ statusCode: 409, statusMessage: `A ${status} campaign can no longer be edited` })
  }
  if (typeof body.name === 'string') row.set('name', body.name.trim().slice(0, 120) || 'Untitled campaign')
  if (typeof body.subject === 'string') row.set('subject', body.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 300))
  if (typeof body.testMode === 'boolean') row.set('testMode', body.testMode)
  if (body.template !== undefined) {
    const ref = String(body.template || '').trim()
    if (ref) {
      const template = await findProjectEmail(project, ref)
      const t = serializeEmailTemplate(template)
      row.set('template', t.key || template.id)
      row.set('templateName', t.master?.name || t.name)
      // A template replaces the blog post a campaign was sending.
      row.unset('blogPost')
    } else if (!row.get('blogPost')) {
      row.set('template', '')
      row.set('templateName', '')
    }
  }
  if (body.audience !== undefined) {
    const a = (body.audience && typeof body.audience === 'object' ? body.audience : {}) as Record<string, unknown>
    const segment = String(a.segment || '').trim()
    const topic = String(a.topic || '').trim().toLowerCase()
    if (segment) await getProjectSegment(project, segment)
    if (topic && !normalizeMarketingConfig(project.get('marketing')).topics.some(t => t.key === topic)) throw createError({ statusCode: 400, statusMessage: `No topic "${topic}" in this project's marketing settings` })
    row.set('audience', { segment, topic })
  }
}

// ---- audience -----------------------------------------------------------------------

/**
 * Who a campaign goes to. The segment narrows; the server adds the rules a
 * segment can never lift: this project, subscribed, not opted out of the topic.
 */
export async function campaignAudience(project: ParseObject, audience: { segment?: string, topic?: string }) {
  const where = audience.segment ? await resolveSegmentWhere(project, serializeSegment(await getProjectSegment(project, audience.segment)).filter) : {}
  const query = contactQuery(project, where).equalTo('subscription', 'subscribed').exists('email')
  if (audience.topic) query.notEqualTo('unsubscribedTopics', audience.topic)
  return query
}

// ---- links ---------------------------------------------------------------------------

export function publicBaseUrl(): string {
  const base = String(process.env.APP_URL || '').trim().replace(/\/+$/, '')
  if (!base) throw createError({ statusCode: 503, statusMessage: 'Set APP_URL on the server: unsubscribe links need a public address' })
  return base
}

export function unsubscribeToken(projectId: string, contactId: string, topic = ''): string {
  return signLinkToken('unsubscribe', [projectId, contactId, topic].join(':'))
}

export function readUnsubscribePayload(payload: string | null): { projectId: string, contactId: string, topic: string } | null {
  const [projectId, contactId, topic = ''] = String(payload || '').split(':')
  return projectId && contactId ? { projectId, contactId, topic } : null
}

/** The links one recipient's email carries, and the RFC 8058 one-click headers. */
export function unsubscribeLinks(base: string, projectId: string, contactId: string, topic = '') {
  const token = unsubscribeToken(projectId, contactId, topic)
  return {
    unsubscribeUrl: `${base}/u/${token}?unsubscribe=1`,
    preferencesUrl: `${base}/u/${token}`,
    headers: { 'List-Unsubscribe': `<${base}/v1/unsubscribe/${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
  }
}

// ---- content -------------------------------------------------------------------------

/** The design as it will go out: the master's with this project's accent, or the template's own. */
export async function snapshotCampaign(project: ParseObject, ref: string): Promise<CampaignSnapshot> {
  if (!ref) throw createError({ statusCode: 400, statusMessage: 'Pick a template first' })
  const row = await findProjectEmail(project, ref)
  const t = serializeEmailTemplate(row)
  const source = t.master || t
  if (!source.document) throw createError({ statusCode: 400, statusMessage: 'That template has no design yet' })
  const document = t.master ? applyProjectAccent(source.document, brandOf(project).theme?.accent) : source.document
  const defaults = Object.fromEntries(senderVariables(t, t.master).filter(v => v.defaultValue != null).map(v => [v.key, String(v.defaultValue)]))
  return { document, defaults, templateId: row.id || '', templateKey: t.key, templateName: t.master?.name || t.name }
}

/** What a campaign sends: its blog post when it carries one (blogNewsletter.ts), else its template. */
export async function campaignContent(project: ParseObject, row: ParseObject): Promise<CampaignSnapshot> {
  const postId = pointerId(row.get('blogPost'))
  return postId ? await blogNewsletterSnapshot(project, postId) : await snapshotCampaign(project, String(row.get('template') || ''))
}

/** CAN-SPAM and RFC 8058: a way out and a postal address in every campaign, or it does not go. */
export function complianceProblems(project: ParseObject, document: EmailDocument): string[] {
  const keys = extractTemplateVariables(document)
  const problems: string[] = []
  if (!keys.includes('unsubscribeUrl') && !keys.includes('preferencesUrl')) problems.push('The template needs an unsubscribe link: add {{unsubscribeUrl}} (the Editorial digest starter has one in its footer)')
  if (!normalizeMarketingConfig(project.get('marketing')).postalAddress) problems.push('Add your postal address under Campaigns → Settings; marketing email must carry it')
  else if (!keys.includes('project.address')) problems.push('The template needs your postal address: add {{project.address}} to the footer')
  return problems
}

/** Marketing mail's own sender when the project has one, else the project's. */
export const CAMPAIGN_NO_MAILER = 'Email sending is not configured on this server (set MAILGUN_API_KEY, MAILGUN_DOMAIN and MAILGUN_FROM_EMAIL, or the project\'s own sending domain)'

/** Whether this project's campaigns have anything to send through. */
export function campaignMailerReady(project: ParseObject): boolean {
  return isMailerConfigured(marketingSender(project))
}

export function marketingSender(project: ParseObject): EmailSender {
  const marketing = normalizeMarketingConfig(project.get('marketing'))
  const sender = projectEmailSender(project)
  if (marketing.fromEmail && marketing.mailDomain) return { ...sender, fromEmail: marketing.fromEmail, domain: marketing.mailDomain, fromName: marketing.fromName || sender.fromName }
  return marketing.fromName ? { ...sender, fromName: marketing.fromName } : sender
}

/** What a contact fills in: `{{contact.*}}`, their attributes by name, and `{{firstName}}`. */
export function contactVariables(contact: ParseObject): Record<string, string> {
  const name = String(contact.get('name') || '')
  const attributes = (contact.get('attributes') || {}) as Record<string, ContactAttributeValue>
  const vars: Record<string, string> = {
    firstName: name.split(/\s+/)[0] || '',
    'contact.name': name,
    'contact.firstName': name.split(/\s+/)[0] || '',
    'contact.email': String(contact.get('email') || ''),
    'contact.externalId': String(contact.get('externalId') || '')
  }
  for (const [key, value] of Object.entries(attributes)) {
    vars[key] = String(value)
    vars[`contact.${key}`] = String(value)
  }
  return vars
}

/** Every placeholder the design uses, blank unless something fills it: no "Hi {{firstName}}" goes out. */
export function blankValues(document: EmailDocument, subject: string): Record<string, string> {
  const keys = new Set(extractTemplateVariables(document))
  for (const m of subject.matchAll(/\{\{\{?\s*([\w.-]+)\s*\}?\}\}/g)) keys.add(m[1]!)
  return Object.fromEntries([...keys].filter(k => !k.startsWith('project.')).map(k => [k, '']))
}

/** One message per contact, through the send API's own composer. */
export function campaignEmails(project: ParseObject, snapshot: CampaignSnapshot, contacts: ParseObject[], options: { batchId: string, subject: string, topic: string, testMode: boolean, source: 'campaign' | 'sequence' | 'form' | 'test', actor: EmailActor, base: string, metadata?: Record<string, string> }): OutgoingEmail[] {
  const sender = marketingSender(project)
  const request: EmailSendRequest = {
    content: { type: 'document', document: snapshot.document },
    recipients: contacts.map((c) => {
      const links = unsubscribeLinks(options.base, project.id || '', c.id || '', options.topic)
      return { email: String(c.get('email')), name: String(c.get('name') || ''), variables: { ...contactVariables(c), unsubscribeUrl: links.unsubscribeUrl, preferencesUrl: links.preferencesUrl, oneClickUrl: links.headers['List-Unsubscribe'].slice(1, -1) } }
    }),
    cc: [],
    bcc: [],
    subject: options.subject,
    text: '',
    variables: { ...blankValues(snapshot.document, options.subject), ...snapshot.defaults },
    from: {},
    replyTo: '',
    headers: { 'List-Unsubscribe': '<{{oneClickUrl}}>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: [options.source === 'test' ? 'test' : options.source],
    metadata: options.metadata || {},
    attachments: [],
    sendAt: null,
    testMode: options.testMode,
    ignoreSuppressions: false,
    idempotencyKey: '',
    project: project.id || ''
  }
  const mails = buildOutgoingEmails(project, options.actor, request, { type: 'document', document: snapshot.document }, sender, { batchId: options.batchId, source: options.source === 'test' ? 'test' : options.source })
  for (const mail of mails) {
    mail.log.templateKey = snapshot.templateKey
    mail.log.templateName = snapshot.templateName
    if (options.source === 'test') mail.subject = `[Test] ${mail.subject}`
  }
  return mails
}

// ---- numbers ------------------------------------------------------------------------

/**
 * Per-status counts of a batch, in aggregates over the log. A send that
 * failed while Mailgun was down and went through on the retry has two rows;
 * "failed" counts only the people who never got one.
 */
export async function batchStatusCounts(batchId: string): Promise<Record<string, number>> {
  const query = () => new (useParse()).Query('EmailLog')
  const [byStatus, byPerson] = await Promise.all([
    query().aggregate([{ $match: { batchId } }, { $group: { _id: '$status', n: { $sum: 1 } } }], MASTER) as Promise<{ objectId: string, n: number }[]>,
    query().aggregate([
      { $match: { batchId, status: 'failed' } },
      { $group: { _id: '$to' } }
    ], MASTER) as Promise<{ objectId: string }[]>
  ])
  const counts = Object.fromEntries(byStatus.map(r => [String(r.objectId), Number(r.n) || 0]))
  const failedPeople = byPerson.map(r => String(r.objectId))
  if (failedPeople.length) {
    const recovered = await query().equalTo('batchId', batchId).containedIn('to', failedPeople).notEqualTo('status', 'failed').count(MASTER)
    counts.failed = failedPeople.length - recovered
  }
  return counts
}

/** Live numbers while the log has them; the last ones kept on the row once retention prunes it. */
export async function refreshCampaignStats(row: ParseObject): Promise<CampaignStats> {
  const kept = { ...EMPTY_CAMPAIGN_STATS, ...(row.get('stats') || {}) } as CampaignStats
  if (!row.get('startedAt')) return kept
  const counts = await batchStatusCounts(campaignBatchId(row.id || '')).catch(() => ({}))
  if (!Object.keys(counts).length) return kept
  const stats = campaignStatsFrom(counts, kept.audience)
  if (JSON.stringify(stats) !== JSON.stringify(kept)) {
    row.set('stats', stats)
    await row.save(null, MASTER).catch(() => {})
  }
  return stats
}

// ---- sending -----------------------------------------------------------------------

const CAMPAIGN_ACTOR: EmailActor = { type: 'system', id: '', name: 'Campaign' }

/** Freeze the design, count the audience, and move a due campaign to sending. False when it cannot start. */
async function startCampaign(project: ParseObject, row: ParseObject): Promise<boolean> {
  try {
    const snapshot = await campaignContent(project, row)
    const problems = complianceProblems(project, snapshot.document)
    if (problems.length) throw createError({ statusCode: 400, statusMessage: problems.join('; ') })
    publicBaseUrl()
    if (!campaignMailerReady(project)) throw createError({ statusCode: 503, statusMessage: CAMPAIGN_NO_MAILER })
    const audience = (row.get('audience') || {}) as { segment?: string, topic?: string }
    const count = await (await campaignAudience(project, audience)).count(MASTER)
    row.set('snapshot', snapshot)
    row.set('stats', { ...EMPTY_CAMPAIGN_STATS, audience: count })
    row.set('cursor', {})
    row.set('status', 'sending')
    row.set('startedAt', new Date())
    row.set('lastError', '')
    await row.save(null, MASTER)
    return true
  } catch (error) {
    // Back to draft with the reason, rather than sending something broken.
    row.set('status', 'draft')
    row.set('lastError', String((error as { statusMessage?: string }).statusMessage || (error as Error).message).slice(0, 500))
    await row.save(null, MASTER)
    return false
  }
}

/** Stop a campaign that may not go on (the plan, the workspace's sending paused), with the reason the operator sees. They start it again once it can. */
async function stopCampaign(row: ParseObject, status: 'draft' | 'paused', reason: string): Promise<void> {
  row.set('status', status)
  row.set('lastError', reason.slice(0, 500))
  await row.save(null, MASTER)
}

/**
 * Send the next stretch of a campaign (up to RUN_BUDGET_MS). Before each
 * chunk it asks the log who already has a message from this campaign, so a
 * run that died mid-chunk resends nothing that went.
 * ponytail: a crash between Mailgun accepting a message and its log row being written can still send that one twice; per-recipient claims in Redis if it ever matters.
 */
export async function runCampaign(campaignId: string, budgetMs = RUN_BUDGET_MS): Promise<void> {
  await runExclusive(`sb:campaign:${campaignId}`, 120, async () => {
    const row = await new (useParse()).Query('Campaign').include('project').get(campaignId, MASTER)
    if (row.get('status') !== 'scheduled' && row.get('status') !== 'sending') return
    if (row.get('status') === 'scheduled') {
      const at = row.get('scheduledAt') as Date | undefined
      if (at && at.getTime() > Date.now()) return
    }
    const workspaceId = await projectWorkspaceId(row.get('project') as ParseObject)
    // One campaign per workspace sends at a time: while another of its campaigns does, this one waits for a later tick.
    await runExclusive(`sb:campaign:ws:${workspaceId}`, 120, () => sendCampaign(row, workspaceId, budgetMs))
  })
}

async function sendCampaign(row: ParseObject, workspaceId: string, budgetMs: number): Promise<void> {
  const Parse = useParse()
  const project = row.get('project') as ParseObject
  if (!(await workspaceIsActive(workspaceId))) {
    row.set('nextAt', new Date(Date.now() + INACTIVE_RETRY_MS))
    await row.save(null, MASTER)
    return
  }
  const plan = await workspacePlan(workspaceId)
  // Campaigns left the workspace's plan: a scheduled one goes back to draft (as when it fails its checks), a sending one pauses.
  if (!plan.features.campaigns) {
    await stopCampaign(row, row.get('status') === 'sending' ? 'paused' : 'draft', String(planFeatureError(plan, 'campaigns').statusMessage))
    return
  }
  if (row.get('status') === 'scheduled' && !(await startCampaign(project, row))) return
  if (row.get('status') !== 'sending') return
  // Too many bounces or spam complaints: bulk mail stops until staff resume the workspace. Resuming carries on from the cursor.
  const paused = await emailSendingPaused(workspaceId)
  if (paused) {
    await stopCampaign(row, 'paused', `Paused: ${paused}`)
    return
  }
  // The mailer went away mid-send: pause where it is, rather than retrying every few minutes for ever. Resuming carries on from the cursor.
  if (!campaignMailerReady(project)) {
    await stopCampaign(row, 'paused', `Paused: ${CAMPAIGN_NO_MAILER}`)
    return
  }

  const snapshot = row.get('snapshot') as CampaignSnapshot
  const audience = (row.get('audience') || {}) as { segment?: string, topic?: string }
  const batchId = campaignBatchId(row.id || '')
  const subject = String(row.get('subject') || '')
  const base = publicBaseUrl()
  const deadline = Date.now() + budgetMs
  let cursor = String((row.get('cursor') || {}).lastId || '')

  while (Date.now() < deadline) {
    // An operator may pause or cancel mid-run.
    const status = (await new Parse.Query('Campaign').select('status').get(row.id || '', MASTER)).get('status')
    if (status !== 'sending') return
    const query = await campaignAudience(project, audience)
    if (cursor) query.greaterThan('objectId', cursor)
    const contacts = await query.ascending('objectId').limit(CHUNK).find(MASTER)
    if (!contacts.length) {
      row.set('status', 'sent')
      row.set('finishedAt', new Date())
      await row.save(null, MASTER)
      await refreshCampaignStats(row)
      return
    }
    const emails = contacts.map(c => String(c.get('email')))
    const logged = await new Parse.Query('EmailLog').equalTo('batchId', batchId).containedIn('to', emails).notEqualTo('status', 'failed').select('to').limit(emails.length * 2).find(MASTER)
    const done = new Set(logged.map(r => String(r.get('to'))))
    // One message per address: two contacts can share one (a sync that keys people by another id).
    const todo = contacts.filter((c) => {
      const email = String(c.get('email'))
      if (done.has(email)) return false
      done.add(email)
      return true
    })
    if (todo.length) {
      let results: DeliveryResult[]
      try {
        results = await deliverEmails(campaignEmails(project, snapshot, todo, { batchId, subject, topic: audience.topic || '', testMode: row.get('testMode') === true, source: 'campaign', actor: CAMPAIGN_ACTOR, base }))
      } catch (error) {
        // Out of email on the plan: pause instead of trying again every tick. Resuming carries on from the cursor.
        if ((error as { statusCode?: number }).statusCode !== 402) throw error
        await stopCampaign(row, 'paused', `Paused: ${(error as { statusMessage?: string }).statusMessage || 'the plan\'s email limit is reached'}`)
        return
      }
      const down = results.find(r => r.status === 'failed' && PROVIDER_DOWN_RE.test(r.error))
      if (down) {
        row.set('nextAt', new Date(Date.now() + PROVIDER_RETRY_MS))
        row.set('lastError', `Paused sending for 5 minutes: ${down.error}`.slice(0, 500))
        await row.save(null, MASTER)
        return
      }
    }
    cursor = contacts.at(-1)!.id || ''
    row.set('cursor', { lastId: cursor })
    row.set('lastError', '')
    await row.save(null, MASTER)
  }
}

/**
 * Which due campaigns to run: the longest waiting first, but one per
 * workspace, so a workspace with several big lists takes turns with itself
 * rather than with everyone else.
 */
export function pickDueCampaigns<T extends { id: string, workspaceId: string }>(due: T[], limit: number): T[] {
  const taken = new Set<string>()
  const picked: T[] = []
  for (const campaign of due) {
    if (picked.length >= limit) break
    if (taken.has(campaign.workspaceId)) continue
    taken.add(campaign.workspaceId)
    picked.push(campaign)
  }
  return picked
}

/** Campaigns with work to do now, one per workspace. `nextAt` holds one back: Mailgun was down, or its workspace is suspended. */
export async function dueCampaigns(limit = 5): Promise<string[]> {
  const Parse = useParse()
  const now = new Date()
  const campaigns = () => new Parse.Query('Campaign')
  const ready = (query: () => ReturnType<typeof campaigns>) => [query().doesNotExist('nextAt'), query().lessThanOrEqualTo('nextAt', now)]
  const rows = await Parse.Query.or(
    ...ready(() => campaigns().equalTo('status', 'scheduled').lessThanOrEqualTo('scheduledAt', now)),
    ...ready(() => campaigns().equalTo('status', 'sending'))
  ).ascending('updatedAt').limit(DUE_SCAN).select('project').find(MASTER)
  const due = await Promise.all(rows.map(async row => ({ id: row.id || '', workspaceId: await projectWorkspaceId(row.get('project') as ParseObject) })))
  return pickDueCampaigns(due, limit).map(campaign => campaign.id)
}

/** A status change an operator or the API asked for. */
export async function moveCampaign(project: ParseObject, row: ParseObject, to: string, scheduledAt?: unknown): Promise<void> {
  const from = (row.get('status') as CampaignStatus) || 'draft'
  if (!CAMPAIGN_STATUSES.includes(to as CampaignStatus)) throw createError({ statusCode: 400, statusMessage: `status must be one of ${CAMPAIGN_STATUSES.join(', ')}` })
  if (to === from && to !== 'scheduled') return
  const allowed = to === from || canMoveCampaign(from, to as CampaignStatus)
  if (!allowed) throw createError({ statusCode: 409, statusMessage: `A ${from} campaign cannot become ${to}` })

  if (to === 'scheduled' || (to === 'sending' && (from === 'draft' || from === 'scheduled'))) {
    // Checked now, so the operator hears about a missing unsubscribe link before the send time.
    const snapshot = await campaignContent(project, row)
    const problems = complianceProblems(project, snapshot.document)
    if (problems.length) throw createError({ statusCode: 400, statusMessage: problems.join('; ') })
    publicBaseUrl()
    if (!campaignMailerReady(project)) throw createError({ statusCode: 503, statusMessage: CAMPAIGN_NO_MAILER })
    let at = new Date()
    if (to === 'scheduled') {
      at = new Date(String(scheduledAt || ''))
      if (Number.isNaN(at.getTime())) throw createError({ statusCode: 400, statusMessage: 'scheduledAt must be an ISO date' })
      if (at.getTime() < Date.now() - 60_000) throw createError({ statusCode: 400, statusMessage: 'scheduledAt is in the past' })
    }
    // "Send now" is scheduled for now; the worker (or the kick below) starts it.
    row.set('status', 'scheduled')
    row.set('scheduledAt', at)
    row.set('lastError', '')
    // Whatever held it back before (a suspension) is no reason to wait past the new time.
    row.unset('nextAt')
    return
  }
  if (to === 'sending') {
    if (!campaignMailerReady(project)) throw createError({ statusCode: 503, statusMessage: CAMPAIGN_NO_MAILER })
    row.set('nextAt', new Date()) // resume
  }
  row.set('status', to)
}
