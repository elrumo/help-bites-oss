// One person's history across HelpBites: what GET /v1/contacts/:id/activity
// returns. The panel's contact drawer and the native app render this list
// instead of making a call per kind of record.

export const ACTIVITY_TYPES = ['joined', 'conversation', 'feedback_post', 'feedback_comment', 'vote', 'email', 'sequence', 'payment', 'subscription', 'onboarding'] as const
export type ActivityType = typeof ACTIVITY_TYPES[number]

/** Where an item leads in the panel: `kind` is a section, `id` the record. */
export type ActivityRef = { kind: 'conversation' | 'feedback_post' | 'email_log' | 'sequence' | 'onboarding_flow' | 'stripe', id: string }

export type ActivityItem = {
  /** Stable per record, so a client can key and de-duplicate. */
  id: string
  type: ActivityType
  /** ISO time the thing happened. */
  at: string
  title: string
  detail: string
  ref: ActivityRef | null
}

export const ACTIVITY_LIMITS = { default: 50, max: 200 }

/** Newest first; the cursor is the `at` of the last item you have. */
export type ContactActivity = { items: ActivityItem[], nextBefore: string | null }

/** `types=email,vote` → the known ones; empty means all. */
export function readActivityTypes(value: unknown): ActivityType[] {
  const list = (typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value.map(String) : []).map(s => s.trim()).filter(Boolean)
  return list.filter((t): t is ActivityType => (ACTIVITY_TYPES as readonly string[]).includes(t))
}

/** Merge per-kind lists into one newest-first page; `nextBefore` is set when more remain. */
export function mergeActivity(lists: ActivityItem[][], limit: number): ContactActivity {
  const all = lists.flat().sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
  const items = all.slice(0, limit)
  return { items, nextBefore: all.length > limit ? items.at(-1)?.at ?? null : null }
}
