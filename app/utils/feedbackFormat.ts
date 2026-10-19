import type { FeedbackBoardConfig, FeedbackPost, FeedbackStatusDefinition, FeedbackTypeDefinition } from '#shared/feedback'

// Small display helpers shared by the embed board and the panel.

const relative = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null

/** "just now", "3 hours ago", "2 weeks ago"; a plain date past a year. */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return ''
  const then = new Date(value)
  const seconds = (then.getTime() - Date.now()) / 1000
  if (Number.isNaN(seconds)) return ''
  const abs = Math.abs(seconds)
  if (abs < 45) return 'just now'
  if (!relative || abs > 365 * 86400) return then.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2629800]]
  let unit: Intl.RelativeTimeFormatUnit = 'minute'
  let size = 60
  for (const [u, s] of units) if (abs >= s) { unit = u; size = s }
  return relative.format(Math.round(seconds / size), unit)
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function monthLabel(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function feedbackStatusFor(config: FeedbackBoardConfig | null | undefined, key: string): FeedbackStatusDefinition {
  return config?.statuses.find(s => s.key === key) || { key, label: key || 'Open', category: 'open', color: 'neutral' }
}

export function feedbackTypeFor(config: FeedbackBoardConfig | null | undefined, key: string): FeedbackTypeDefinition | null {
  if (!key) return null
  return config?.types.find(t => t.key === key) || { key, label: key, icon: '' }
}

export function feedbackPlatformLabel(config: FeedbackBoardConfig | null | undefined, key: string): string {
  if (!key) return ''
  return config?.platforms.find(p => p.key === key)?.label || key
}

const VIEWER_FIELDS = ['hasVoted', 'isMine', 'canEdit', 'canDelete', 'canComment', 'canVote', 'subscribed', 'muted', 'unread'] as const

/** A live event carries no viewer fields (nor whether you reacted); keep ours when merging it in. */
export function mergeFeedbackPost(local: FeedbackPost | undefined, incoming: FeedbackPost): FeedbackPost {
  if (!local) return { hasVoted: false, isMine: false, canEdit: false, canDelete: false, ...incoming }
  const merged: FeedbackPost = { ...local, ...incoming, author: incoming.author?.name || !local.author ? incoming.author : { ...incoming.author!, name: local.author.name } }
  for (const key of VIEWER_FIELDS) (merged as Record<string, unknown>)[key] = incoming[key] ?? local[key]
  const mine = new Set((local.reactions || []).filter(r => r.reacted).map(r => r.key))
  merged.reactions = (incoming.reactions || []).map(r => (r.reacted === undefined ? { ...r, reacted: mine.has(r.key) } : r))
  return merged
}
