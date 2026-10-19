import { createError } from 'h3'
import { edition } from './edition'

// The reputation guard, where the edition turns it on (the hosted service,
// where every workspace's mail shares one Mailgun account and, until a domain
// is verified, one sending address). A workspace whose recent mail bounces or
// draws spam complaints too often stops sending bulk mail (campaigns and
// sequence steps) until staff have looked at it and resume it. Mail people
// trigger themselves (the send API, notifications, resets) keeps going.
//
// A hard bounce is the `bounced` status: Mailgun's permanent `failed` event is
// stored as that (emailLogs.ts). The `failed` status is a send Mailgun refused
// or that never reached it, so nothing reached a mailbox and it is not counted.

export const REPUTATION_WINDOW_DAYS = 7
export const REPUTATION_MIN_SENDS = 100
export const REPUTATION_MAX_BOUNCE_RATE = 0.05
export const REPUTATION_MAX_COMPLAINT_RATE = 0.001

const DAY_MS = 24 * 60 * 60 * 1000
// Every status a message can reach once Mailgun took it. Delivery webhooks
// move a row on (sent, delivered, opened...), so "sent or delivered" alone
// would miss the mail that was opened, and the very bounces being counted.
const SENT_STATUSES = ['sent', 'delivered', 'opened', 'clicked', 'unsubscribed', 'bounced', 'complained']
const PROJECT_PAGE = 1000

export type ReputationCounts = { sends: number, bounces: number, complaints: number }
export type ReputationVerdict = { pause: boolean, reason: string, bounceRate: number, complaintRate: number }
/** Workspace.sendingPaused. A pause staff lifted keeps its record, with `resumedAt`. */
export type SendingPause = ReputationCounts & { at: string, reason: string, bounceRate: number, complaintRate: number, resumedAt?: string, resumedBy?: string }
export type ReputationCheck = ReputationCounts & ReputationVerdict & { workspaceId: string, since: string }

const percent = (rate: number) => `${Number((rate * 100).toPrecision(2))}%`
const rounded = (rate: number) => Math.round(rate * 100_000) / 100_000

/**
 * Whether these numbers pause a workspace: bounces above 5% or complaints
 * above 0.1% of what was sent, once at least 100 messages went out (two
 * bounces out of ten say little about a list).
 */
export function reputationVerdict(counts: ReputationCounts, window = `in the last ${REPUTATION_WINDOW_DAYS} days`): ReputationVerdict {
  const sends = Math.max(0, counts.sends)
  const bounceRate = sends ? counts.bounces / sends : 0
  const complaintRate = sends ? counts.complaints / sends : 0
  const problems: string[] = []
  if (sends >= REPUTATION_MIN_SENDS) {
    if (bounceRate > REPUTATION_MAX_BOUNCE_RATE) problems.push(`${percent(bounceRate)} bounced (the limit is ${percent(REPUTATION_MAX_BOUNCE_RATE)})`)
    if (complaintRate > REPUTATION_MAX_COMPLAINT_RATE) problems.push(`${percent(complaintRate)} were marked as spam (the limit is ${percent(REPUTATION_MAX_COMPLAINT_RATE)})`)
  }
  return {
    pause: problems.length > 0,
    reason: problems.length ? `Of the ${sends.toLocaleString('en-US')} emails sent ${window}, ${problems.join(' and ')}` : '',
    bounceRate,
    complaintRate
  }
}

/** The reason a stored pause gives, or null when there is none or staff lifted it. */
export function sendingPauseReason(value: unknown): string | null {
  const pause = value as Partial<SendingPause> | null | undefined
  if (!pause || typeof pause !== 'object' || pause.resumedAt) return null
  return typeof pause.reason === 'string' && pause.reason.trim() ? pause.reason : null
}

/**
 * Why a workspace may not send bulk mail right now, or null. Campaigns and
 * sequences ask before every send; it reads the cached workspace, so it costs
 * nothing most of the time.
 */
export async function emailSendingPaused(workspaceId: string): Promise<string | null> {
  if (!edition().policy.reputationGuard || !workspaceId) return null
  return sendingPauseReason((await getWorkspace(workspaceId))?.get('sendingPaused'))
}

// ---- counting -----------------------------------------------------------------------

/** One workspace's mail since `since`: its projects', and what it sent without a project. Count queries only. */
async function countWorkspaceMail(workspaceId: string, since: Date): Promise<ReputationCounts> {
  const Parse = useParse()
  const workspace = Parse.Object.extend('Workspace').createWithoutData(workspaceId)
  const projects = (await workspaceProjectIds(workspaceId)).map(id => Parse.Object.extend('Project').createWithoutData(id))
  const count = (statuses: string[]) => Parse.Query.or(
    new Parse.Query('EmailLog').containedIn('project', projects),
    new Parse.Query('EmailLog').equalTo('workspace', workspace)
  ).containedIn('status', statuses).greaterThanOrEqualTo('createdAt', since).notEqualTo('testMode', true).count(MASTER)
  const [sends, bounces, complaints] = await Promise.all([count(SENT_STATUSES), count(['bounced']), count(['complained'])])
  return { sends, bounces, complaints }
}

/**
 * Count one workspace's recent mail and pause its bulk sending when the
 * numbers say so. After staff resume a workspace only what it sent since
 * counts, so the mail that paused it can't pause it again. Null when the
 * workspace is gone or already paused (it stays so until staff resume it).
 */
export async function checkWorkspaceReputation(workspaceId: string, now = new Date()): Promise<ReputationCheck | null> {
  const workspace = await getWorkspace(workspaceId)
  if (!workspace || ['deleting', 'deleted'].includes(String(workspace.get('status') || 'active'))) return null
  const previous = workspace.get('sendingPaused') as Partial<SendingPause> | undefined
  if (sendingPauseReason(previous)) return null

  const windowStart = new Date(now.getTime() - REPUTATION_WINDOW_DAYS * DAY_MS)
  const resumedAt = previous?.resumedAt ? new Date(previous.resumedAt) : null
  const resumedLater = !!resumedAt && resumedAt.getTime() > windowStart.getTime()
  const since = resumedLater ? resumedAt! : windowStart
  const counts = await countWorkspaceMail(workspaceId, since)
  const verdict = reputationVerdict(counts, resumedLater ? 'since sending was resumed' : undefined)
  const check = { workspaceId, since: since.toISOString(), ...counts, ...verdict }
  if (!verdict.pause) return check

  const Parse = useParse()
  const pause: SendingPause = { at: now.toISOString(), reason: verdict.reason, bounceRate: rounded(verdict.bounceRate), complaintRate: rounded(verdict.complaintRate), ...counts }
  // Only this field is written: the cached row may be behind on the others.
  const row = Parse.Object.extend('Workspace').createWithoutData(workspaceId)
  row.set('sendingPaused', pause)
  await row.save(null, MASTER)
  await invalidate('workspace', workspaceId)
  await audit({ action: 'email.sending_paused', workspace: workspaceId, data: { ...pause, since: check.since } })
  await mailSendingPaused(workspace, pause, since).catch(error => console.error(`[email] pause of ${workspaceId} not mailed:`, (error as Error).message))
  return check
}

/**
 * Workspaces that sent anything in the last 7 days, found through the log
 * (its distinct projects, and workspaces on mail sent without a project)
 * rather than by visiting every workspace.
 */
export async function recentSendingWorkspaceIds(now = new Date()): Promise<string[]> {
  const Parse = useParse()
  const since = new Date(now.getTime() - REPUTATION_WINDOW_DAYS * DAY_MS)
  // distinct always runs with the master key.
  const [projects, workspaces] = await Promise.all([
    new Parse.Query('EmailLog').greaterThanOrEqualTo('createdAt', since).distinct('project') as Promise<unknown[]>,
    new Parse.Query('EmailLog').greaterThanOrEqualTo('createdAt', since).exists('workspace').distinct('workspace') as Promise<unknown[]>
  ])
  const ids = new Set(workspaces.map(pointerId).filter(Boolean))
  const projectIds = [...new Set(projects.map(pointerId).filter(Boolean))]
  for (let i = 0; i < projectIds.length; i += PROJECT_PAGE) {
    const page = projectIds.slice(i, i + PROJECT_PAGE)
    const rows = await new Parse.Query('Project').containedIn('objectId', page).select('workspace').limit(page.length).find(MASTER)
    for (const row of rows) {
      const id = pointerId(row.get('workspace'))
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

/** The hourly round: every workspace that sent in the last 7 days, one at a time. */
export async function checkEmailReputation(now = new Date()): Promise<{ checked: number, paused: string[] }> {
  let checked = 0
  const paused: string[] = []
  for (const workspaceId of await recentSendingWorkspaceIds(now)) {
    try {
      const result = await checkWorkspaceReputation(workspaceId, now)
      if (result) checked++
      if (result?.pause) paused.push(workspaceId)
    } catch (error) {
      console.error(`[email] reputation check of ${workspaceId} failed:`, (error as Error).message)
    }
  }
  return { checked, paused }
}

// ---- resuming -----------------------------------------------------------------------

/** Lift a pause (staff). The record stays on the workspace, with when and by whom. Resuming twice is harmless. */
export async function resumeEmailSending(workspaceId: string, by: { actor: ParseObject, ip?: string, note?: string }): Promise<{ resumed: boolean, sendingPaused: SendingPause | null }> {
  const row = workspaceId ? await new (useParse()).Query('Workspace').get(workspaceId, MASTER).catch(() => null) : null
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  const pause = (row.get('sendingPaused') || null) as SendingPause | null
  if (!pause || !sendingPauseReason(pause)) return { resumed: false, sendingPaused: pause }
  const next: SendingPause = { ...pause, resumedAt: new Date().toISOString(), resumedBy: String(by.actor.get('email') || '') }
  row.set('sendingPaused', next)
  await row.save(null, MASTER)
  await invalidate('workspace', row.id || '')
  await audit({ action: 'email.sending_resumed', actor: by.actor, workspace: row, data: { reason: pause.reason, pausedAt: pause.at, ...(by.note ? { note: by.note } : {}) }, ip: by.ip })
  return { resumed: true, sendingPaused: next }
}

// ---- telling people -----------------------------------------------------------------

/** Plain system mail to the workspace's owner, and to every address in SUPERADMIN_EMAILS. */
async function mailSendingPaused(workspace: ParseObject, pause: SendingPause, since: Date): Promise<void> {
  if (!isMailerConfigured()) return
  const Parse = useParse()
  const ownerId = pointerId(workspace.get('owner'))
  const owner = ownerId ? await new Parse.Query(Parse.User).get(ownerId, MASTER).catch(() => null) : null
  const ownerEmail = String(owner?.get('email') || '').trim().toLowerCase()
  const staff = [...new Set(String(process.env.SUPERADMIN_EMAILS || '').split(',').map(item => item.trim().toLowerCase()))].filter(email => isProbablyEmail(email) && email !== ownerEmail)
  const space = String(workspace.get('name') || 'Your workspace')
  const sender = projectEmailSender(null, { fromName: 'HelpBites' })
  const batchId = newEmailBatchId()
  const body = (lines: string[]) => ({ html: lines.map(line => `<p>${escapeHtml(line)}</p>`).join(''), text: lines.join('\n\n') })
  const log = { source: 'system' as const, kind: 'message' as const, templateName: 'Bulk email paused', batchId, actor: SYSTEM_EMAIL_ACTOR }

  const mails: OutgoingEmail[] = []
  if (ownerEmail) {
    mails.push({
      project: null,
      workspace,
      to: { email: ownerEmail, name: String(owner?.get('name') || '') },
      subject: `${space}: campaigns and sequences are paused`,
      ...body([
        `Campaigns and sequence emails in ${space} are paused. ${pause.reason}.`,
        'High bounce and spam complaint rates hurt delivery for everyone who shares this mail service, so bulk mail stays paused until our team has reviewed it and resumes it. Everything else keeps going: replies, notifications, password resets and email sent through the API.',
        'The usual cause is an old or bought list. Before sending again, remove the addresses that bounce and only mail people who asked to hear from you.'
      ]),
      sender,
      log: { ...log }
    })
  }
  for (const email of staff) {
    mails.push({
      project: null,
      to: { email, name: '' },
      subject: `Bulk email paused: ${space}`,
      ...body([
        `Bulk email (campaigns and sequences) for ${space}, workspace ${workspace.id}, is paused. ${pause.reason}.`,
        `Since ${since.toISOString()}: ${pause.sends} sent, ${pause.bounces} hard bounces, ${pause.complaints} spam complaints.`,
        `Owner: ${ownerEmail || 'unknown'}. It stays paused until staff resume it.`
      ]),
      sender,
      log: { ...log }
    })
  }
  if (mails.length) await deliverEmails(mails)
}
