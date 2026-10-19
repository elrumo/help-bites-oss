import { createError } from 'h3'
import { COUNTER_PERIODS, describeLimit, FEATURE_LABELS, GAUGES, COUNTERS, isUnlimited, UNLIMITED_PLAN, withinLimit, type Counter, type Feature, type Gauge, type Metric, type Plan } from '#shared/entitlements'

// What a workspace has used against its plan (shared/entitlements.ts).
//
// Counters (conversations this month, emails today, AI credits, storage) live
// in Redis, one key per workspace, period and metric. Reserving is one Lua
// call that checks and adds atomically, so two replicas can't both take the
// last conversation. Every changed key is marked dirty, and usageFlush.ts
// copies it into WorkspaceUsage every few minutes; a key Redis lost is seeded
// back from there on first use. Gauges (projects, teammates, FAQs…) are
// counted from the data itself when something is about to be created.
//
// Plan limits answer 402 with `{ code, metric, limit, used, plan }` so the
// panel can say what ran out. The community edition's plan is unlimited:
// nothing here refuses anything, and nothing even loads the workspace to ask.
// When Redis is down, counting fails open: an outage is not a reason to stop
// a customer's support inbox.

export type WorkspaceRef = ParseObject | string

type Counted = Counter | 'storageBytes'

const DIRTY_KEY = 'sb:usage:dirty'
const TTL_SECONDS = { month: 40 * 24 * 3600, day: 3 * 24 * 3600, all: 0 }

// KEYS: the counter, the dirty set. ARGV: amount, limit (-1: none), ttl (0: none), seed (-1: unknown).
// Returns {1, value} when counted, {0, value} when the limit would be passed, {-1, 0} when the key is cold and needs a seed.
const RESERVE = `
local current = redis.call('get', KEYS[1])
if not current then
  local seed = tonumber(ARGV[4])
  if seed < 0 then return {-1, 0} end
  if tonumber(ARGV[3]) > 0 then redis.call('set', KEYS[1], seed, 'EX', ARGV[3]) else redis.call('set', KEYS[1], seed) end
  current = seed
else
  current = tonumber(current)
end
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
if amount > 0 and limit >= 0 and current + amount > limit then return {0, current} end
local value = redis.call('incrby', KEYS[1], amount)
if value < 0 then
  redis.call('set', KEYS[1], 0, 'KEEPTTL')
  value = 0
end
redis.call('sadd', KEYS[2], KEYS[1])
return {1, value}
`

const idOf = (ref: WorkspaceRef | null | undefined) => (typeof ref === 'string' ? ref : ref?.id || '')

/** `2026-10` for a monthly counter, `2026-10-07` for a daily one (UTC), `all` for storage. */
export function usagePeriod(metric: Counted, now = new Date()): string {
  const period = COUNTER_PERIODS[metric]
  if (period === 'all') return 'all'
  return now.toISOString().slice(0, period === 'day' ? 10 : 7)
}

export function usageKey(workspaceId: string, metric: Counted, period = usagePeriod(metric)): string {
  return `sb:usage:${workspaceId}:${period}:${metric}`
}

export function parseUsageKey(key: string): { workspaceId: string, period: string, metric: Counted } | null {
  const match = /^sb:usage:([^:]+):([^:]+):([A-Za-z]+)$/.exec(key)
  if (!match || !([...COUNTERS, 'storageBytes'] as string[]).includes(match[3]!)) return null
  return { workspaceId: match[1]!, period: match[2]!, metric: match[3] as Counted }
}

/** The workspace a project belongs to, without a query when the row already says. */
export async function projectWorkspaceId(project: ParseObject | null | undefined): Promise<string> {
  if (!project) return ''
  return pointerId(project.get('workspace')) || await workspaceIdOfProject(project.id || '')
}

/** The plan a workspace is on. */
export async function workspacePlan(ref: WorkspaceRef | null | undefined): Promise<Plan> {
  if (!edition().planFor) return UNLIMITED_PLAN
  return await planFor(typeof ref === 'string' ? await getWorkspace(ref) : ref)
}

export function planLimitError(plan: Plan, metric: Metric, limit: number, used: number) {
  return createError({
    statusCode: 402,
    statusMessage: `The ${plan.name} plan includes ${describeLimit(metric, limit)}`,
    data: { code: 'plan_limit', metric, limit, used, plan: plan.id }
  })
}

export function planFeatureError(plan: Plan, feature: Feature) {
  return createError({
    statusCode: 402,
    statusMessage: `${FEATURE_LABELS[feature]} is not part of the ${plan.name} plan`,
    data: { code: 'plan_feature', feature, plan: plan.id }
  })
}

async function persistedUsage(workspaceId: string, metric: Counted, period: string): Promise<number> {
  const Parse = useParse()
  const row = await new Parse.Query('WorkspaceUsage')
    .equalTo('workspace', Parse.Object.extend('Workspace').createWithoutData(workspaceId))
    .equalTo('period', period).equalTo('metric', metric).first(MASTER)
  return Math.max(0, Number(row?.get('value') || 0))
}

async function bump(workspaceId: string, metric: Counted, amount: number, limit: number | null): Promise<{ ok: boolean, value: number }> {
  const period = usagePeriod(metric)
  const redis = useRedis()
  const run = async (seed: number) => await redis.eval(RESERVE, 2, usageKey(workspaceId, metric, period), DIRTY_KEY, amount, limit ?? -1, TTL_SECONDS[COUNTER_PERIODS[metric]], seed) as [number, number]
  let [ok, value] = await run(-1)
  if (ok === -1) [ok, value] = await run(await persistedUsage(workspaceId, metric, period))
  return { ok: ok === 1, value: Number(value) }
}

/**
 * Count `amount` more of a counter before doing the thing, refusing with 402
 * when it would pass the plan's limit. Soft limits count but never refuse.
 */
export async function reserveUsage(ref: WorkspaceRef | null | undefined, metric: Counted, amount = 1): Promise<void> {
  const workspaceId = idOf(ref)
  if (!workspaceId || amount <= 0) return
  const plan = await workspacePlan(ref)
  const limit = plan.soft[metric] ? null : plan.limits[metric]
  let result: { ok: boolean, value: number }
  try {
    result = await bump(workspaceId, metric, amount, limit)
  } catch (error) {
    console.warn('[usage] not counted, Redis unavailable:', (error as Error).message)
    return
  }
  if (!result.ok) throw planLimitError(plan, metric, limit!, result.value)
}

/** Count usage that already happened (an AI call), or give some back (a deleted file, a send that never went). Never refuses. */
export async function chargeUsage(ref: WorkspaceRef | null | undefined, metric: Counted, amount: number): Promise<void> {
  const workspaceId = idOf(ref)
  if (!workspaceId || !amount) return
  try {
    await bump(workspaceId, metric, Math.round(amount), null)
  } catch (error) {
    console.warn('[usage] not counted, Redis unavailable:', (error as Error).message)
  }
}

/** A counter's value for the current period. */
export async function readUsage(workspaceId: string, metric: Counted): Promise<number> {
  const period = usagePeriod(metric)
  try {
    const value = await useRedis().get(usageKey(workspaceId, metric, period))
    if (value !== null) return Math.max(0, Number(value))
  } catch {}
  return await persistedUsage(workspaceId, metric, period).catch(() => 0)
}

/** How many of a gauge the workspace has right now. */
export async function countGauge(workspaceId: string, metric: Gauge): Promise<number> {
  const Parse = useParse()
  const workspace = Parse.Object.extend('Workspace').createWithoutData(workspaceId)
  const projects = async () => (await workspaceProjectIds(workspaceId)).map(id => Parse.Object.extend('Project').createWithoutData(id))
  switch (metric) {
    case 'projects': return await new Parse.Query('Project').equalTo('workspace', workspace).count(MASTER)
    case 'seats': {
      // Pending invitations hold a seat, so a Free workspace can't invite ten people and wait.
      const [members, invites] = await Promise.all([
        new Parse.Query('WorkspaceMember').equalTo('workspace', workspace).count(MASTER),
        new Parse.Query('WorkspaceInvite').equalTo('workspace', workspace).doesNotExist('acceptedAt').greaterThan('expiresAt', new Date()).count(MASTER)
      ])
      return members + invites
    }
    case 'apiKeys': return await new Parse.Query('AdminApiKey').equalTo('workspace', workspace).count(MASTER)
    case 'knowledgeModels': return await new Parse.Query('KnowledgeModel').equalTo('workspace', workspace).count(MASTER)
    case 'assistants': return await new Parse.Query('SupportAgent').equalTo('workspace', workspace).count(MASTER)
    case 'faqs': return await new Parse.Query('Faq').matchesQuery('knowledgeModel', new Parse.Query('KnowledgeModel').equalTo('workspace', workspace)).count(MASTER)
    case 'contacts': {
      const list = await projects()
      return list.length ? await new Parse.Query('EndUser').containedIn('project', list).notContainedIn('externalId', SYSTEM_EXTERNAL_IDS).count(MASTER) : 0
    }
    case 'storageBytes': return await readUsage(workspaceId, 'storageBytes')
  }
}

/** Refuse (402) when `add` more of a gauge would pass the plan's limit. */
export async function checkGauge(ref: WorkspaceRef | null | undefined, metric: Gauge, add = 1): Promise<void> {
  const workspaceId = idOf(ref)
  if (!workspaceId || add <= 0) return
  const plan = await workspacePlan(ref)
  const limit = plan.limits[metric]
  if (limit === null || plan.soft[metric]) return
  const used = await countGauge(workspaceId, metric)
  if (!withinLimit(limit, used, add)) throw planLimitError(plan, metric, limit, used)
}

export async function hasFeature(ref: WorkspaceRef | null | undefined, feature: Feature): Promise<boolean> {
  return (await workspacePlan(ref)).features[feature]
}

/** Refuse (402) unless the plan includes the feature. Workers call hasFeature instead and pause. */
export async function assertFeature(ref: WorkspaceRef | null | undefined, feature: Feature): Promise<void> {
  const plan = await workspacePlan(ref)
  if (!plan.features[feature]) throw planFeatureError(plan, feature)
}

export type UsageSnapshot = {
  plan: { id: string, name: string }
  unlimited: boolean
  limits: Plan['limits']
  soft: Plan['soft']
  features: Plan['features']
  apiPerMinute: number | null
  emailLogDays: number | null
  usage: Record<Metric, number>
}

/** The plan and everything counted against it, for the Usage settings. */
export async function usageSnapshot(ref: WorkspaceRef): Promise<UsageSnapshot> {
  const workspaceId = idOf(ref)
  const plan = await workspacePlan(ref)
  const gauges = await Promise.all(GAUGES.map(async metric => [metric, await countGauge(workspaceId, metric).catch(() => 0)] as const))
  const counters = await Promise.all(COUNTERS.map(async metric => [metric, await readUsage(workspaceId, metric)] as const))
  return {
    plan: { id: plan.id, name: plan.name },
    unlimited: isUnlimited(plan),
    limits: plan.limits,
    soft: plan.soft,
    features: plan.features,
    apiPerMinute: plan.apiPerMinute,
    emailLogDays: plan.emailLogDays,
    usage: Object.fromEntries([...gauges, ...counters]) as Record<Metric, number>
  }
}

/** Copy changed counters into WorkspaceUsage, so a Redis restart loses at most a few minutes of counting. */
export async function flushUsage(max = 1000): Promise<number> {
  const redis = useRedis()
  const keys = await redis.spop(DIRTY_KEY, max) as string[]
  if (!keys.length) return 0
  const Parse = useParse()
  const values = await redis.mget(...keys)
  let written = 0
  for (const [i, key] of keys.entries()) {
    const parsed = parseUsageKey(key)
    if (!parsed || values[i] === null) continue
    const workspace = Parse.Object.extend('Workspace').createWithoutData(parsed.workspaceId)
    try {
      const row = await new Parse.Query('WorkspaceUsage').equalTo('workspace', workspace).equalTo('period', parsed.period).equalTo('metric', parsed.metric).first(MASTER)
        || new (Parse.Object.extend('WorkspaceUsage'))()
      row.set('workspace', workspace)
      row.set('period', parsed.period)
      row.set('metric', parsed.metric)
      row.set('value', Math.max(0, Number(values[i])))
      await row.save(null, MASTER)
      written++
    } catch (error) {
      // Try again next time.
      await redis.sadd(DIRTY_KEY, key).catch(() => {})
      console.warn('[usage] flush failed:', (error as Error).message)
    }
  }
  return written
}
