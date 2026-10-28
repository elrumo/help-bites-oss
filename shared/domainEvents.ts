// Domain events: one vocabulary for "something happened in a project". The
// server publishes them through server/utils/domainEvents.ts; webhook
// endpoints subscribe by filter, and automations (sequences started by an
// event) and in-process handlers listen on the same bus. Shared by the
// server, the panel (the endpoint editor) and the docs.

export type DomainEventGroup = 'contact' | 'conversation' | 'feedback' | 'board' | 'changelog' | 'errors' | 'github' | 'email' | 'cms' | 'blog' | 'onboarding'

export type DomainEventDef = { type: string, group: DomainEventGroup, label: string, description: string }

/** Every event HelpBites publishes. `data` always carries the ids of what changed, never whole rows. */
export const DOMAIN_EVENTS: DomainEventDef[] = [
  { type: 'contact.created', group: 'contact', label: 'Contact created', description: 'A person was added: by your app, an import, a form or a chat.' },
  { type: 'contact.subscription_changed', group: 'contact', label: 'Subscription changed', description: 'Someone subscribed, unsubscribed or changed the topics they opted out of.' },
  { type: 'conversation.created', group: 'conversation', label: 'Conversation started', description: 'A customer opened a new conversation.' },
  { type: 'conversation.status_changed', group: 'conversation', label: 'Conversation status changed', description: 'A conversation was resolved, closed or reopened.' },
  { type: 'conversation.feedback_linked', group: 'conversation', label: 'Conversation linked to a post', description: 'An operator linked a conversation to a feedback post, or took the link off (data.linked).' },
  { type: 'feedback.post.created', group: 'feedback', label: 'Feedback post created', description: 'A new post on the feedback board.' },
  { type: 'feedback.post.status_changed', group: 'feedback', label: 'Feedback status changed', description: 'A post moved to another status (planned, in progress, done).' },
  { type: 'feedback.post.voted', group: 'feedback', label: 'Feedback vote', description: 'Someone voted on a post.' },
  { type: 'board.item.created', group: 'board', label: 'Board item created', description: 'A card was added to the project board.' },
  { type: 'board.item.status_changed', group: 'board', label: 'Board item status changed', description: 'A card moved to another status.' },
  { type: 'board.item.assigned', group: 'board', label: 'Board item assigned', description: 'A card was assigned to someone, reassigned or unassigned (data.from, data.to are member ids).' },
  { type: 'board.item.updated', group: 'board', label: 'Board item updated', description: 'A card changed title, kind, epic, release, priority, labels, target date or visibility (data.changes lists field, from, to).' },
  { type: 'board.item.commented', group: 'board', label: 'Board item commented', description: 'An operator or assistant commented on a card.' },
  { type: 'changelog.entry.published', group: 'changelog', label: 'Changelog entry published', description: 'An entry went public. Followers of its linked posts are emailed.' },
  { type: 'errors.filed_on_board', group: 'errors', label: 'Error filed on the board', description: 'An operator filed an error from the tracker as a board item.' },
  { type: 'github.commit.referenced', group: 'github', label: 'Commit references an item', description: 'A pushed commit message mentions #12 (a board item or a feedback post).' },
  { type: 'github.pull_request.merged', group: 'github', label: 'Pull request merged', description: 'A pull request merged into the default branch.' },
  { type: 'email.suppressed', group: 'email', label: 'Address suppressed', description: 'An address bounced, complained or was blocked.' },
  { type: 'cms.entry.published', group: 'cms', label: 'Page published', description: 'A page or entry was published.' },
  { type: 'cms.entry.unpublished', group: 'cms', label: 'Page unpublished', description: 'A page or entry was taken down.' },
  { type: 'blog.post.published', group: 'blog', label: 'Blog post published', description: 'A post went public: published now, or its scheduled moment came.' },
  { type: 'blog.post.updated', group: 'blog', label: 'Blog post updated', description: 'A public post was changed.' },
  { type: 'blog.post.unpublished', group: 'blog', label: 'Blog post unpublished', description: 'A public post stopped being public.' },
  { type: 'blog.post.deleted', group: 'blog', label: 'Blog post deleted', description: 'A public post was deleted.' },
  { type: 'onboarding.completed', group: 'onboarding', label: 'Onboarding finished', description: 'A person finished (or skipped) an onboarding flow.' }
]

export type DomainEventType = string

export const DOMAIN_EVENT_TYPES: string[] = DOMAIN_EVENTS.map(e => e.type)

/**
 * Events the project's original single webhook (Settings → Event webhook)
 * keeps receiving. New events go to endpoints, which choose what they want.
 */
export const LEGACY_WEBHOOK_EVENTS = ['contact.subscription_changed', 'email.suppressed', 'cms.entry.published', 'cms.entry.unpublished', 'blog.post.published', 'blog.post.updated', 'blog.post.unpublished', 'blog.post.deleted']

export const WEBHOOK_ENDPOINT_LIMITS = { endpoints: 10, filters: 30, description: 120 }

/** `*` (everything), `group.*` (one group), or an exact event type. */
export function isEventFilter(value: string): boolean {
  if (value === '*') return true
  if (value.endsWith('.*')) return DOMAIN_EVENTS.some(e => e.group === value.slice(0, -2))
  return DOMAIN_EVENT_TYPES.includes(value)
}

export function matchesEventFilter(type: string, filters: readonly string[]): boolean {
  return filters.some(filter => filter === '*' || filter === type || (filter.endsWith('.*') && type.startsWith(filter.slice(0, -1))))
}

/** Filters as the API receives them: trimmed, deduped, known. An empty list means everything. */
export function cleanEventFilters(value: unknown): { filters: string[], errors: string[] } {
  if (value === undefined || value === null) return { filters: ['*'], errors: [] }
  if (!Array.isArray(value)) return { filters: ['*'], errors: ['events must be a list'] }
  const filters = [...new Set(value.map(v => String(v ?? '').trim()).filter(Boolean))]
  if (filters.length > WEBHOOK_ENDPOINT_LIMITS.filters) return { filters: ['*'], errors: [`At most ${WEBHOOK_ENDPOINT_LIMITS.filters} event filters`] }
  const unknown = filters.filter(f => !isEventFilter(f))
  if (unknown.length) return { filters: ['*'], errors: [`Unknown event: ${unknown.slice(0, 3).join(', ')}`] }
  return { filters: filters.length ? filters : ['*'], errors: [] }
}

/** What a webhook endpoint (or an in-process handler) receives. */
export type DomainEvent = { id: string, type: string, createdAt: string, projectId: string, data: Record<string, unknown> }

/** An endpoint as the panel and the API show it; the signing secret appears once, when it is made. */
export type WebhookEndpointDto = {
  id: string
  projectId: string
  url: string
  description: string
  events: string[]
  enabled: boolean
  /** Only on create and on rotate. */
  secret?: string
  lastDeliveryAt: string | null
  lastStatus: 'delivered' | 'failed' | 'pending' | null
  createdAt: string | null
}

export type WebhookDeliveryDto = { id: string, endpointId: string, type: string, status: 'pending' | 'delivered' | 'failed', attempts: number, lastError: string, createdAt: string | null, deliveredAt: string | null }
