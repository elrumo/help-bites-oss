// Marketing email: a project's newsletter settings, campaigns and sequences.
// Shared by the server (validation) and the panel (forms, labels).

import { TOPIC_KEY_RE } from './contacts'

export type MarketingTopic = { key: string, name: string, description: string }

export type MarketingConfig = {
  /** Sign-ups get a confirmation email and stay pending until they click it. */
  doubleOptIn: boolean
  /** Newsletters a contact can opt out of one by one on the preferences page. */
  topics: MarketingTopic[]
  /** Required by CAN-SPAM in every marketing email: `{{project.address}}`. */
  postalAddress: string
  /** Where the sign-up form and the confirmation link send people afterwards. */
  confirmRedirectUrl: string
  /** Marketing mail can come from its own address and domain, to keep its reputation apart. */
  fromName: string
  fromEmail: string
  mailDomain: string
}

export const DEFAULT_MARKETING_CONFIG: MarketingConfig = { doubleOptIn: true, topics: [], postalAddress: '', confirmRedirectUrl: '', fromName: '', fromEmail: '', mailDomain: '' }

const MAX_TOPICS = 20
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

export function normalizeMarketingConfig(value: unknown): MarketingConfig {
  return validateMarketingConfig(value).config
}

/** Partial: only the keys sent change. */
export function validateMarketingConfig(value: unknown, base: MarketingConfig = DEFAULT_MARKETING_CONFIG): { config: MarketingConfig, errors: string[] } {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const errors: string[] = []
  const config: MarketingConfig = { ...base, topics: [...base.topics] }
  if ('doubleOptIn' in raw) config.doubleOptIn = raw.doubleOptIn !== false
  if ('postalAddress' in raw) config.postalAddress = text(raw.postalAddress, 300)
  if ('fromName' in raw) config.fromName = text(raw.fromName, 80)
  if ('confirmRedirectUrl' in raw) {
    const url = text(raw.confirmRedirectUrl, 500)
    if (url && !/^https?:\/\/[^\s"'<>]+$/i.test(url)) errors.push('confirmRedirectUrl must be an http(s) URL')
    else config.confirmRedirectUrl = url
  }
  if ('fromEmail' in raw) {
    const email = text(raw.fromEmail, 200).toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('fromEmail must be an email address')
    else config.fromEmail = email
  }
  if ('mailDomain' in raw) {
    const domain = text(raw.mailDomain, 253).toLowerCase()
    if (domain && !DOMAIN_RE.test(domain)) errors.push('mailDomain must be a domain such as news.example.com')
    else config.mailDomain = domain
  }
  if (config.fromEmail && config.mailDomain && !config.fromEmail.endsWith(`@${config.mailDomain}`)) errors.push('fromEmail must be on mailDomain')
  if ('topics' in raw) {
    const list = Array.isArray(raw.topics) ? raw.topics : []
    if (list.length > MAX_TOPICS) errors.push(`At most ${MAX_TOPICS} topics`)
    const topics: MarketingTopic[] = []
    for (const item of list.slice(0, MAX_TOPICS)) {
      const t = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      const key = text(t.key, 40).toLowerCase()
      if (!TOPIC_KEY_RE.test(key)) { errors.push(`Topic key "${key}": use a-z, 0-9, - and _`); continue }
      if (topics.some(x => x.key === key)) { errors.push(`Topic "${key}" twice`); continue }
      topics.push({ key, name: text(t.name, 80) || key, description: text(t.description, 200) })
    }
    config.topics = topics
  }
  return { config, errors }
}

// ---- campaigns ----------------------------------------------------------------------

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'canceled'
export const CAMPAIGN_STATUSES: CampaignStatus[] = ['draft', 'scheduled', 'sending', 'paused', 'sent', 'canceled']

/** What an operator may ask a campaign to become, from where it is. `sending` means "send now". */
const MOVES: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['scheduled', 'sending', 'canceled'],
  scheduled: ['draft', 'sending', 'canceled'],
  sending: ['paused', 'canceled'],
  paused: ['sending', 'canceled'],
  sent: [],
  canceled: []
}

export function canMoveCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
  return MOVES[from]?.includes(to) || false
}

export type CampaignStats = {
  /** Recipients when sending started (subscribed, matching the audience). */
  audience: number
  sent: number
  failed: number
  suppressed: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  unsubscribed: number
}

export const EMPTY_CAMPAIGN_STATS: CampaignStats = { audience: 0, sent: 0, failed: 0, suppressed: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0 }

/**
 * Campaign numbers from the log's per-status counts. Each log row holds its
 * furthest status, so "opened" includes everyone who later clicked or
 * unsubscribed, and "delivered" everyone who got that far.
 */
export function campaignStatsFrom(byStatus: Record<string, number>, audience: number): CampaignStats {
  const n = (...keys: string[]) => keys.reduce((sum, k) => sum + (byStatus[k] || 0), 0)
  return {
    audience,
    sent: n('scheduled', 'sent', 'delivered', 'opened', 'clicked', 'unsubscribed', 'bounced', 'complained'),
    failed: n('failed'),
    suppressed: n('suppressed'),
    delivered: n('delivered', 'opened', 'clicked', 'unsubscribed', 'complained'),
    opened: n('opened', 'clicked', 'unsubscribed'),
    clicked: n('clicked'),
    bounced: n('bounced'),
    complained: n('complained'),
    unsubscribed: n('unsubscribed')
  }
}

export type Campaign = {
  id: string
  projectId: string
  name: string
  status: CampaignStatus
  /** The template it sends (send key or id); its design is frozen when sending starts. */
  template: string
  templateName: string
  /** A blog post it sends instead of a template (Project → Blog → Send as newsletter); '' for a template campaign. */
  blogPostId: string
  subject: string
  audience: { segment: string, topic: string }
  scheduledAt: string | null
  startedAt: string | null
  finishedAt: string | null
  testMode: boolean
  stats: CampaignStats
  lastError: string
  createdAt: string | null
  updatedAt: string | null
}

/** The log batch id every recipient of a campaign shares. */
export const campaignBatchId = (campaignId: string) => `cm_${campaignId}`

// ---- sequences ---------------------------------------------------------------------

export type SequenceTrigger = { type: 'subscribed' | 'event' | 'manual', topic?: string, event?: string }
export type SequenceStep = { id: string, delayMinutes: number, template: string, subject?: string }
export type SequenceStatus = 'draft' | 'active' | 'paused'

export type Sequence = {
  id: string
  projectId: string
  name: string
  status: SequenceStatus
  trigger: SequenceTrigger
  steps: SequenceStep[]
  stats: { enrolled: number, completed: number, exited: number, active: number }
  createdAt: string | null
  updatedAt: string | null
}

export const MAX_SEQUENCE_STEPS = 20
export const EVENT_NAME_RE = /^[A-Za-z0-9][\w.:-]{0,79}$/

export function validateSequenceInput(value: unknown, base?: Pick<Sequence, 'trigger' | 'steps'>): { trigger: SequenceTrigger, steps: SequenceStep[], errors: string[] } {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const errors: string[] = []
  let trigger: SequenceTrigger = base?.trigger || { type: 'manual' }
  if (raw.trigger !== undefined) {
    const t = (raw.trigger && typeof raw.trigger === 'object' ? raw.trigger : {}) as Record<string, unknown>
    if (t.type === 'subscribed') trigger = { type: 'subscribed', ...(typeof t.topic === 'string' && t.topic ? { topic: t.topic.trim().toLowerCase() } : {}) }
    else if (t.type === 'event') {
      const event = text(t.event, 80)
      if (!EVENT_NAME_RE.test(event)) errors.push('The trigger event needs a name such as trial_started')
      trigger = { type: 'event', event }
    } else if (t.type === 'manual') trigger = { type: 'manual' }
    else errors.push('trigger.type must be subscribed, event or manual')
  }
  let steps = base?.steps || []
  if (raw.steps !== undefined) {
    const list = Array.isArray(raw.steps) ? raw.steps : []
    if (list.length > MAX_SEQUENCE_STEPS) errors.push(`At most ${MAX_SEQUENCE_STEPS} steps`)
    steps = []
    for (const [i, item] of list.slice(0, MAX_SEQUENCE_STEPS).entries()) {
      const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      const delay = Number(s.delayMinutes ?? 0)
      const template = text(s.template, 120)
      if (!Number.isInteger(delay) || delay < 0 || delay > 60 * 24 * 365) errors.push(`Step ${i + 1}: the delay must be 0 to 525600 minutes`)
      if (!template) errors.push(`Step ${i + 1}: pick a template`)
      steps.push({ id: text(s.id, 40) || `step_${i + 1}_${Math.random().toString(36).slice(2, 8)}`, delayMinutes: Math.max(0, Math.floor(delay) || 0), template, ...(text(s.subject, 200) ? { subject: text(s.subject, 200) } : {}) })
    }
  }
  return { trigger, steps, errors }
}

/** When step `index` is due, counted from when the previous one went (or enrollment). */
export function nextStepAt(steps: SequenceStep[], index: number, from: Date): Date | null {
  const step = steps[index]
  return step ? new Date(from.getTime() + step.delayMinutes * 60_000) : null
}
