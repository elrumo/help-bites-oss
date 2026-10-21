// "Needs attention": the one list of things that wait on you, across the
// workspace or inside one project. Built by server/utils/attention.ts from rows
// that already exist; the panel and the native app word each kind
// (`attention.<kind>` in i18n/locales/en.json, AttentionModels.swift natively).
// The workspace list leaves unread conversations to the badge on the inbox (kept
// live beside it as `unreadMessages`); a project's own list shows them as `unread`.

export const ATTENTION_KINDS = ['unread', 'drafts', 'sync', 'bounces', 'alerts', 'paused', 'errors', 'documents', 'triage'] as const
export type AttentionKind = typeof ATTENTION_KINDS[number]

export type AttentionItem = {
  /** Stable for the same thing from one call to the next, so a list can keep its place. */
  key: string
  kind: AttentionKind
  /** The project it is about; '' for the workspace itself (`paused`). */
  projectId: string
  /** How many things it covers: drafts waiting, emails bounced, alerts fired. 1 for a single integration. */
  count: number
  /** What it names, to word it with: the failing integration, the newest alert's title. Empty when the count says it all. */
  value: string
  /** The error or reason behind it, when there is one. */
  detail: string
  /** The web section that deals with it, as the project overview links to sections (`email?view=log`). */
  section: string
  /** When it last happened, ISO; null when unknown. */
  at: string | null
}

export type WorkspaceAttention = {
  /** Unread customer messages outside the archive: the inbox badge. */
  unreadMessages: number
  /** Sum of `count`s: what the badge on Overview shows. */
  total: number
  items: AttentionItem[]
}

/** Most recent first, then by kind in the order above, so a refresh does not shuffle rows that did not change. */
export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => (b.at || '').localeCompare(a.at || '') || ATTENTION_KINDS.indexOf(a.kind) - ATTENTION_KINDS.indexOf(b.kind) || a.key.localeCompare(b.key))
}

export function attentionTotal(items: AttentionItem[]): number {
  return items.reduce((sum, item) => sum + item.count, 0)
}

/** Where an alert fired in the last day still counts; older ones are history, not something waiting. */
export const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000
/** How far back a bounce or failed send still counts. */
export const EMAIL_FAILURE_WINDOW_DAYS = 7
