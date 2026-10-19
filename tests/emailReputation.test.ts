import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// The reputation guard (server/utils/emailReputation.ts): the thresholds and
// the 100-send floor, what a stored pause means, and one check against a
// fake Parse that counts by status.

const g = globalThis as Record<string, unknown>
g.MASTER = {}

type Fields = Record<string, unknown>
const row = (id: string, fields: Fields) => ({ id, get: (key: string) => fields[key], fields })
const workspaces = new Map<string, ReturnType<typeof row>>()
const saved: Fields[] = []
const audits: Record<string, unknown>[] = []
const invalidated: string[] = []
let counts: Record<string, number> = {}
let countedSince: Date[] = []

g.getWorkspace = async (id: string) => workspaces.get(id) || null
g.workspaceProjectIds = async () => ['p1', 'p2']
g.invalidate = async (_kind: string, key: string) => { invalidated.push(key) }
g.audit = async (entry: Record<string, unknown>) => { audits.push(entry) }
g.isMailerConfigured = () => false

class Query {
  statuses: string[] = []
  static or() { return new Query() }
  containedIn(key: string, values: unknown[]) {
    if (key === 'status') this.statuses = values as string[]
    return this
  }

  equalTo() { return this }
  notEqualTo() { return this }
  greaterThanOrEqualTo(_key: string, value: Date) {
    countedSince.push(value)
    return this
  }

  async count() {
    if (this.statuses.length === 1) return counts[this.statuses[0]!] || 0
    return counts.sent || 0
  }
}
g.useParse = () => ({
  Query,
  Object: {
    extend: () => ({
      createWithoutData: (id: string) => {
        const fields: Fields = { id }
        return { id, set: (key: string, value: unknown) => { fields[key] = value }, save: async () => { saved.push(fields) } }
      }
    })
  }
})

const { checkWorkspaceReputation, emailSendingPaused, reputationVerdict, sendingPauseReason, REPUTATION_MIN_SENDS } = await import('../server/utils/emailReputation')
const { edition, registerEdition, resetEdition } = await import('../server/utils/edition')

beforeEach(() => {
  workspaces.clear()
  saved.length = 0
  audits.length = 0
  invalidated.length = 0
  countedSince = []
  counts = {}
})

afterEach(() => resetEdition())

describe('the verdict', () => {
  test('bounces above 5% pause; 5% exactly does not', () => {
    expect(reputationVerdict({ sends: 1000, bounces: 51, complaints: 0 }).pause).toBe(true)
    expect(reputationVerdict({ sends: 1000, bounces: 50, complaints: 0 }).pause).toBe(false)
  })

  test('complaints above 0.1% pause; 0.1% exactly does not', () => {
    expect(reputationVerdict({ sends: 1000, bounces: 0, complaints: 2 }).pause).toBe(true)
    expect(reputationVerdict({ sends: 1000, bounces: 0, complaints: 1 }).pause).toBe(false)
  })

  test('nothing pauses below 100 sends, however bad', () => {
    expect(REPUTATION_MIN_SENDS).toBe(100)
    expect(reputationVerdict({ sends: 99, bounces: 60, complaints: 10 }).pause).toBe(false)
    expect(reputationVerdict({ sends: 100, bounces: 6, complaints: 0 }).pause).toBe(true)
    expect(reputationVerdict({ sends: 0, bounces: 0, complaints: 0 })).toEqual({ pause: false, reason: '', bounceRate: 0, complaintRate: 0 })
  })

  test('the reason names what was over, with the rates', () => {
    const verdict = reputationVerdict({ sends: 1234, bounces: 89, complaints: 5 })
    expect(verdict.bounceRate).toBeCloseTo(89 / 1234)
    expect(verdict.complaintRate).toBeCloseTo(5 / 1234)
    expect(verdict.reason).toBe('Of the 1,234 emails sent in the last 7 days, 7.2% bounced (the limit is 5%) and 0.41% were marked as spam (the limit is 0.1%)')
    expect(reputationVerdict({ sends: 200, bounces: 0, complaints: 1 }).reason).toBe('Of the 200 emails sent in the last 7 days, 0.5% were marked as spam (the limit is 0.1%)')
  })
})

describe('a stored pause', () => {
  test('gives its reason until staff resume it', () => {
    expect(sendingPauseReason({ at: '2026-10-07T00:00:00Z', reason: 'Too many bounces' })).toBe('Too many bounces')
    expect(sendingPauseReason({ at: '2026-10-07T00:00:00Z', reason: 'Too many bounces', resumedAt: '2026-10-08T00:00:00Z' })).toBeNull()
    expect(sendingPauseReason(undefined)).toBeNull()
    expect(sendingPauseReason({ reason: ' ' })).toBeNull()
    expect(sendingPauseReason('paused')).toBeNull()
  })

  test('is ignored where the edition has no guard (community)', async () => {
    workspaces.set('w1', row('w1', { sendingPaused: { at: '2026-10-07T00:00:00Z', reason: 'Too many bounces' } }))
    expect(edition().policy.reputationGuard).toBe(false)
    expect(await emailSendingPaused('w1')).toBeNull()
    registerEdition({ id: 'cloud', policy: { reputationGuard: true } })
    expect(await emailSendingPaused('w1')).toBe('Too many bounces')
    expect(await emailSendingPaused('nope')).toBeNull()
    expect(await emailSendingPaused('')).toBeNull()
  })
})

describe('checking a workspace', () => {
  const now = new Date('2026-10-07T12:00:00Z')

  test('a clean workspace is left alone', async () => {
    workspaces.set('w1', row('w1', {}))
    counts = { sent: 500, bounced: 5, complained: 0 }
    const check = await checkWorkspaceReputation('w1', now)
    expect(check).toMatchObject({ workspaceId: 'w1', sends: 500, bounces: 5, complaints: 0, pause: false })
    expect(saved).toEqual([])
    expect(audits).toEqual([])
  })

  test('bad numbers pause it, drop the cache everywhere and leave an audit entry', async () => {
    workspaces.set('w1', row('w1', {}))
    counts = { sent: 400, bounced: 40, complained: 0 }
    const check = await checkWorkspaceReputation('w1', now)
    expect(check?.pause).toBe(true)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.sendingPaused).toMatchObject({ at: now.toISOString(), bounceRate: 0.1, complaintRate: 0, sends: 400, bounces: 40, complaints: 0 })
    expect(invalidated).toEqual(['w1'])
    expect(audits[0]).toMatchObject({ action: 'email.sending_paused', workspace: 'w1' })
    // Seven days back.
    expect(countedSince[0]!.toISOString()).toBe('2026-09-30T12:00:00.000Z')
  })

  test('a paused workspace stays as it is; a resumed one counts only what it sent since', async () => {
    workspaces.set('w1', row('w1', { sendingPaused: { at: '2026-10-01T00:00:00Z', reason: 'Too many bounces' } }))
    counts = { sent: 400, bounced: 40, complained: 0 }
    expect(await checkWorkspaceReputation('w1', now)).toBeNull()
    expect(saved).toEqual([])

    workspaces.set('w1', row('w1', { sendingPaused: { at: '2026-10-01T00:00:00Z', reason: 'Too many bounces', resumedAt: '2026-10-06T00:00:00Z' } }))
    counts = { sent: 50, bounced: 10, complained: 0 }
    const check = await checkWorkspaceReputation('w1', now)
    expect(check).toMatchObject({ since: '2026-10-06T00:00:00.000Z', pause: false })
  })

  test('a workspace being deleted is not checked', async () => {
    workspaces.set('w1', row('w1', { status: 'deleting' }))
    expect(await checkWorkspaceReputation('w1', now)).toBeNull()
    expect(await checkWorkspaceReputation('missing', now)).toBeNull()
  })
})
