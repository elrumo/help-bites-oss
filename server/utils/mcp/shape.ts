// What a tool's answer costs the assistant. The /v1 routes serve the panel, so they send every field of every record, pretty
// printed and full of nulls. An assistant pays for each of those tokens on every turn that follows, so the answer is shaped
// here, at the last step and for the MCP only: empty fields are left out, the JSON is compact, and the heaviest lists
// have a short default view (`detail: "brief"`) with the whole record one `detail: "full"` away.

type Json = Record<string, any>
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)

/** The value without null, empty strings, empty lists and empty objects (false and 0 are answers, so they stay). */
export function prune(value: unknown, depth = 0): unknown {
  if (depth > 40) return value
  if (Array.isArray(value)) return value.map(item => prune(item, depth + 1))
  if (!isObject(value)) return value
  const out: Json = {}
  for (const [key, item] of Object.entries(value)) {
    const kept = prune(item, depth + 1)
    if (kept === null || kept === '' || (Array.isArray(kept) && !kept.length) || (isObject(kept) && !Object.keys(kept).length)) continue
    out[key] = kept
  }
  return out
}

const pick = (source: unknown, keys: string[]): Json => {
  const out: Json = {}
  if (isObject(source)) for (const key of keys) if (source[key] !== undefined) out[key] = source[key]
  return out
}
const each = (list: unknown, keys: string[]) => (Array.isArray(list) ? list.map(item => pick(item, keys)) : undefined)
const clip = (text: unknown, max: number) => (typeof text === 'string' && text.length > max ? `${text.slice(0, max)}… (${text.length} characters: detail "full" has the rest)` : text)

type Brief = (data: Json) => unknown

/** Short default views, by tool name. Each keeps what an assistant acts on (ids, keys, status) and drops presentation and bookkeeping. */
export const BRIEFS: Record<string, Brief> = {
  // The first call of every session. A project's look, widget, hub, blog, legal and email settings are the panel's: get_project_setup and update_project_settings own them.
  list_projects: data => ({
    projects: (data.projects as Json[] | undefined)?.map(project => ({
      ...pick(project, ['id', 'name', 'slug', 'siteUrl', 'publicKey', 'hiddenSections']),
      board: isObject(project.board) ? { enabled: project.board.enabled, statuses: each(project.board.statuses, ['key', 'label', 'category', 'isDefault']), labels: each(project.board.labels, ['key', 'label']) } : undefined,
      feedback: isObject(project.feedback) ? { enabled: project.feedback.enabled, statuses: each(project.feedback.statuses, ['key', 'label', 'category', 'isDefault']), types: each(project.feedback.types, ['key', 'label']), platforms: each(project.feedback.platforms, ['key', 'label']), tags: each(project.feedback.tags, ['key', 'label']) } : undefined
    })),
    ...pick(data, ['workspace'])
  }),

  // A card is ~1.3 KB in full; the title and where it stands are what a search needs.
  list_board_items: data => ({
    ...pick(data, ['total']),
    items: (data.items as Json[] | undefined)?.map(item => ({
      ...pick(item, ['id', 'number', 'title', 'kind', 'status', 'priority', 'assigneeId', 'labels', 'epic', 'release', 'progress', 'targetDate', 'estimate', 'voteCount', 'updatedAt']),
      description: clip(item.description, 160),
      attachments: Array.isArray(item.attachments) && item.attachments.length ? item.attachments.length : undefined,
      feedbackPostIds: item.feedbackPostIds,
      conversationIds: item.conversationIds
    }))
  }),

  // Each row names its customer inline instead of pointing into an `endUsers` map; the unread, status and view counts stay.
  list_conversations: (data) => {
    const users = (isObject(data.endUsers) ? data.endUsers : {}) as Json
    return {
      conversations: (data.conversations as Json[] | undefined)?.map(row => ({
        ...pick(row, ['id', 'projectId', 'subject', 'status', 'type', 'priority', 'assigneeId', 'tags', 'channel', 'lastMessageAt', 'lastMessageFrom', 'unreadByAgent', 'feedbackPostIds']),
        customer: pick(users[row.endUserId], ['id', 'name', 'email']),
        preview: clip(row.lastMessagePreview, 160)
      })),
      ...pick(data, ['hasMore', 'totalUnread', 'counts', 'viewCounts'])
    }
  },

  // `body` and `bodyHtml` carry the same text twice, and `excerpt` a third time: a list needs the title, the state and a taste of the body.
  list_changelog_entries: data => ({
    entries: (data.entries as Json[] | undefined)?.map(entry => ({
      ...pick(entry, ['id', 'number', 'slug', 'title', 'summary', 'tag', 'area', 'status', 'reviewStatus', 'publishedAt', 'releaseId', 'version', 'pinned', 'commentCount', 'feedbackPostIds', 'boardItemIds', 'conversationIds', 'updatedAt']),
      body: clip(entry.body, 200)
    }))
  }),

  // A post's reactions, permissions, subscription flags and changelog draft are the board's own; the words, the votes and where it stands are what an assistant works with.
  list_feedback: data => ({
    ...pick(data, ['total']),
    posts: (data.posts as Json[] | undefined)?.map(post => ({
      ...pick(post, ['id', 'number', 'title', 'type', 'platform', 'tags', 'status', 'voteCount', 'commentCount', 'hidden', 'featured', 'locked', 'showOnChangelog', 'completedAt', 'lastActivityAt', 'createdAt']),
      body: clip(post.body, 240),
      author: pick(post.author, ['name', 'isTeam', 'email']),
      duplicateOf: post.duplicateOf ? pick(post.duplicateOf, ['id', 'number', 'title']) : undefined,
      adminNote: clip(post.adminNote, 160),
      attachments: Array.isArray(post.attachments) && post.attachments.length ? post.attachments.length : undefined
    }))
  }),

  // GlitchTip and Sentry rows are the tracker's own issue JSON (project, metadata, stats...); these are the fields every provider has.
  list_errors: data => ({
    ...pick(data, ['next']),
    issues: each(data.issues, ['id', 'shortId', 'title', 'culprit', 'level', 'status', 'count', 'userCount', 'firstSeen', 'lastSeen', 'url', 'permalink', 'linkId', 'linkLabel', 'provider'])
  }),

  get_me: data => ({
    ...pick(data, ['role', 'edition']),
    agent: pick(data.agent, ['id', 'name', 'email']),
    workspaces: each(data.workspaces, ['id', 'name', 'role']),
    plan: pick(data.plan, ['id', 'name', 'unlimited']),
    // Only what the plan includes: a list of off switches is noise.
    features: isObject(data.features) ? Object.keys(data.features).filter(key => data.features[key] === true) : undefined
  })
}

/** The answer for a tool, shaped for an assistant. `full` keeps every field the route sent (empty ones are still dropped). */
export function shapeResult(toolName: string, data: unknown, detail: 'brief' | 'full' = 'brief'): unknown {
  const brief = BRIEFS[toolName]
  const shaped = brief && detail !== 'full' && isObject(data) ? brief(data) : data
  return prune(shaped)
}

/** Tools that have a short view, and so take `detail`. */
export const hasBrief = (toolName: string) => toolName in BRIEFS

export const DETAIL_PARAM = {
  type: 'string', enum: ['brief', 'full'],
  description: 'brief (default) leaves out presentation and bookkeeping fields and shortens long text; full returns every field.'
} as const
