// The tools the MCP server (server/routes/mcp.post.ts) offers an AI assistant.
// Each one is a documented /v1 route: the call goes through the same handlers
// as the panel and the native app, so the caller's role, their workspace and
// an API key's project limit all apply with nothing re-implemented here.
// tests/mcp.test.ts checks every tool names a route that exists.

export type McpParamType = 'string' | 'integer' | 'boolean' | 'array' | 'object'
export type McpParam = {
  type: McpParamType
  description: string
  enum?: string[]
  /** An array's items: strings unless said otherwise. */
  items?: { type: 'string' | 'object' }
  maximum?: number
  required?: boolean
  /** Where the value goes in the request. Default: the path when the route has `{name}`, else the query for GET and DELETE, else the body. */
  in?: 'path' | 'query' | 'body'
}
export type McpTool = {
  name: string
  title: string
  description: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** The route, `{name}` standing for a path parameter. */
  path: string
  params: Record<string, McpParam>
  /** Changes nothing. Assistants may run these without asking. */
  readOnly?: boolean
  /** Deletes or sends something that cannot be taken back. */
  destructive?: boolean
}

const projectId: McpParam = { type: 'string', required: true, description: 'Project id, from list_projects.' }
const id = (what: string): McpParam => ({ type: 'string', required: true, description: `The ${what}'s id.` })
const limit = (max: number): McpParam => ({ type: 'integer', maximum: max, description: `How many to return (up to ${max}).` })

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: 'list_projects', title: 'List projects', readOnly: true, method: 'GET', path: '/v1/admin/projects',
    description: 'The projects (apps) in this workspace, with their ids. Most other tools need a project id from here.',
    params: {}
  },
  {
    name: 'get_overview', title: 'Workspace overview', readOnly: true, method: 'GET', path: '/v1/admin/overview',
    description: 'One card per project (unread and open conversations, revenue, errors), the latest unread messages and total revenue against the period before.',
    params: { range: { type: 'string', enum: ['30d', '90d', '12m', 'all'], description: 'Revenue period. Default 30d.' } }
  },
  {
    name: 'search', title: 'Search', readOnly: true, method: 'GET', path: '/v1/admin/search',
    description: 'Full-text search across conversations and knowledge base answers.',
    params: {
      q: { type: 'string', required: true, description: 'What to look for.' },
      project: { type: 'string', description: 'Limit conversations to one project.' },
      type: { type: 'string', enum: ['all', 'conversations', 'faqs'], description: 'What to search. Default all.' }
    }
  },
  {
    name: 'list_conversations', title: 'List conversations', readOnly: true, method: 'GET', path: '/v1/admin/conversations',
    description: 'The support inbox, newest activity first, across every project or one. Returns the conversations, their end users, unread totals and counts by status. Page with `before` set to the last row\'s lastMessageAt.',
    params: {
      project: { type: 'string', description: 'Project id. Leave out for every project.' },
      status: { type: 'string', description: 'Status key, e.g. open, pending, done.' },
      unread: { type: 'boolean', description: 'Only conversations with unread user messages.' },
      assignee: { type: 'string', description: 'Agent id.' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priority.' },
      tag: { type: 'string', description: 'A tag.' },
      archived: { type: 'string', enum: ['true', 'any'], description: 'Archived ones only (`true`) or both (`any`). Left out, archived are hidden.' },
      q: { type: 'string', description: 'Matches the end user\'s name, email or external id.' },
      before: { type: 'string', description: 'ISO lastMessageAt of the last row of the previous page.' },
      limit: limit(200)
    }
  },
  {
    name: 'get_conversation', title: 'Get a conversation', readOnly: true, method: 'GET', path: '/v1/admin/conversations/{id}',
    description: 'One conversation with its end user and project. Read the messages with get_conversation_messages.',
    params: { id: id('conversation') }
  },
  {
    name: 'get_conversation_messages', title: 'Read a conversation\'s messages', readOnly: true, method: 'GET', path: '/v1/admin/conversations/{id}/messages',
    description: 'The messages of a conversation, newest page first, including team replies and internal notes. Page back with `before`.',
    params: { id: id('conversation'), before: { type: 'string', description: 'ISO createdAt of the oldest message you already have.' }, limit: limit(100) }
  },
  {
    name: 'reply_to_conversation', title: 'Reply to a customer', method: 'POST', path: '/v1/admin/conversations/{id}/messages',
    description: 'Sends a reply to the customer, signed with the operator\'s name, and emails them when they are not in the app. This is visible to the customer and cannot be unsent by email: confirm the wording with the user first.',
    params: {
      id: id('conversation'),
      body: { type: 'string', required: true, description: 'The reply, as plain text or Markdown.' },
      notifyByEmail: { type: 'boolean', description: 'Set false to skip the email notification.' }
    }
  },
  {
    name: 'add_internal_note', title: 'Add an internal note', method: 'POST', path: '/v1/admin/conversations/{id}/notes',
    description: 'Adds a note only the team can see.',
    params: { id: id('conversation'), body: { type: 'string', required: true, description: 'The note.' } }
  },
  {
    name: 'update_conversation', title: 'Update a conversation', method: 'PATCH', path: '/v1/admin/conversations/{id}',
    description: 'Changes a conversation\'s status, priority, tags or assignee. Only the fields you pass change.',
    params: {
      id: id('conversation'),
      status: { type: 'string', description: 'A status key of its ticket type, e.g. open, pending, done.' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priority.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Replaces all tags.' },
      assigneeId: { type: 'string', description: 'Agent id to assign, or an empty string for nobody.' }
    }
  },
  {
    name: 'archive_conversation', title: 'Archive a conversation', method: 'POST', path: '/v1/admin/conversations/{id}/archive',
    description: 'Hides a conversation from the queue, or brings it back.',
    params: { id: id('conversation'), archived: { type: 'boolean', description: 'false restores it. Default true.' } }
  },
  {
    name: 'search_end_users', title: 'Search customers', readOnly: true, method: 'GET', path: '/v1/admin/end-users',
    description: 'The people who have used the chat or the feedback board: matches name, email and external id. Use an id with list_conversations\' `q`.',
    params: { q: { type: 'string', description: 'Name, email or external id. Left out, the most recently seen.' }, project: { type: 'string', description: 'Limit to one project.' } }
  },
  {
    name: 'list_feedback', title: 'List feedback posts', readOnly: true, method: 'GET', path: '/v1/feedback',
    description: 'A project\'s feedback board: feature requests and bug reports with votes and status.',
    params: {
      project: projectId,
      status: { type: 'string', description: 'Comma-separated status keys.' },
      category: { type: 'string', description: 'Comma-separated: open, planned, active, done, closed.' },
      q: { type: 'string', description: 'Matches title and text.' },
      sort: { type: 'string', enum: ['top', 'new', 'activity', 'completed'], description: 'Order. Default top.' },
      includeHidden: { type: 'boolean', description: 'Include moderated posts.' },
      limit: limit(500),
      offset: { type: 'integer', description: 'Posts to skip.' }
    }
  },
  {
    name: 'get_feedback_post', title: 'Get a feedback post', readOnly: true, method: 'GET', path: '/v1/feedback/{id}',
    description: 'One post with its comments. The id may be the post number (`12`).',
    params: { id: id('post'), project: projectId }
  },
  {
    name: 'update_feedback_post', title: 'Update a feedback post', method: 'PATCH', path: '/v1/feedback/{id}',
    description: 'Moves a post along (status), pins, hides or locks it, or edits it. Changing the status notifies the people following the post.',
    params: {
      id: id('post'), project: { ...projectId, in: 'query' },
      status: { type: 'string', description: 'A status key of the board, e.g. planned, in-progress, done.' },
      title: { type: 'string', description: 'New title.' },
      body: { type: 'string', description: 'New text.' },
      hidden: { type: 'boolean', description: 'Hide it from the public board.' },
      featured: { type: 'boolean', description: 'Feature it.' },
      locked: { type: 'boolean', description: 'Stop new comments.' },
      adminNote: { type: 'string', description: 'A note only the team sees.' }
    }
  },
  {
    name: 'comment_on_feedback_post', title: 'Comment on a feedback post', method: 'POST', path: '/v1/feedback/{id}/comments',
    description: 'Comments as the team. Public comments email everyone following the post; use visibility `internal` for a team-only note.',
    params: {
      id: id('post'), project: { ...projectId, in: 'query' },
      body: { type: 'string', required: true, description: 'The comment.' },
      visibility: { type: 'string', enum: ['public', 'internal'], description: 'Default public.' }
    }
  },
  {
    name: 'list_board_items', title: 'List board items', readOnly: true, method: 'GET', path: '/v1/admin/board-items',
    description: 'A project\'s internal work board (the roadmap\'s source): items with status, priority, assignee and linked feedback.',
    params: { project: projectId }
  },
  {
    name: 'create_board_item', title: 'Create a board item', method: 'POST', path: '/v1/admin/board-items',
    description: 'Adds an item to the bottom of its status column. Private until `public` is set.',
    params: {
      project: { ...projectId, in: 'query' },
      title: { type: 'string', required: true, description: 'Up to 200 characters.' },
      description: { type: 'string', description: 'Internal Markdown.' },
      publicDescription: { type: 'string', description: 'What the public roadmap shows.' },
      status: { type: 'string', description: 'A status key of the board. Default: its first.' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priority.' },
      public: { type: 'boolean', description: 'Show on the public roadmap once planned, in progress or done.' },
      feedbackPostIds: { type: 'array', items: { type: 'string' }, description: 'Feedback posts to link (ids or `#12`).' },
      conversationIds: { type: 'array', items: { type: 'string' }, description: 'Conversations to link.' }
    }
  },
  {
    name: 'update_board_item', title: 'Update a board item', method: 'PATCH', path: '/v1/admin/board-items/{id}',
    description: 'Changes a board item (move it by changing `status`). Only the fields you pass change.',
    params: {
      id: id('item'), project: { ...projectId, in: 'query' },
      title: { type: 'string', description: 'New title.' },
      description: { type: 'string', description: 'Internal Markdown.' },
      publicDescription: { type: 'string', description: 'What the public roadmap shows.' },
      status: { type: 'string', description: 'A status key of the board.' },
      priority: { type: 'string', enum: ['', 'low', 'normal', 'high', 'urgent'], description: 'Priority; empty clears it.' },
      public: { type: 'boolean', description: 'Show on the public roadmap.' }
    }
  },
  {
    name: 'list_changelog_entries', title: 'List changelog entries', readOnly: true, method: 'GET', path: '/v1/admin/changelog/entries',
    description: 'A project\'s changelog entries, drafts included.',
    params: { project: projectId, status: { type: 'string', enum: ['draft', 'published', 'archived'], description: 'Only entries in this state.' } }
  },
  {
    name: 'create_changelog_entry', title: 'Write a changelog entry', method: 'POST', path: '/v1/admin/changelog/entries',
    description: 'Creates a changelog entry: a draft by default, or published straight away with status `published` (which the project\'s public changelog shows and subscribers are emailed about). Prefer a draft unless the user said to publish.',
    params: {
      project: { ...projectId, in: 'query' },
      title: { type: 'string', required: true, description: 'Up to 200 characters.' },
      body: { type: 'string', description: 'Markdown, written for the public.' },
      tag: { type: 'string', enum: ['new', 'improved', 'fix', 'removed', 'breaking'], description: 'Default improved.' },
      status: { type: 'string', enum: ['draft', 'published'], description: 'Default draft.' },
      feedbackPostIds: { type: 'array', items: { type: 'string' }, description: 'Feedback posts it ships (ids or `#12`).' },
      boardItemIds: { type: 'array', items: { type: 'string' }, description: 'Board items it ships.' }
    }
  },
  {
    name: 'update_changelog_entry', title: 'Update a changelog entry', method: 'PATCH', path: '/v1/admin/changelog/entries/{id}',
    description: 'Edits an entry or publishes a draft (status `published`). Only the fields you pass change.',
    params: {
      id: id('entry'), project: { ...projectId, in: 'query' },
      title: { type: 'string', description: 'New title.' },
      body: { type: 'string', description: 'Markdown.' },
      tag: { type: 'string', enum: ['new', 'improved', 'fix', 'removed', 'breaking'], description: 'Tag.' },
      status: { type: 'string', enum: ['draft', 'published', 'archived'], description: 'State.' }
    }
  },
  {
    name: 'list_errors', title: 'List errors', readOnly: true, method: 'GET', path: '/v1/admin/errors',
    description: 'Issues from the project\'s connected error tracker (GlitchTip, Bugsink, Sentry), newest first.',
    params: {
      project: projectId,
      status: { type: 'string', description: 'The tracker\'s own status, e.g. unresolved.' },
      q: { type: 'string', description: 'Search text.' },
      user: { type: 'string', description: 'An end user\'s external id: only the errors they hit.' },
      limit: limit(100)
    }
  },
  {
    name: 'get_error', title: 'Get an error', readOnly: true, method: 'GET', path: '/v1/admin/errors/{id}',
    description: 'One error issue with its latest event: message, stack trace and context.',
    params: { id: id('issue'), project: projectId }
  },
  {
    name: 'list_pricing_tables', title: 'List pricing tables', readOnly: true, method: 'GET', path: '/v1/admin/pricing-tables',
    description: 'A project\'s pricing tables (plan cards, paywalls, comparison tables) with their plans, status and anything to check before publishing, and whether Stripe is connected.',
    params: { project: projectId }
  },
  {
    name: 'get_pricing_table', title: 'Get a pricing table', readOnly: true, method: 'GET', path: '/v1/admin/pricing-tables/{id}',
    description: 'One pricing table\'s working copy (plans with their Stripe links and written prices, features, words, look, options, translations, A/B test) and what is published.',
    params: { id: id('pricing table') }
  },
  {
    name: 'create_pricing_table', title: 'Create a pricing table', method: 'POST', path: '/v1/admin/pricing-tables',
    description: 'Creates a draft pricing table with example plans that fit its template. Nothing shows on the site or in the app until it is published.',
    params: {
      project: projectId,
      name: { type: 'string', required: true, description: 'Up to 80 characters.' },
      key: { type: 'string', description: 'What sites and apps ask for it by (lowercase, digits, dashes). Default: from the name.' },
      template: { type: 'string', enum: ['tiers', 'rows', 'paywall', 'matrix', 'spotlight'], description: 'Cards side by side (default), compact rows, a mobile paywall, a comparison table, or one wide plan.' }
    }
  },
  {
    name: 'update_pricing_table', title: 'Update a pricing table', method: 'PATCH', path: '/v1/admin/pricing-tables/{id}',
    description: 'Edits the working copy; only the fields you pass change, and a list you pass replaces the old one, so read the table first and send whole plans and features. Prices from a linked Stripe price win over written ones. Publish to make it live.',
    params: {
      id: id('pricing table'),
      name: { type: 'string', description: 'Up to 80 characters.' },
      key: { type: 'string', description: 'Lowercase letters, digits and dashes.' },
      template: { type: 'string', enum: ['tiers', 'rows', 'paywall', 'matrix', 'spotlight'], description: 'The layout.' },
      plans: { type: 'array', items: { type: 'object' }, description: 'Up to 6 plans: id, key, name, description, badge, highlighted, stripeProduct, prices ({ week, month, year, once }: stripePrice, amount, amounts by currency, appStoreProduct), customPrice, priceNote, trialDays, action ({ type: checkout, payment_link, url or none, label, url }) and features (row id to true, false or a value such as "10").' },
      features: { type: 'array', items: { type: 'object' }, description: 'Up to 40 rows: id, kind (feature or heading), text, hint.' },
      content: { type: 'object', description: 'title, subtitle, footnote, weeklyLabel, monthlyLabel, yearlyLabel, savingsLabel, termsUrl, privacyUrl.' },
      style: { type: 'object', description: 'accent, background, text (hex), radius, font, density, surface, highlight.' },
      options: { type: 'object', description: 'defaultInterval, yearlyAs, cumulative, showExcluded, compare, currency.' },
      checkout: { type: 'object', description: 'successUrl, cancelUrl, allowPromotionCodes.' },
      translations: { type: 'object', description: 'By language tag, each a map of text keys (as `GET` lists them) to words; null removes a language.' },
      experiment: { type: 'object', description: 'The A/B test: weight (0 to 100) and variants ([{ table: key, weight }]). Not while it runs.' }
    }
  },
  {
    name: 'publish_pricing_table', title: 'Publish a pricing table', method: 'POST', path: '/v1/admin/pricing-tables/{id}/publish',
    description: 'Makes the working copy live on every site and app that shows the table, with its Stripe prices as they are now. Confirm with the user first.',
    params: { id: id('pricing table') }
  },
  {
    name: 'get_stripe_catalog', title: 'Stripe products and prices', readOnly: true, method: 'GET', path: '/v1/admin/stripe/catalog',
    description: 'The project\'s active Stripe products, prices (in the smallest currency unit) and payment links, to link plans to. `connected: false` without Stripe.',
    params: { project: projectId, refresh: { type: 'string', enum: ['1'], description: 'Ask Stripe now instead of the five-minute copy.' } }
  },
  {
    name: 'get_pricing_stats', title: 'Pricing table numbers', readOnly: true, method: 'GET', path: '/v1/admin/pricing-tables/{id}/stats',
    description: 'Views, visitors, clicks, checkouts, purchases and revenue (from Stripe) of a pricing table, by day and by plan, and its A/B test result with lift and confidence.',
    params: { id: id('pricing table'), days: { type: 'integer', maximum: 365, description: 'How many days back (default 30).' } }
  },
  {
    name: 'suggest_pricing', title: 'Suggest pricing with AI', method: 'POST', path: '/v1/admin/pricing-tables/{id}/suggest',
    description: 'Proposes plan names, features and prices from the project\'s GitHub repos, Stripe, revenue and the table\'s numbers. Saves nothing: show the draft to the user, then apply it with update_pricing_table if they agree.',
    params: {
      id: id('pricing table'),
      focus: { type: 'array', items: { type: 'string' }, description: 'Any of copy, features, prices (default all).' },
      repos: { type: 'array', items: { type: 'string' }, description: 'Repo full names to read (default all, three at most).' },
      notes: { type: 'string', description: 'What it should know, up to 1,000 characters.' }
    }
  },
  {
    name: 'add_pricing_variant', title: 'Add an A/B test variant', method: 'POST', path: '/v1/admin/pricing-tables/{id}/variants',
    description: 'Copies the table into a new draft table and adds it to the table\'s A/B test. Edit and publish the copy, then start the test.',
    params: { id: id('pricing table'), key: { type: 'string', description: 'The copy\'s key. Default: the table\'s key with -b, -c or -d.' } }
  },
  {
    name: 'start_pricing_experiment', title: 'Start an A/B test', method: 'POST', path: '/v1/admin/pricing-tables/{id}/experiment/start',
    description: 'Splits the table\'s visitors between it and its published variants by weight. Real visitors see it: confirm with the user first.',
    params: { id: id('pricing table') }
  },
  {
    name: 'stop_pricing_experiment', title: 'End an A/B test', method: 'POST', path: '/v1/admin/pricing-tables/{id}/experiment/stop',
    description: 'Everyone sees the table again. With `adopt`, a variant\'s plans, words and look become the table\'s working copy, to publish.',
    params: { id: id('pricing table'), adopt: { type: 'string', description: 'The key of the variant to keep.' } }
  }
]

// ---- schema and request ------------------------------------------------------

export function paramLocation(tool: McpTool, name: string): 'path' | 'query' | 'body' {
  const param = tool.params[name]
  if (param?.in) return param.in
  if (tool.path.includes(`{${name}}`)) return 'path'
  return tool.method === 'GET' || tool.method === 'DELETE' ? 'query' : 'body'
}

export function inputSchema(tool: McpTool) {
  const properties: Record<string, Record<string, unknown>> = {}
  for (const [name, { required, in: _in, ...schema }] of Object.entries(tool.params)) properties[name] = schema
  const required = Object.entries(tool.params).filter(([, param]) => param.required).map(([name]) => name)
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
}

export function describeTool(tool: McpTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: inputSchema(tool),
    annotations: { title: tool.title, readOnlyHint: Boolean(tool.readOnly), destructiveHint: Boolean(tool.destructive), openWorldHint: false }
  }
}

export type McpRequest = { method: McpTool['method'], url: string, body?: Record<string, unknown> }

/** The call to make for a tool and its arguments, or a sentence saying what is wrong with them (the assistant reads it and retries). */
export function buildRequest(tool: McpTool, args: unknown): McpRequest | { error: string } {
  const given = (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Record<string, unknown>
  for (const name of Object.keys(given)) if (!(name in tool.params)) return { error: `Unknown argument "${name}". This tool takes: ${Object.keys(tool.params).join(', ') || 'no arguments'}.` }
  let path = tool.path
  const query = new URLSearchParams()
  const body: Record<string, unknown> = {}
  for (const [name, param] of Object.entries(tool.params)) {
    const value = given[name]
    if (value === undefined || value === null) {
      if (param.required) return { error: `Missing required argument "${name}".` }
      continue
    }
    const problem = checkValue(param, value)
    if (problem) return { error: `Argument "${name}" ${problem}.` }
    const where = paramLocation(tool, name)
    if (where === 'path') path = path.replace(`{${name}}`, encodeURIComponent(String(value)))
    else if (where === 'query') query.set(name, Array.isArray(value) ? value.join(',') : String(value))
    else body[name] = value
  }
  const search = query.toString()
  return { method: tool.method, url: search ? `${path}?${search}` : path, ...(tool.method === 'GET' || tool.method === 'DELETE' ? {} : { body }) }
}

function checkValue(param: McpParam, value: unknown): string {
  switch (param.type) {
    case 'string':
      if (typeof value !== 'string') return 'must be a string'
      if (param.required && !value.trim()) return 'must not be empty'
      if (param.enum && !param.enum.includes(value)) return `must be one of ${param.enum.join(', ')}`
      return ''
    case 'integer':
      if (!Number.isInteger(value)) return 'must be a whole number'
      return param.maximum !== undefined && (value as number) > param.maximum ? `must be at most ${param.maximum}` : ''
    case 'boolean': return typeof value === 'boolean' ? '' : 'must be true or false'
    case 'array':
      if (param.items?.type === 'object') return Array.isArray(value) && value.every(item => item && typeof item === 'object' && !Array.isArray(item)) ? '' : 'must be a list of objects'
      return Array.isArray(value) && value.every(item => typeof item === 'string') ? '' : 'must be a list of strings'
    default: return value && typeof value === 'object' && !Array.isArray(value) ? '' : 'must be an object'
  }
}
