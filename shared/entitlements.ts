// What a workspace's plan lets it use. The community edition puts every
// workspace on UNLIMITED_PLAN, so nothing here ever stops a self-hosted
// install; the cloud edition defines Free and Pro.
//
// Gauges are counted from the data as it is (projects you have now).
// Counters add up over a period (conversations this month) and are kept in
// Redis by server/utils/usage.ts. Features are on or off.

export const GAUGES = ['projects', 'seats', 'apiKeys', 'knowledgeModels', 'assistants', 'faqs', 'contacts', 'storageBytes'] as const
export const COUNTERS = ['conversations', 'emails', 'emailsPerDay', 'aiCredits'] as const
export const FEATURES = ['campaigns', 'sequences', 'contactSources', 'eventWebhooks', 'customSendingDomain', 'removeBranding', 'byoLlm', 'emailAiUltra', 'multiWorkspace', 'legalDocs', 'customPublicDomain', 'inboundEmail'] as const

export type Gauge = typeof GAUGES[number]
export type Counter = typeof COUNTERS[number]
export type Metric = Gauge | Counter
export type Feature = typeof FEATURES[number]

/** The period a counter adds up over; storage only ever grows and shrinks, so it never resets. */
export const COUNTER_PERIODS: Record<Counter | 'storageBytes', 'month' | 'day' | 'all'> = {
  conversations: 'month',
  emails: 'month',
  emailsPerDay: 'day',
  aiCredits: 'month',
  storageBytes: 'all'
}

export type Plan = {
  id: string
  name: string
  /** null: no limit. */
  limits: Record<Metric, number | null>
  /** Counters that are counted but never refuse (Pro's conversations: past the limit is a conversation about upgrading, not an outage). */
  soft: Partial<Record<Metric, boolean>>
  features: Record<Feature, boolean>
  /** Admin API calls per minute per workspace; null: unlimited. */
  apiPerMinute: number | null
  /** How long the email log is kept; null: the server's EMAIL_LOG_RETENTION_DAYS. */
  emailLogDays: number | null
}

export const UNLIMITED_PLAN: Plan = Object.freeze({
  id: 'unlimited',
  name: 'Unlimited',
  limits: Object.fromEntries([...GAUGES, ...COUNTERS].map(metric => [metric, null])) as Record<Metric, null>,
  soft: {},
  features: Object.fromEntries(FEATURES.map(feature => [feature, true])) as Record<Feature, true>,
  apiPerMinute: null,
  emailLogDays: null
}) as Plan

export const METRIC_LABELS: Record<Metric, { one: string, many: string }> = {
  projects: { one: 'project', many: 'projects' },
  seats: { one: 'teammate', many: 'teammates' },
  apiKeys: { one: 'API key', many: 'API keys' },
  knowledgeModels: { one: 'knowledge model', many: 'knowledge models' },
  assistants: { one: 'assistant', many: 'assistants' },
  faqs: { one: 'FAQ', many: 'FAQs' },
  contacts: { one: 'contact', many: 'contacts' },
  storageBytes: { one: 'byte of storage', many: 'bytes of storage' },
  conversations: { one: 'new conversation this month', many: 'new conversations this month' },
  emails: { one: 'email this month', many: 'emails this month' },
  emailsPerDay: { one: 'email today', many: 'emails today' },
  aiCredits: { one: 'AI credit this month', many: 'AI credits this month' }
}

export const FEATURE_LABELS: Record<Feature, string> = {
  campaigns: 'Campaigns',
  sequences: 'Sequences',
  contactSources: 'Database sync',
  eventWebhooks: 'Event webhooks',
  customSendingDomain: 'A custom sending domain',
  removeBranding: 'Removing the HelpBites branding',
  byoLlm: 'Your own AI provider',
  emailAiUltra: 'The Ultra AI designer',
  multiWorkspace: 'More workspaces',
  legalDocs: 'Hosted legal documents',
  customPublicDomain: 'Your own domain for public pages',
  inboundEmail: 'Support email addresses'
}

/** The 402 body's `data`: enough for the panel to say what ran out and offer the way up. */
export type PlanLimitData =
  | { code: 'plan_limit', metric: Metric, limit: number, used: number, plan: string }
  | { code: 'plan_feature', feature: Feature, plan: string }

/** Whether every limit is off and every feature on: nothing to show the operator. */
export function isUnlimited(plan: Plan): boolean {
  return Object.values(plan.limits).every(limit => limit === null) && Object.values(plan.features).every(Boolean)
}

/** Room for `add` more under `limit` (null: always). */
export function withinLimit(limit: number | null, used: number, add = 1): boolean {
  return limit === null || used + add <= limit
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

/** "250 MB of storage", "3 projects": a limit as the operator reads it. */
export function describeLimit(metric: Metric, limit: number): string {
  if (metric === 'storageBytes') return `${formatBytes(limit)} of storage`
  const label = METRIC_LABELS[metric]
  return `${limit.toLocaleString('en-US')} ${limit === 1 ? label.one : label.many}`
}

/** A plan from config (ee plans, HELPBITES_PLANS_JSON): unknown keys are refused, missing ones are unlimited / off. */
export function definePlan(input: { id: string, name: string, limits?: Partial<Record<Metric, number | null>>, soft?: Partial<Record<Metric, boolean>>, features?: Partial<Record<Feature, boolean>>, apiPerMinute?: number | null, emailLogDays?: number | null }): Plan {
  if (!input?.id || !input.name) throw new Error('A plan needs an id and a name')
  for (const key of Object.keys(input.limits || {})) if (![...GAUGES, ...COUNTERS].includes(key as Metric)) throw new Error(`Plan ${input.id}: unknown limit "${key}"`)
  for (const key of Object.keys(input.features || {})) if (!FEATURES.includes(key as Feature)) throw new Error(`Plan ${input.id}: unknown feature "${key}"`)
  const limits = Object.fromEntries([...GAUGES, ...COUNTERS].map((metric) => {
    const value = input.limits?.[metric]
    if (value !== undefined && value !== null && !(Number.isInteger(value) && value >= 0)) throw new Error(`Plan ${input.id}: ${metric} must be a whole number or null`)
    return [metric, value ?? null]
  })) as Record<Metric, number | null>
  const features = Object.fromEntries(FEATURES.map(feature => [feature, input.features?.[feature] === true])) as Record<Feature, boolean>
  return { id: input.id, name: input.name, limits, soft: { ...input.soft }, features, apiPerMinute: input.apiPerMinute ?? null, emailLogDays: input.emailLogDays ?? null }
}
