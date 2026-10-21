import { createError } from 'h3'
import { MAX_SEQUENCE_STEPS, nextStepAt, validateSequenceInput, type Sequence, type SequenceStatus, type SequenceStep, type SequenceTrigger } from '#shared/marketing'
import { CAMPAIGN_NO_MAILER, campaignEmails, campaignMailerReady, complianceProblems, publicBaseUrl, snapshotCampaign, type CampaignSnapshot } from './campaigns'
import { deliverEmails, type DeliveryResult, type EmailActor } from './emailDelivery'
import { emailSendingPaused } from './emailReputation'
import { MASTER, iso, pointerId, useParse, type ParseObject } from './parse'
import { runExclusive } from './redis'
import { workspaceIsActive } from './tenancy'
import { hasFeature, projectWorkspaceId } from './usage'

// Automated sequences: a linear list of emails, each a delay after the one
// before, started for a contact by signing up (optionally to one topic), by an
// event your app reports (POST /v1/track), or by hand. One enrollment per
// contact per sequence. The worker sends due steps; anyone who unsubscribes
// (or opts out of the topic) leaves the sequence at their next step.

const PROVIDER_DOWN_RE = /Mailgun (429|5\d\d)|not configured|timed? ?out|fetch failed|ECONN/i
// A step held back (no sequences on the plan, no email left, a suspended workspace, its bulk mail paused) waits this long, so it does not come up first on every tick.
const PLAN_RETRY_MS = 60 * 60_000
// Steps sent per tick. While other projects have steps waiting, one project sends at most its share
// (never less than perProject), so one big enrollment can't hold up everyone else's; alone, it has the whole tick.
export const SEQUENCE_LIMITS = { perTick: 200, perProject: 50 }
const SEQUENCE_ACTOR: EmailActor = { type: 'system', id: '', name: 'Sequence' }

export function serializeSequence(row: ParseObject): Sequence {
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    name: String(row.get('name') || ''),
    status: (row.get('status') as SequenceStatus) || 'draft',
    trigger: (row.get('trigger') as SequenceTrigger) || { type: 'manual' },
    steps: (row.get('steps') as SequenceStep[]) || [],
    stats: { enrolled: Number(row.get('enrolledCount') || 0), completed: Number(row.get('completedCount') || 0), exited: Number(row.get('exitedCount') || 0), active: Number(row.get('activeCount') || 0) },
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  }
}

export async function getProjectSequence(project: ParseObject, id: string): Promise<ParseObject> {
  const row = id ? await new (useParse()).Query('Sequence').equalTo('project', project).equalTo('objectId', id).first(MASTER) : null
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Sequence not found' })
  return row
}

/** Name, trigger and steps from a create/PATCH body; every step's template must exist. */
export async function applySequenceInput(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  if (typeof body.name === 'string') row.set('name', body.name.trim().slice(0, 120) || 'Untitled sequence')
  const { trigger, steps, errors } = validateSequenceInput(body, { trigger: row.get('trigger') || { type: 'manual' }, steps: row.get('steps') || [] })
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  if (body.steps !== undefined) for (const step of steps) await snapshotCampaign(project, step.template)
  row.set('trigger', trigger)
  row.set('steps', steps)
}

/** Activating checks that email can send at all, and every step for an unsubscribe link and the postal address, as campaigns do. */
export async function setSequenceStatus(project: ParseObject, row: ParseObject, status: unknown): Promise<void> {
  if (!['draft', 'active', 'paused'].includes(String(status))) throw createError({ statusCode: 400, statusMessage: 'status must be draft, active or paused' })
  if (status === 'active') {
    const steps = (row.get('steps') as SequenceStep[]) || []
    if (!steps.length) throw createError({ statusCode: 400, statusMessage: 'Add a step first' })
    if (!campaignMailerReady(project)) throw createError({ statusCode: 503, statusMessage: CAMPAIGN_NO_MAILER })
    for (const [i, step] of steps.entries()) {
      const problems = complianceProblems(project, (await snapshotCampaign(project, step.template)).document)
      if (problems.length) throw createError({ statusCode: 400, statusMessage: `Step ${i + 1}: ${problems.join('; ')}` })
    }
    publicBaseUrl()
  }
  row.set('status', status)
}

// ---- enrolling ---------------------------------------------------------------------

async function bump(sequence: ParseObject, changes: Partial<Record<'enrolled' | 'completed' | 'exited' | 'active', number>>): Promise<void> {
  // Atomic counters, so two processes enrolling at once both count.
  for (const [key, by] of Object.entries(changes)) sequence.increment(`${key}Count`, by)
  await sequence.save(null, MASTER).catch(() => {})
}

/** Start a contact on a sequence, unless they already were on it. Returns whether they were enrolled. */
export async function enrollContact(sequence: ParseObject, contact: ParseObject): Promise<boolean> {
  const Parse = useParse()
  const steps = (sequence.get('steps') as SequenceStep[]) || []
  // Sequences are marketing: only people who agreed to it.
  if (!steps.length || !contact.id || contact.get('subscription') !== 'subscribed') return false
  const locked = await runExclusive(`sb:enroll:${sequence.id}:${contact.id}`, 30, async () => {
    const existing = await new Parse.Query('SequenceEnrollment').equalTo('sequence', sequence).equalTo('contact', contact).first(MASTER)
    if (existing) return false
    const row = new (Parse.Object.extend('SequenceEnrollment'))() as ParseObject
    row.set('project', sequence.get('project'))
    row.set('sequence', sequence)
    row.set('contact', contact)
    row.set('step', 0)
    row.set('status', 'active')
    row.set('nextAt', nextStepAt(steps, 0, new Date()))
    await row.save(null, MASTER)
    return true
  }, { waitMs: 5000, failOpen: true })
  const enrolled = locked.ran && locked.value
  if (enrolled) await bump(sequence, { enrolled: 1, active: 1 })
  return enrolled
}

async function activeSequences(project: ParseObject, trigger: SequenceTrigger['type']): Promise<ParseObject[]> {
  return new (useParse()).Query('Sequence').equalTo('project', project).equalTo('status', 'active').equalTo('trigger.type', trigger).limit(100).find(MASTER)
}

/** Contacts who just became subscribed start every active "on sign-up" sequence they qualify for. */
export async function enrollOnSubscribe(project: ParseObject, contacts: ParseObject[]): Promise<void> {
  if (!contacts.length) return
  const sequences = await activeSequences(project, 'subscribed')
  for (const sequence of sequences) {
    const topic = (sequence.get('trigger') as SequenceTrigger).topic
    for (const contact of contacts) {
      if (topic && ((contact.get('unsubscribedTopics') as string[] | undefined) || []).includes(topic)) continue
      await enrollContact(sequence, contact)
    }
  }
}

/** An event your app reported: start every active sequence that waits for it. */
export async function enrollOnEvent(project: ParseObject, contact: ParseObject, event: string): Promise<number> {
  let count = 0
  for (const sequence of await activeSequences(project, 'event')) {
    if ((sequence.get('trigger') as SequenceTrigger).event === event && await enrollContact(sequence, contact)) count++
  }
  return count
}

// ---- sending -----------------------------------------------------------------------

async function finish(row: ParseObject, sequence: ParseObject, status: 'completed' | 'exited', reason = ''): Promise<void> {
  row.set('status', status)
  row.unset('nextAt')
  if (reason) row.set('lastError', reason)
  await row.save(null, MASTER)
  await bump(sequence, { [status]: 1, active: -1 })
}

/** How many of one project's steps a tick sends while `projects` projects have steps waiting. */
export function sequenceShare(projects: number, limit = SEQUENCE_LIMITS.perTick, perProject = SEQUENCE_LIMITS.perProject): number {
  return Math.min(limit, Math.max(perProject, Math.ceil(limit / Math.max(projects, 1))))
}

/**
 * Which due steps to send this tick: oldest first within a project, taking
 * turns across projects (the one waiting longest first), never more than
 * `perProject` of one project's nor `limit` in all.
 */
export function pickSequenceSteps<T extends { projectId: string, dueAt: number }>(due: T[], limit = SEQUENCE_LIMITS.perTick, perProject = SEQUENCE_LIMITS.perProject): T[] {
  const queues = new Map<string, T[]>()
  for (const step of [...due].sort((a, b) => a.dueAt - b.dueAt)) {
    const queue = queues.get(step.projectId)
    if (queue) queue.push(step)
    else queues.set(step.projectId, [step])
  }
  const picked: T[] = []
  for (let round = 0; round < perProject && picked.length < limit; round++) {
    for (const queue of queues.values()) {
      if (picked.length >= limit) break
      if (round < queue.length) picked.push(queue[round]!)
    }
  }
  return picked
}

/** Each project's oldest due steps, up to its share of a tick: a project with thousands waiting is read no further. */
async function dueSequenceSteps(limit: number): Promise<ParseObject[]> {
  const Parse = useParse()
  const now = new Date()
  const due = () => new Parse.Query('SequenceEnrollment').equalTo('status', 'active').lessThanOrEqualTo('nextAt', now)
  const projectIds = [...new Set((await due().distinct('project') as unknown[]).map(pointerId).filter(Boolean))]
  const share = sequenceShare(projectIds.length, limit)
  const candidates: { id: string, projectId: string, dueAt: number }[] = []
  for (const projectId of projectIds) {
    const rows = await due().equalTo('project', Parse.Object.extend('Project').createWithoutData(projectId)).ascending('nextAt').select('nextAt').limit(share).find(MASTER)
    candidates.push(...rows.map(row => ({ id: row.id || '', projectId, dueAt: (row.get('nextAt') as Date).getTime() })))
  }
  const picked = pickSequenceSteps(candidates, limit, share)
  if (!picked.length) return []
  const rows = await due().containedIn('objectId', picked.map(step => step.id)).include(['sequence', 'contact', 'project']).limit(picked.length).find(MASTER)
  const byId = new Map(rows.map(row => [row.id || '', row]))
  return picked.map(step => byId.get(step.id)).filter((row): row is ParseObject => Boolean(row))
}

/**
 * Send every step that is due (a batch per tick, shared out across projects).
 * One process does it; each step's log batch id is `sq_<enrollment>_<step>`,
 * so a step whose email is already in the log is never sent again.
 * ponytail: one global lock and a 200-step batch per tick; per-sequence locks if a project ever needs more than ~800 steps a minute.
 */
export async function runDueSequenceSteps(limit = SEQUENCE_LIMITS.perTick): Promise<void> {
  await runExclusive('sb:sequences:run', 120, async () => {
    const Parse = useParse()
    const due = await dueSequenceSteps(limit)
    const snapshots = new Map<string, CampaignSnapshot>()
    const allowed = new Map<string, boolean>()
    const workspaces = new Map<string, string>()
    const paused = new Map<string, string | null>()
    const base = publicBaseUrl()
    for (const row of due) {
      const sequence = row.get('sequence') as ParseObject | undefined
      const contact = row.get('contact') as ParseObject | undefined
      const project = row.get('project') as ParseObject
      if (!sequence) { row.set('status', 'exited'); row.unset('nextAt'); await row.save(null, MASTER); continue }
      if (sequence.get('status') !== 'active') continue // paused: its people wait where they are
      const projectId = project.id || ''
      if (!allowed.has(projectId)) {
        const workspaceId = await projectWorkspaceId(project)
        workspaces.set(projectId, workspaceId)
        allowed.set(projectId, await workspaceIsActive(workspaceId) && await hasFeature(workspaceId, 'sequences'))
      }
      if (!allowed.get(projectId)) { row.set('nextAt', new Date(Date.now() + PLAN_RETRY_MS)); await row.save(null, MASTER); continue }
      const trigger = (sequence.get('trigger') as SequenceTrigger) || { type: 'manual' }
      if (!contact || contact.get('subscription') !== 'subscribed' || !contact.get('email')) { await finish(row, sequence, 'exited', 'Unsubscribed'); continue }
      if (trigger.topic && ((contact.get('unsubscribedTopics') as string[] | undefined) || []).includes(trigger.topic)) { await finish(row, sequence, 'exited', 'Opted out of the topic'); continue }
      const steps = ((sequence.get('steps') as SequenceStep[]) || []).slice(0, MAX_SEQUENCE_STEPS)
      const index = Number(row.get('step') || 0)
      const step = steps[index]
      if (!step) { await finish(row, sequence, 'completed'); continue }

      const batchId = `sq_${row.id}_${step.id}`
      const already = await new Parse.Query('EmailLog').equalTo('batchId', batchId).notEqualTo('status', 'failed').first(MASTER)
      if (!already) {
        // Too many bounces or spam complaints: the workspace's bulk mail waits until staff resume it.
        const workspaceId = workspaces.get(projectId) || ''
        if (!paused.has(workspaceId)) paused.set(workspaceId, await emailSendingPaused(workspaceId))
        const reason = paused.get(workspaceId)
        if (reason) {
          row.set('nextAt', new Date(Date.now() + PLAN_RETRY_MS))
          row.set('lastError', reason.slice(0, 300))
          await row.save(null, MASTER)
          continue
        }
        let snapshot = snapshots.get(`${project.id}:${step.template}`)
        try {
          snapshot ||= await snapshotCampaign(project, step.template)
        } catch (error) {
          await finish(row, sequence, 'exited', `Step ${index + 1}: ${(error as { statusMessage?: string }).statusMessage || (error as Error).message}`)
          continue
        }
        snapshots.set(`${project.id}:${step.template}`, snapshot)
        // No mailer at all: the step waits without trying, so the log does not fill with a failure every five minutes.
        if (!campaignMailerReady(project)) {
          row.set('nextAt', new Date(Date.now() + PLAN_RETRY_MS))
          row.set('lastError', CAMPAIGN_NO_MAILER.slice(0, 300))
          await row.save(null, MASTER)
          continue
        }
        let result: DeliveryResult | undefined
        try {
          [result] = await deliverEmails(campaignEmails(project, snapshot, [contact], { batchId, subject: step.subject || '', topic: trigger.topic || '', testMode: false, source: 'sequence', actor: SEQUENCE_ACTOR, base, metadata: { sequence: sequence.id || '', step: step.id } }))
        } catch (error) {
          // Out of email on the plan: the step is tried again later, not failed, and the project's other steps wait with it.
          if ((error as { statusCode?: number }).statusCode !== 402) throw error
          allowed.set(projectId, false)
          row.set('nextAt', new Date(Date.now() + PLAN_RETRY_MS))
          row.set('lastError', String((error as { statusMessage?: string }).statusMessage || '').slice(0, 300))
          await row.save(null, MASTER)
          continue
        }
        if (result?.status === 'failed' && PROVIDER_DOWN_RE.test(result.error)) {
          row.set('nextAt', new Date(Date.now() + 5 * 60_000))
          row.set('lastError', result.error.slice(0, 300))
          await row.save(null, MASTER)
          continue
        }
      }
      const next = nextStepAt(steps, index + 1, new Date())
      row.set('step', index + 1)
      row.set('lastSentAt', new Date())
      if (next) { row.set('nextAt', next); await row.save(null, MASTER) }
      else await finish(row, sequence, 'completed')
    }
  })
}
