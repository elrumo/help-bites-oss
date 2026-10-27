// The tools the MCP server (server/routes/mcp.post.ts) offers an AI assistant.
// Each one is a documented /v1 route: the call goes through the same handlers
// as the panel and the native app, so the caller's role, their workspace and
// an API key's project limit all apply with nothing re-implemented here.
// tests/mcp.test.ts checks every tool names a route that exists.

export type McpParamType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'
export type McpParam = {
  type: McpParamType
  description: string
  enum?: string[]
  /** An array's items: strings unless said otherwise. */
  items?: { type: 'string' | 'object' }
  maximum?: number
  /** Sent when the caller leaves it out. */
  default?: number
  required?: boolean
  /** Where the value goes in the request. Default: the path when the route has `{name}`, else the query for GET and DELETE, else the body. */
  in?: 'path' | 'query' | 'body'
  /** The name the route reads it under, when that differs from the argument's own (a body `id` next to a path `{id}`). */
  as?: string
}
export type McpTool = {
  name: string
  title: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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
    name: 'get_me', title: 'Who this connection acts as', readOnly: true, method: 'GET', path: '/v1/admin/me',
    description: 'The operator this connection acts as, their role in the workspace (which decides what other tools may do), every workspace they belong to, and the plan with the features it includes.',
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
    description: 'The support inbox, newest activity first, across every project or one. Returns `conversations`, their `endUsers`, `hasMore`, unread totals, `counts` by status, type and assignee, and `viewCounts` (how many rows each `view` lists under the same filters). Page with `before` set to the last row\'s lastMessageAt. Archived conversations are left out unless you ask for them.',
    params: {
      project: { type: 'string', description: 'Project id. Leave out for every project.' },
      status: { type: 'string', description: 'Status key, e.g. open, pending, done. The keys depend on the conversation type (list_conversation_types).' },
      type: { type: 'string', description: 'A conversation type key: support, error or a custom type of the project (list_conversation_types).' },
      channel: { type: 'string', enum: ['widget', 'email'], description: 'Where the conversation started: `email` is mail to an inbound address, `widget` is everything else.' },
      view: { type: 'string', enum: ['all', 'unassigned', 'mine', 'open', 'unread', 'archived'], description: 'A queue view: `mine` is the connected operator\'s own, `open` the open status category, `unread` those with unread customer messages, `archived` the same as archived `true`. Default all.' },
      unread: { type: 'boolean', description: 'Only conversations with unread user messages.' },
      assignee: { type: 'string', description: 'Agent id, from list_team_members.' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priority.' },
      tag: { type: 'string', description: 'A tag.' },
      archived: { type: 'string', enum: ['true', 'any'], description: 'Archived ones only (`true`) or both (`any`). Left out, archived are hidden.' },
      q: { type: 'string', description: 'Matches the end user\'s name, email or external id.' },
      endUser: { type: 'string', description: 'Only this customer\'s conversations: an end user id, from search_end_users.' },
      before: { type: 'string', description: 'ISO lastMessageAt of the last row of the previous page.' },
      limit: { ...limit(200), description: 'How many to return (up to 200). Default 50.' }
    }
  },
  {
    name: 'get_conversation', title: 'Get a conversation', readOnly: true, method: 'GET', path: '/v1/admin/conversations/{id}',
    description: 'One conversation with its end user and project. Read the messages with get_conversation_messages.',
    params: { id: id('conversation') }
  },
  {
    name: 'get_conversation_messages', title: 'Read a conversation\'s messages', readOnly: true, method: 'GET', path: '/v1/admin/conversations/{id}/messages',
    description: 'The messages of a conversation, including team replies, internal notes and timeline events (status changes, assignments), in time order. The first call returns the latest ones (50 by default); the reply is `{ messages, hasMore }`, and you page back with `before` set to the first message\'s createdAt.',
    params: {
      id: id('conversation'),
      before: { type: 'string', description: 'ISO createdAt of the oldest message you already have.' },
      limit: { ...limit(200), description: 'How many to return (up to 200). Default 50.' }
    }
  },
  {
    name: 'reply_to_conversation', title: 'Reply to a customer', destructive: true, method: 'POST', path: '/v1/admin/conversations/{id}/messages',
    description: 'Sends a reply to the customer, signed with the project\'s sender name (else the operator\'s name). It also EMAILS the customer whenever they have an address (an unconfirmed one they typed counts), whether or not they are in the app, unless `notifyByEmail` is false or a chat conversation was already emailed in the last five minutes; a conversation that came in by email is always mailed back. The email stays in their inbox even if the message is unsent later. Returns `message`, `conversation`, `created`, `emailSent` and `emailError`. Confirm the wording with the user first.',
    params: {
      id: id('conversation'),
      body: { type: 'string', required: true, description: 'The reply, as plain text or Markdown, up to 8,000 characters.' },
      notifyByEmail: { type: 'boolean', description: 'Set false to skip the email notification. Default true.' },
      replyToId: { type: 'string', description: 'The id of the message this answers, from get_conversation_messages.' },
      clientId: { type: 'string', description: 'A key you choose, up to 80 characters, that makes a retry safe: sending the same one again returns the existing message (`created` false) and emails nobody.' },
      attachments: { type: 'array', items: { type: 'object' }, description: 'Up to 4 images shown with the reply: the { url, mime, size } objects upload_board_comment_attachment returned when uploaded for this conversation\'s project (PNG, JPEG, GIF or WebP). Anything else is dropped without an error.' }
    }
  },
  {
    name: 'add_internal_note', title: 'Add an internal note', method: 'POST', path: '/v1/admin/conversations/{id}/notes',
    description: 'Adds a note only the team can see.',
    params: { id: id('conversation'), body: { type: 'string', required: true, description: 'The note.' } }
  },
  {
    name: 'update_conversation', title: 'Update a conversation', method: 'PATCH', path: '/v1/admin/conversations/{id}',
    description: 'Changes a conversation\'s status, priority, tags, assignee or type-specific fields. Only the fields you pass change, and the change is recorded as a team-only timeline event. A status change also reaches the customer\'s chat. A bad status, assignee or field value fails and nothing is saved. Returns the updated conversation.',
    params: {
      id: id('conversation'),
      status: { type: 'string', description: 'A status key of its conversation type, e.g. open, pending, done (list_conversation_types).' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priority.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'REPLACES all tags (lowercased, up to 20, each up to 40 characters); an empty list clears them.' },
      assigneeId: { type: 'string', description: 'Agent id to assign, from list_team_members, or an empty string for nobody.' },
      fields: { type: 'object', description: 'Values for the intake and triage fields its conversation type defines (list_conversation_types), by field key. They are merged into the existing values (a key you leave out keeps its value) and checked against the type.' }
    }
  },
  {
    name: 'archive_conversation', title: 'Archive a conversation', method: 'POST', path: '/v1/admin/conversations/{id}/archive',
    description: 'Hides a conversation from the queue, or brings it back.',
    params: { id: id('conversation'), archived: { type: 'boolean', description: 'false restores it. Default true.' } }
  },
  {
    name: 'search_end_users', title: 'Search customers', readOnly: true, method: 'GET', path: '/v1/admin/end-users',
    description: 'The people who have used the chat or the feedback board: matches name, email and external id, up to 50 per call with no paging. Returns `endUsers`, each with its `id` and `projectId`. Use an id as list_conversations\' `endUser`.',
    params: { q: { type: 'string', description: 'Name, email or external id. Left out, the most recently seen.' }, project: { type: 'string', description: 'Limit to one project.' } }
  },
  // ---- feedback --------------------------------------------------------------------------------------,
  {
    name: 'list_feedback', title: 'List feedback posts', readOnly: true, method: 'GET', path: '/v1/feedback',
    description: 'A project\'s feedback board: feature requests and bug reports with votes and status. Returns `posts` and `total` (everything that matches, for paging with `offset`). Hidden posts are left out unless `includeHidden`. The status, type, platform and tag keys a board accepts come from get_feedback_config.',
    params: {
      project: projectId,
      view: { type: 'string', enum: ['board', 'roadmap', 'changelog'], description: 'board (default) lists everything; roadmap keeps planned, active and done posts; changelog keeps done posts marked showOnChangelog, newest completion first (legacy: the public changelog is made of changelog entries now, see list_changelog_entries).' },
      status: { type: 'string', description: 'Comma-separated status keys.' },
      category: { type: 'string', description: 'Comma-separated: open, planned, active, done, closed.' },
      type: { type: 'string', description: 'Comma-separated post type keys, e.g. bug,feature.' },
      platform: { type: 'string', description: 'Comma-separated platform keys.' },
      tag: { type: 'string', description: 'Comma-separated tag keys; a post matches when it has any of them.' },
      featured: { type: 'boolean', description: 'true keeps only featured posts, false only the ones that are not.' },
      q: { type: 'string', description: 'Matches title and text.' },
      sort: { type: 'string', enum: ['top', 'new', 'activity', 'completed'], description: 'Order. Default top (changelog view: completed).' },
      includeHidden: { type: 'boolean', description: 'Include hidden (moderated) posts.' },
      limit: { ...limit(500), description: 'How many to return (up to 500). Default 100.' },
      offset: { type: 'integer', description: 'Posts to skip.' }
    }
  },
  {
    name: 'get_feedback_post', title: 'Get a feedback post', readOnly: true, method: 'GET', path: '/v1/feedback/{id}',
    description: 'One post with its comments, oldest first, team notes and hidden comments included. The id may be the post number (`12` or `12-slug`) or the id it was imported with. Returns `{ post, comments, viewer, linked, backrefs }`: `linked` resolves the `#N` references in the post and its comments, `backrefs` lists the posts that mention this one.',
    params: { id: id('post'), project: projectId }
  },
  {
    name: 'update_feedback_post', title: 'Update a feedback post', method: 'PATCH', path: '/v1/feedback/{id}',
    description: 'Moves a post along (status), pins, hides or locks it, edits its words and filing (type, platform, tags, attachments), sets what its changelog draft says, or pins one comment. Only the keys you send change. Moving a post into a status marked to notify emails the people following it, and the first move into a done status stamps `completedAt`. The status, type, platform and tag keys a board accepts come from get_feedback_config. Returns the updated post.',
    params: {
      id: id('post'), project: { ...projectId, in: 'query' },
      status: { type: 'string', description: 'A status key of the board (get_feedback_config), e.g. planned, in-progress, done.' },
      title: { type: 'string', description: 'New title, up to 200 characters.' },
      body: { type: 'string', description: 'New text, up to 20,000 characters.' },
      type: { type: 'string', description: 'A post type key of the board (get_feedback_config); an empty string clears it.' },
      platform: { type: 'string', description: 'A platform key of the board (get_feedback_config); an empty string clears it.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'REPLACES the post\'s tags with these tag keys of the board (get_feedback_config), at most 4; an empty list clears them.' },
      hidden: { type: 'boolean', description: 'Hide it from the public board.' },
      featured: { type: 'boolean', description: 'Feature it.' },
      locked: { type: 'boolean', description: 'Stop new comments from everyone but the team.' },
      adminNote: { type: 'string', description: 'A note only the team sees, up to 4,000 characters; an empty string clears it.' },
      showOnChangelog: { type: 'boolean', description: 'Put a done post on the legacy per-post changelog view (the public changelog is made of changelog entries now, see create_changelog_entry).' },
      changelogTitle: { type: 'string', description: 'The title the post\'s changelog draft starts from, up to 200 characters; an empty string clears it.' },
      changelogBody: { type: 'string', description: 'The text the post\'s changelog draft starts from, up to 20,000 characters; an empty string clears it.' },
      shippedIn: { type: 'string', description: 'The version that shipped it, up to 200 characters (publishing a changelog release sets it for the posts its entries link); an empty string clears it.' },
      icon: { type: 'string', description: 'An Iconify name such as lucide:bug, or an emoji, up to 60 characters; an empty string clears it.' },
      completedAt: { type: 'string', description: 'When it was finished, as an ISO date-time; an empty string clears it. The first move into a done status sets it to now.' },
      attachments: { type: 'array', items: { type: 'object' }, description: 'REPLACES the post\'s attachments: up to 10 objects { url, name, mime, size } returned by upload_board_comment_attachment for this project; an empty list removes them all.' },
      pinnedCommentId: { type: 'string', description: 'The id of a public, top-level comment to pin to the post (from get_feedback_post); an empty string unpins.' }
    }
  },
  {
    name: 'comment_on_feedback_post', title: 'Comment on a feedback post', method: 'POST', path: '/v1/feedback/{id}/comments',
    description: 'Comments as the team. Public comments email everyone following the post and anyone @mentioned; use visibility `internal` for a team-only note that notifies nobody. A reply to a reply is filed under its parent comment (threads stay one level deep). Locked posts still take team comments. Returns `{ comment, post }`.',
    params: {
      id: id('post'), project: { ...projectId, in: 'query' },
      body: { type: 'string', required: true, description: 'The comment, Markdown or HTML, up to 8,000 characters.' },
      visibility: { type: 'string', enum: ['public', 'internal'], description: 'Default public.' },
      parentId: { type: 'string', description: 'The id of the top-level comment to reply under, from get_feedback_post. It must be a comment on this post.' },
      replyToId: { type: 'string', description: 'The id of the comment you are answering, from get_feedback_post. It must be a comment on this post; used alone it also sets the thread.' }
    }
  },
  // ---- planning board --------------------------------------------------------------------------------,
  {
    name: 'list_board_items', title: 'List board items', readOnly: true, method: 'GET', path: '/v1/admin/board-items',
    description: 'A project\'s internal work board (the roadmap\'s source): items with status, priority, assignee and linked feedback, in rank order. Returns 50 at a time; the reply has `total`, so page with `offset` or narrow with `status`.',
    params: {
      project: projectId,
      status: { type: 'string', description: 'Only items in this status key.' },
      conversation: { type: 'string', description: 'Only items linked to this conversation id.' },
      feedbackPost: { type: 'string', description: 'Only items linked to this feedback post (its id or number).' },
      offset: { type: 'integer', description: 'Items to skip.' },
      limit: { ...limit(200), default: 50 }
    }
  },
  {
    name: 'create_board_item', title: 'Create a board item', method: 'POST', path: '/v1/admin/board-items',
    description: 'Adds an item to the bottom of its status column. Private until `public` is set.',
    params: {
      project: { ...projectId, in: 'query' },
      title: { type: 'string', required: true, description: 'Up to 200 characters.' },
      description: { type: 'string', description: 'Internal Markdown.' },
      publicDescription: { type: 'string', description: 'What the public roadmap shows.' },
      status: { type: 'string', description: 'A status key of the board (from `board.statuses` in list_projects). Default: the board\'s default status.' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priority.' },
      assigneeId: { type: 'string', description: 'A team member\'s id (from list_team_members); empty for nobody.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Label keys the board defines (`board.labels` in list_projects).' },
      targetDate: { type: 'string', description: 'A date such as 2026-11-30; empty for none.' },
      attachments: { type: 'array', items: { type: 'object' }, description: 'Up to 10 attachment objects ({ url, name, mime, size }) returned by upload_board_comment_attachment: screenshots, logs, files.' },
      rank: { type: 'number', description: 'Sort key within its column; lower comes first. Default: the bottom.' },
      public: { type: 'boolean', description: 'Show on the public roadmap once planned, in progress or done.' },
      feedbackPostIds: { type: 'array', items: { type: 'string' }, description: 'Feedback posts to link (ids or `#12`), up to 50.' },
      conversationIds: { type: 'array', items: { type: 'string' }, description: 'Conversations to link, up to 50.' }
    }
  },
  {
    name: 'create_board_item_from_feedback', title: 'Plan a feedback post', method: 'POST', path: '/v1/admin/board-items/from-feedback',
    description: 'Files a board item for a feedback post and links the post to it. The AI (when the workspace has one) writes the title, description and priority from the post; otherwise the item copies the post.',
    params: {
      project: { ...projectId, in: 'query' },
      postId: { type: 'string', required: true, description: 'The post\'s id or `#12`.' },
      ai: { type: 'boolean', description: 'false skips the AI and copies the post. Default true.' }
    }
  },
  {
    name: 'update_board_item', title: 'Update a board item', method: 'PATCH', path: '/v1/admin/board-items/{id}',
    description: 'Changes a board item (move it by changing `status`, and `rank` to place it between neighbours). Only the fields you pass change; a list you pass (`labels`, `attachments`) replaces the old one. The first move into a done status stamps the completion time, and with the board\'s feedback sync on, a change of status category also moves the linked feedback posts and emails their followers. Link posts and conversations with link_board_item.',
    params: {
      id: id('item'), project: { ...projectId, in: 'query' },
      title: { type: 'string', description: 'New title.' },
      description: { type: 'string', description: 'Internal Markdown; empty clears it.' },
      publicDescription: { type: 'string', description: 'What the public roadmap shows; empty clears it.' },
      status: { type: 'string', description: 'A status key of the board (from `board.statuses` in list_projects).' },
      priority: { type: 'string', enum: ['', 'low', 'normal', 'high', 'urgent'], description: 'Priority; empty clears it.' },
      assigneeId: { type: 'string', description: 'A team member\'s id (from list_team_members); empty unassigns.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Replaces the item\'s labels with these label keys (an empty list clears them).' },
      targetDate: { type: 'string', description: 'A date such as 2026-11-30; empty clears it.' },
      attachments: { type: 'array', items: { type: 'object' }, description: 'REPLACES the item\'s attachments (up to 10 objects { url, name, mime, size } from upload_board_comment_attachment); an empty list removes them all.' },
      rank: { type: 'number', description: 'Sort key within its column; lower comes first. Use the midpoint between the ranks of the two items it should sit between.' },
      public: { type: 'boolean', description: 'Show on the public roadmap.' }
    }
  },
  {
    name: 'delete_board_item', title: 'Delete a board item', destructive: true, method: 'DELETE', path: '/v1/admin/board-items/{id}',
    description: 'Permanently removes the item and its links; the linked feedback posts and conversations stay. Confirm with the user first, and prefer moving it to a canceled status.',
    params: { id: id('item'), project: { type: 'string', description: 'Project id, needed when `id` is an item number.' } }
  },
  {
    name: 'link_board_item', title: 'Link or unlink a board item', method: 'POST', path: '/v1/admin/board-items/{id}/links',
    description: 'Links (or, with `linked` false, unlinks) one feedback post, support conversation or other item of the same project to this item, up to 50 of each kind. A related item is linked on both sides; linking a conversation adds a note to its timeline. Returns the item with its links.',
    params: {
      id: id('item'),
      project: { type: 'string', description: 'Project id, needed when `id` is an item number.', in: 'query' },
      kind: { type: 'string', required: true, enum: ['feedback', 'conversation', 'item'], description: 'What is being linked.' },
      linkedId: { type: 'string', required: true, as: 'id', description: 'The post, conversation or item to link: its id or `#12`.' },
      linked: { type: 'boolean', description: 'false unlinks. Default true.' }
    }
  },
  {
    name: 'list_board_item_history', title: 'Read a board item\'s edit history', readOnly: true, method: 'GET', path: '/v1/admin/board-items/{id}/history',
    description: 'The item\'s edit history, newest first: each change with the field values before and after, who made it, where it came from (web, native app, API or MCP) and when. Page with `offset`; the reply has `hasMore` and `nextOffset`.',
    params: {
      id: id('item'),
      project: { type: 'string', description: 'Project id, needed when `id` is an item number.' },
      offset: { type: 'integer', description: 'Entries to skip.' },
      limit: limit(100)
    }
  },
  {
    name: 'suggest_board_item_title', title: 'Write a board item title with AI', method: 'POST', path: '/v1/admin/board-items/suggest-title',
    description: 'Has the workspace\'s AI propose a short title, in the same language, from an item\'s description. Saves nothing: pass the text as `title` to create_board_item or update_board_item. Needs an AI provider; can take several seconds.',
    params: {
      project: { ...projectId, in: 'query' },
      description: { type: 'string', required: true, description: 'The item\'s description (the first 4,000 characters are read).' }
    }
  },
  {
    name: 'upload_board_comment_attachment', title: 'Upload a planning attachment', method: 'POST', path: '/v1/feedback/attachments',
    description: 'Uploads one image or file for a planning comment or item (screenshots, logs, documents) and returns its attachment object and download URL. Send the file bytes as base64, then pass the returned object in the `attachments` of comment_on_board_item, create_board_item or update_board_item.',
    params: {
      project: { ...projectId, in: 'query' },
      filename: { type: 'string', required: true, description: 'Filename with an accepted extension.' },
      contentBase64: { type: 'string', required: true, description: 'The file bytes encoded as standard base64 (up to 25 MB decoded).' }
    }
  },
  {
    name: 'list_board_item_comments', title: 'Read planning comments', readOnly: true, method: 'GET', path: '/v1/admin/board-items/{id}/comments',
    description: 'Reads an item\'s internal comments and threaded replies, oldest first (50 per call by default). The reply is `{ comments, hasMore, nextOffset }`: pass `nextOffset` as `offset` for the next page.',
    params: {
      id: id('item'),
      project: { type: 'string', description: 'Project id, needed when `id` is an item number.' },
      offset: { type: 'integer', description: 'Comments to skip.' },
      limit: limit(100)
    }
  },
  // ---- changelog -------------------------------------------------------------------------------------,
  {
    name: 'comment_on_board_item', title: 'Comment on a planning item', method: 'POST', path: '/v1/admin/board-items/{id}/comments',
    description: 'Adds an internal comment or threaded reply. The author is shown as this assistant, while the authorizing operator remains recorded.',
    params: {
      id: id('item'), project: { ...projectId, in: 'query' },
      body: { type: 'string', description: 'The comment text, up to 8,000 characters. It may be omitted when attachments are included.' },
      parentId: { type: 'string', description: 'Root comment id when replying.' },
      replyToId: { type: 'string', description: 'Comment being replied to; use with parentId for replies within a thread.' },
      attachments: { type: 'array', items: { type: 'object' }, description: 'Attachment objects returned by upload_board_comment_attachment, up to 10.' }
    }
  },
  {
    name: 'list_changelog_entries', title: 'List changelog entries', readOnly: true, method: 'GET', path: '/v1/admin/changelog/entries',
    description: 'A project\'s changelog entries (up to 1,000), newest published first and drafts last, each with the sources it links to. Archived entries are left out unless `status` is archived. Narrow by release, or by the post, board item or conversation an entry links. The reply is `{ entries }`.',
    params: {
      project: projectId,
      status: { type: 'string', enum: ['draft', 'published', 'archived'], description: 'Only entries in this state. Left out, every entry but the archived ones.' },
      release: { type: 'string', description: 'A release id (from list_changelog_releases), or `none` for the entries that belong to no release.' },
      feedbackPost: { type: 'string', description: 'Only entries that link this feedback post (its id or number).' },
      boardItem: { type: 'string', description: 'Only entries that link this board item (its id).' },
      conversation: { type: 'string', description: 'Only entries that link this conversation (its id).' }
    }
  },
  {
    name: 'create_changelog_entry', title: 'Write a changelog entry', method: 'POST', path: '/v1/admin/changelog/entries',
    description: 'Creates a changelog entry: a draft by default, or published straight away with status `published` (which the project\'s public changelog shows, once its release is published too, and which emails the people following the posts it ships and the changelog\'s subscribers). Prefer a draft unless the user said to publish. `releaseId` files it under an existing release; `releaseVersion` finds the release with that version or CREATES it already published, so use it only when that is wanted. The sources you link must belong to the project, and a bad one fails the request before anything is written. Returns `{ entry }` with its id and number.',
    params: {
      project: { ...projectId, in: 'query' },
      title: { type: 'string', required: true, description: 'Up to 200 characters.' },
      summary: { type: 'string', description: 'A short summary shown in lists and feeds, up to 300 characters.' },
      body: { type: 'string', description: 'Markdown, written for the public, up to 20,000 characters.' },
      bodyFormat: { type: 'string', enum: ['markdown', 'html'], description: 'How `body` is written. Default markdown; HTML is cleaned when saved.' },
      tag: { type: 'string', enum: ['new', 'improved', 'fix', 'removed', 'breaking'], description: 'Default improved.' },
      area: { type: 'string', description: 'A lowercase label for the part of the product, such as web or api: letters, digits and hyphens, up to 40. When the project lists its areas (`changelog.areas` in list_projects) it must be one of them.' },
      slug: { type: 'string', description: 'The URL slug, up to 120 characters. It is made unique for you. Default: made from the title.' },
      status: { type: 'string', enum: ['draft', 'published'], description: 'Default draft.' },
      publishedAt: { type: 'string', description: 'The date shown, as an ISO date-time. Default: now, when it is published.' },
      releaseId: { type: 'string', description: 'File it under this release, from list_changelog_releases. It wins over `releaseVersion`.' },
      releaseVersion: { type: 'string', description: 'File it under the release with this version (up to 60 characters). A release that does not exist is created already published.' },
      pinned: { type: 'boolean', description: 'Keep it at the top of the changelog.' },
      iconGlyph: { type: 'string', description: 'A glyph shown beside the entry, such as an emoji, up to 80 characters.' },
      accentColor: { type: 'string', description: 'A #rrggbb colour that accents the entry.' },
      images: { type: 'array', items: { type: 'object' }, description: 'Up to 10 pictures (PNG, JPEG, GIF or WebP) shown with the text, in order: the { url, name, mime, size } objects upload_board_comment_attachment returns for this project.' },
      links: { type: 'array', items: { type: 'object' }, description: 'Up to 6 links shown with the entry, each { label, url }: a label up to 80 characters and an http(s) url up to 500.' },
      commitShas: { type: 'array', items: { type: 'string' }, description: 'The full 40-character git commit SHAs it describes, up to 50.' },
      feedbackPostIds: { type: 'array', items: { type: 'string' }, description: 'Feedback posts it ships (ids or `#12`), up to 50.' },
      boardItemIds: { type: 'array', items: { type: 'string' }, description: 'Board items it ships, up to 50.' },
      conversationIds: { type: 'array', items: { type: 'string' }, description: 'Conversations it answers (their ids), up to 50: the people to tell when it ships.' }
    }
  },
  {
    name: 'update_changelog_entry', title: 'Update a changelog entry', method: 'PATCH', path: '/v1/admin/changelog/entries/{id}',
    description: 'Edits an entry or publishes a draft (status `published`). Only the fields you pass change, and a list you pass (`images`, `links`, `commitShas`) replaces the old one. The first time an entry becomes public it gets its date and the people following the posts it ships, and the changelog\'s subscribers, are emailed (an entry in a draft release waits until that release is published); unpublishing keeps the date. `releaseVersion` finds the release with that version or CREATES it already published. Link posts, board items and conversations with link_changelog_entry. Returns `{ entry }`. Publishing reaches real people: confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The entry\'s id, or its number (`12`) together with `project`.' },
      project: { type: 'string', in: 'query', description: 'Project id, needed when `id` is an entry number.' },
      title: { type: 'string', description: 'New title, up to 200 characters.' },
      summary: { type: 'string', description: 'A short summary shown in lists and feeds, up to 300 characters; an empty string clears it.' },
      body: { type: 'string', description: 'Markdown, up to 20,000 characters; an empty string clears it.' },
      bodyFormat: { type: 'string', enum: ['markdown', 'html'], description: 'How `body` is written; HTML is cleaned when saved.' },
      tag: { type: 'string', enum: ['new', 'improved', 'fix', 'removed', 'breaking'], description: 'Tag.' },
      area: { type: 'string', description: 'A lowercase label such as web or api: letters, digits and hyphens, up to 40; an empty string clears it. When the project lists its areas (`changelog.areas` in list_projects) it must be one of them.' },
      slug: { type: 'string', description: 'A new URL slug, up to 120 characters. It is made unique for you; an empty string leaves it unchanged.' },
      status: { type: 'string', enum: ['draft', 'published', 'archived'], description: 'State.' },
      publishedAt: { type: 'string', description: 'The date shown, as an ISO date-time; an empty string clears it.' },
      releaseId: { type: 'string', description: 'Move it into this release (from list_changelog_releases); an empty string takes it out of its release. It wins over `releaseVersion`.' },
      releaseVersion: { type: 'string', description: 'Move it into the release with this version (up to 60 characters). A release that does not exist is created already published.' },
      pinned: { type: 'boolean', description: 'Keep it at the top of the changelog.' },
      iconGlyph: { type: 'string', description: 'A glyph shown beside the entry, such as an emoji, up to 80 characters; an empty string clears it.' },
      accentColor: { type: 'string', description: 'A #rrggbb colour that accents the entry; an empty string clears it.' },
      images: { type: 'array', items: { type: 'object' }, description: 'REPLACES the entry\'s pictures: up to 10 (PNG, JPEG, GIF or WebP), the { url, name, mime, size } objects upload_board_comment_attachment returns for this project; an empty list removes them all.' },
      links: { type: 'array', items: { type: 'object' }, description: 'REPLACES the entry\'s links: up to 6, each { label, url } (a label up to 80 characters, an http(s) url up to 500); an empty list removes them all.' },
      commitShas: { type: 'array', items: { type: 'string' }, description: 'REPLACES the git commits it describes: full 40-character SHAs, up to 50; an empty list removes them all.' }
    }
  },
  // ---- errors ----------------------------------------------------------------------------------------,
  {
    name: 'list_errors', title: 'List errors', readOnly: true, method: 'GET', path: '/v1/admin/errors',
    description: 'Issues from the project\'s connected error tracker (GlitchTip, Bugsink, Sentry), newest first. Returns `issues` and `next`: pass `next` as `cursor` for the following page (an empty `next` is the last page; it is also empty when several tracker projects are merged, so name one with `link` to page).',
    params: {
      project: projectId,
      status: { type: 'string', description: 'The tracker\'s own status, e.g. unresolved.' },
      q: { type: 'string', description: 'Search text.' },
      user: { type: 'string', description: 'An end user\'s external id: only the errors they hit. Bugsink cannot filter by user and returns none.' },
      link: { type: 'string', description: 'Only this tracker project (its link id, from `errorLinks` of the project in list_projects; `main` is the first). Left out, every tracker project\'s issues are merged, newest first.' },
      cursor: { type: 'string', description: 'The `next` of the previous page.' },
      limit: { ...limit(100), description: 'How many to return (up to 100). Default 50; Bugsink pages are a fixed size.' }
    }
  },
  {
    name: 'get_error', title: 'Get an error', readOnly: true, method: 'GET', path: '/v1/admin/errors/{id}',
    description: 'One error issue with its latest event: message, stack trace and context.',
    params: {
      id: id('issue'), project: projectId,
      link: { type: 'string', description: 'The tracker project (link) id when the project reports to several; default the first.' }
    }
  },
  // ---- pricing, webhooks -----------------------------------------------------------------------------,
  // ---- people, the conversation as a hub, shipping, automations, events ----------------
  {
    name: 'list_contacts', title: 'List contacts', readOnly: true, method: 'GET', path: '/v1/contacts',
    description: 'A project\'s people, newest first. Filter by segment, tag, subscription, origin, lead form, billing, spend, last change or search text; page with `cursor` (the `nextCursor` of the previous page). `q` returns one page of best matches with no cursor. `email` or `externalId` looks one person up and ignores every other filter. The reply is `{ contacts, nextCursor }`.',
    params: {
      project: projectId,
      q: { type: 'string', description: 'Search name, email and user id.' },
      segment: { type: 'string', description: 'Only this segment\'s people (segment id, from list_segments).' },
      tag: { type: 'string', description: 'Only people with this tag.' },
      subscription: { type: 'string', enum: ['none', 'pending', 'subscribed', 'unsubscribed'], description: 'Marketing consent.' },
      billing: { type: 'string', enum: ['paying', 'never', 'active', 'trialing', 'past_due', 'canceled'], description: 'Stripe status, once Stripe is connected.' },
      minRevenue: { type: 'number', description: 'Only people who have paid more than this in total (Stripe, in the account\'s main currency).' },
      origin: { type: 'string', enum: ['app', 'lead_form', 'signup', 'import', 'sync', 'stripe', 'api', 'panel', 'feedback'], description: 'How they were added.' },
      leadForm: { type: 'string', description: 'Only people who came in through this lead form (its id, from list_lead_forms).' },
      updatedSince: { type: 'string', description: 'ISO date-time: only people changed at or after it.' },
      externalId: { type: 'string', description: 'Look up one person by their id in the host app. Returns at most one contact.' },
      email: { type: 'string', description: 'Look up one person by email address. Returns at most one contact.' },
      cursor: { type: 'string', description: 'The nextCursor of the previous page.' },
      limit: { ...limit(200), description: 'How many to return (up to 200). Default 50.' }
    }
  },
  {
    name: 'get_contact', title: 'Get a contact', readOnly: true, method: 'GET', path: '/v1/contacts/{id}',
    description: 'One person: email, language, tags, subscription and attributes (including the Stripe plan and MRR when Stripe is connected).',
    params: { id: id('contact'), project: projectId }
  },
  {
    name: 'get_contact_activity', title: 'A contact\'s activity', readOnly: true, method: 'GET', path: '/v1/contacts/{id}/activity',
    description: 'Everything one person has done, in one newest-first list: conversations, feedback posts, comments and votes, emails sent to them, sequences, Stripe payments and onboarding. Page backwards with `before`.',
    params: {
      id: id('contact'),
      project: projectId,
      types: { type: 'string', description: 'Comma-separated kinds: joined, conversation, feedback_post, feedback_comment, vote, email, sequence, payment, subscription, onboarding.' },
      before: { type: 'string', description: 'ISO time of the oldest item you have.' },
      limit: limit(200)
    }
  },
  {
    name: 'update_contact', title: 'Update a contact', method: 'PATCH', path: '/v1/contacts/{id}',
    description: 'Change a person\'s name, email, language (a tag such as es or pt-BR), tags or attributes. `tags` REPLACES the whole tag list; `addTags` and `removeTags` change it instead. An `externalId` can only be set on a person who has none. Never subscribe someone to marketing mail on your own: that needs their consent. Returns `{ contact }`.',
    params: {
      id: id('contact'),
      project: { ...projectId, in: 'query' },
      name: { type: 'string', description: 'Their name, up to 120 characters.' },
      email: { type: 'string', description: 'Their email address; it replaces the current one.' },
      externalId: { type: 'string', description: 'Their id in the host app, up to 200 characters. It only takes effect on a person who has none yet.' },
      language: { type: 'string', description: 'A language tag such as es or pt-BR; empty clears it.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'REPLACES all of their tags (up to 50, each up to 40 characters); an empty list clears them. Applied before `addTags` and `removeTags`.' },
      addTags: { type: 'array', items: { type: 'string' }, description: 'Tags to add.' },
      removeTags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove.' },
      attributes: { type: 'object', description: 'Attributes to set; a null value removes one.' }
    }
  },
  // ---- knowledge base --------------------------------------------------------------------------------,
  {
    name: 'list_segments', title: 'List segments', readOnly: true, method: 'GET', path: '/v1/segments',
    description: 'A project\'s saved segments. Rules can use the plan, language, an open conversation, a vote, errors or finished onboarding.',
    params: { project: projectId }
  },
  {
    name: 'list_sequences', title: 'List sequences', readOnly: true, method: 'GET', path: '/v1/sequences',
    description: 'A project\'s automated email sequences with their trigger, steps and counts.',
    params: { project: projectId }
  },
  {
    name: 'enroll_in_sequence', title: 'Add people to a sequence', method: 'POST', path: '/v1/sequences/{id}/enrollments',
    description: 'Put people on an active sequence by hand: up to 100 `contacts` (ids), or everyone in a `segment` (up to 5000 per call; call again if `truncated`). Only subscribed people are emailed; the answer says how many were skipped and why.',
    params: {
      id: id('sequence'),
      project: { ...projectId, in: 'query' },
      contacts: { type: 'array', items: { type: 'string' }, description: 'Contact ids, up to 100. Use this or `segment`.' },
      segment: { type: 'string', description: 'A segment id. Use this or `contacts`.' }
    }
  },
  {
    name: 'list_automation_recipes', title: 'List automation recipes', readOnly: true, method: 'GET', path: '/v1/automations/recipes',
    description: 'Ready-made sequences started by an event: a welcome series, a follow-up after onboarding, a thank-you for feedback, a check-in after support.',
    params: { project: projectId }
  },
  {
    name: 'install_automation_recipe', title: 'Install an automation recipe', method: 'POST', path: '/v1/automations/recipes/{id}/install',
    description: 'Add a recipe to a project as a DRAFT sequence with its emails. Nothing is sent until someone activates the sequence.',
    params: { id: { type: 'string', required: true, description: 'The recipe id, from list_automation_recipes.' }, project: { ...projectId, in: 'query' } }
  },
  {
    name: 'get_conversation_context', title: 'Conversation context', readOnly: true, method: 'GET', path: '/v1/admin/conversations/{id}/context',
    description: 'Who the customer is for one conversation: contact, plan and MRR (when Stripe is connected), their past conversations and the feedback posts linked to it.',
    params: { id: id('conversation') }
  },
  {
    name: 'link_feedback_post', title: 'Link or file a feedback post for a conversation', method: 'POST', path: '/v1/admin/conversations/{id}/feedback-posts',
    description: 'Link (or unlink) an existing feedback post to a conversation, or file a new post for the customer with `create`. The customer follows the post, so they hear when it ships.',
    params: {
      id: id('conversation'),
      postId: { type: 'string', description: 'An existing post: its id or #number.' },
      linked: { type: 'boolean', description: 'false unlinks. Default true.' },
      create: { type: 'object', description: 'File a new post instead: { title, body?, type? }.' }
    }
  },
  {
    name: 'draft_conversation_reply', title: 'Draft a reply with AI', method: 'POST', path: '/v1/admin/conversations/{id}/draft',
    description: 'Ask the project\'s assistant for a draft reply to the customer\'s latest message, grounded in the knowledge base. Nothing is sent or stored: show it to the user, then use reply_to_conversation.',
    params: { id: id('conversation') }
  },
  {
    name: 'save_conversation_faq', title: 'Save an answer as an FAQ', method: 'POST', path: '/v1/admin/conversations/{id}/faq',
    description: 'Save a question and its answer from a conversation to the knowledge base, so the assistant can answer it next time.',
    params: {
      id: id('conversation'),
      question: { type: 'string', required: true, description: 'The question as a customer would ask it.' },
      answer: { type: 'string', required: true, description: 'The answer.' },
      modelId: { type: 'string', description: 'The knowledge model to save it in. Default: the one the assistant reads.' }
    }
  },
  {
    name: 'list_saved_replies', title: 'List saved replies', readOnly: true, method: 'GET', path: '/v1/admin/saved-replies',
    description: 'A project\'s saved replies: reusable answers with {{firstName}} and {{name}} placeholders.',
    params: { project: projectId }
  },
  {
    name: 'create_saved_reply', title: 'Create a saved reply', method: 'POST', path: '/v1/admin/saved-replies',
    description: 'Add a reusable reply. `{{firstName}}` and `{{name}}` are filled with the customer\'s name when it is used.',
    params: {
      project: projectId,
      title: { type: 'string', required: true, description: 'A short name to find it by.' },
      body: { type: 'string', required: true, description: 'The reply text.' },
      shortcut: { type: 'string', description: 'An optional short key such as refund.' }
    }
  },
  {
    name: 'changelog_linked_conversations', title: 'Conversations a changelog entry answers', readOnly: true, method: 'GET', path: '/v1/admin/changelog/entries/{id}/linked-conversations',
    description: 'The conversations linked to a changelog entry (directly or through its board items): the people to tell when it ships.',
    params: { id: id('changelog entry'), project: { type: 'string', description: 'Project id, needed when `id` is an entry number.' } }
  },
  {
    name: 'reply_to_changelog_conversations', title: 'Tell the people a changelog entry answers', method: 'POST', path: '/v1/admin/changelog/entries/{id}/reply-conversations',
    description: 'Send one reply to every conversation linked to a changelog entry (or only the `conversationIds` given), by email too unless told not to. This reaches customers: show the user the text first.',
    params: {
      id: id('changelog entry'),
      project: { type: 'string', description: 'Project id, needed when `id` is an entry number.', in: 'query' },
      body: { type: 'string', required: true, description: 'The message to send.' },
      conversationIds: { type: 'array', items: { type: 'string' }, description: 'Only these conversations. Default: all linked.' },
      notifyByEmail: { type: 'boolean', description: 'Also email the customers. Default true.' }
    }
  },
  {
    name: 'file_error_on_board', title: 'File an error on the board', method: 'POST', path: '/v1/admin/errors/{id}/board',
    description: 'Create a board item for an error from the connected tracker (or return the one already filed). The error\'s conversation is linked to it.',
    params: { id: id('issue'), project: projectId, link: { type: 'string', description: 'The tracker project (link) id when the project has several.' } }
  },
  {
    name: 'list_github_refs', title: 'Commits and pull requests for an item', readOnly: true, method: 'GET', path: '/v1/admin/github-refs',
    description: 'The commits and merged pull requests that mention a board item or feedback post as #12.',
    params: {
      project: projectId,
      kind: { type: 'string', required: true, enum: ['board', 'feedback'], description: 'Whether `id` is a board item or a feedback post.' },
      id: { type: 'string', required: true, description: 'The item or post id, or its number.' }
    }
  },
  {
    name: 'list_webhook_endpoints', title: 'List webhook endpoints', readOnly: true, method: 'GET', path: '/v1/admin/projects/{id}/webhooks',
    description: 'A project\'s webhook endpoints and the events each one receives.',
    params: { id: id('project') }
  },
  {
    name: 'create_webhook_endpoint', title: 'Add a webhook endpoint', destructive: true, method: 'POST', path: '/v1/admin/projects/{id}/webhooks',
    description: 'Post the chosen events to a URL, signed with a secret that is never shown to an assistant (rotate it in the panel\'s webhook list to see a new one). The events carry customer data (people, conversations, feedback), and from now on they are sent to that URL, so confirm the address with the user first. `events` are filters: * (everything), a group such as feedback.*, or an exact type such as changelog.entry.published. A project has at most 10 endpoints and the plan must include event webhooks. Returns `{ endpoint }`.',
    params: {
      id: id('project'),
      url: { type: 'string', required: true, description: 'The http(s) address to post to; use https.' },
      events: { type: 'array', items: { type: 'string' }, description: 'Event filters, at most 30. Default everything.' },
      description: { type: 'string', description: 'What it is for, up to 120 characters.' },
      enabled: { type: 'boolean', description: 'false creates it switched off. Default true.' }
    }
  },
  // ---- email -----------------------------------------------------------------------------------------,
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
      locale: { type: 'string', description: 'The language tag the table\'s own words are written in, such as en or pt-BR (default en). `translations` hold the other languages; one for this language is dropped.' },
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
  },
  // ---- flags, knowledge base, email, campaigns, legal ---------------------------
  {
    name: 'update_project_flags', title: 'Replace a project\'s feature flags', destructive: true, method: 'PATCH', path: '/v1/admin/projects/{id}',
    description: 'REPLACES every feature flag of the project with the list you send, so read the current ones from list_projects first and send them all back with your change. A flag left out is deleted. Apps read these live: confirm with the user first.',
    params: {
      id: id('project'),
      flags: { type: 'array', items: { type: 'object' }, required: true, description: 'Each flag: { key, description?, state: off|admins|on, fallback: off|admins|on, targets?: string[], allow?: string[] (user ids or emails treated as admins) }.' }
    }
  },
  {
    name: 'list_knowledge_models', title: 'List knowledge models', readOnly: true, method: 'GET', path: '/v1/admin/knowledge/models',
    description: 'The knowledge bases (models) of the workspace or one project, with their ids. FAQs belong to one.',
    params: { projectId: { type: 'string', description: 'Only this project\'s models.' } }
  },
  {
    name: 'list_faqs', title: 'List knowledge base answers', readOnly: true, method: 'GET', path: '/v1/admin/knowledge/faqs',
    description: 'FAQs (question, answer, tags, status), filtered or searched; each also lists the assistants that can reach it. Offset paging with `limit` and `skip`; the reply is `{ faqs, total, hasMore }`. Only `active` answers are used by the assistants. Without `modelId` it covers every knowledge model of the workspace.',
    params: {
      modelId: { type: 'string', description: 'A knowledge model id, from list_knowledge_models.' },
      nodeId: { type: 'string', description: 'Only answers in this folder (list_knowledge_nodes).' },
      q: { type: 'string', description: 'Search text. With a `modelId` and a search engine set up it is a typo-tolerant search of question, answer, aliases and tags (and `origin` and `sourceDocumentId` are then not applied); otherwise it matches the question text only.' },
      status: { type: 'string', enum: ['draft', 'active', 'disabled', 'archived', 'outdated'], description: 'Status: active answers are live; outdated ones came from a document that no longer contains them.' },
      origin: { type: 'string', enum: ['manual', 'imported', 'ai-generated', 'api', 'conversation'], description: 'How the answer was made.' },
      sourceDocumentId: { type: 'string', description: 'Only answers imported from this document (list_knowledge_documents).' },
      language: { type: 'string', description: 'Language code.' },
      limit: { ...limit(200), description: 'How many to return (up to 200). Default 50.' },
      skip: { type: 'integer', description: 'How many to skip.' }
    }
  },
  {
    name: 'get_faq', title: 'Get an FAQ', readOnly: true, method: 'GET', path: '/v1/admin/knowledge/faqs/{id}',
    description: 'One knowledge base answer.',
    params: { id: id('FAQ') }
  },
  {
    name: 'create_faq', title: 'Add an FAQ', method: 'POST', path: '/v1/admin/knowledge/faqs',
    description: 'Add a question and answer to a knowledge model. It is `active` unless `status` says otherwise, and active answers are what the project\'s assistants and the public help center use. Fails with 402 when the plan\'s FAQ limit is reached. Returns `{ faq }`.',
    params: {
      modelId: { type: 'string', required: true, description: 'The knowledge model id, from list_knowledge_models.' },
      nodeId: { type: 'string', description: 'The folder to file it in (list_knowledge_nodes), which must belong to the same model. Default: the model\'s root.' },
      question: { type: 'string', required: true, description: 'The question, up to 500 characters.' },
      answer: { type: 'string', description: 'The answer (Markdown), up to 20,000 characters.' },
      aliases: { type: 'array', items: { type: 'string' }, description: 'Other ways to ask it (up to 20, each up to 500 characters).' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags (up to 40, each up to 120 characters).' },
      keywords: { type: 'array', items: { type: 'string' }, description: 'Extra search terms that help find it (up to 40, each up to 120 characters).' },
      status: { type: 'string', enum: ['draft', 'active', 'disabled', 'archived', 'outdated'], description: 'Default active. Only active answers are used by the assistants; there is no `published` status.' },
      language: { type: 'string', description: 'Language code, up to 12 characters. Default en.' }
    }
  },
  {
    name: 'update_faq', title: 'Edit an FAQ', method: 'PATCH', path: '/v1/admin/knowledge/faqs/{id}',
    description: 'Change a question, answer, aliases, tags, keywords, folder, status or language. Only the keys you send change, and a list you send (`aliases`, `tags`, `keywords`) replaces the old one. Editing an imported answer\'s text stops a later re-import overwriting it. Returns `{ faq }`.',
    params: {
      id: id('FAQ'),
      question: { type: 'string', description: 'The question, up to 500 characters.' },
      answer: { type: 'string', description: 'The answer (Markdown), up to 20,000 characters.' },
      aliases: { type: 'array', items: { type: 'string' }, description: 'REPLACES the other ways to ask it (up to 20, each up to 500 characters); an empty list clears them.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'REPLACES the tags (up to 40, each up to 120 characters); an empty list clears them.' },
      keywords: { type: 'array', items: { type: 'string' }, description: 'REPLACES the extra search terms (up to 40, each up to 120 characters); an empty list clears them.' },
      nodeId: { type: 'string', description: 'Move it to this folder (list_knowledge_nodes), which must belong to the same model; an empty string moves it to the model\'s root.' },
      status: { type: 'string', enum: ['draft', 'active', 'disabled', 'archived', 'outdated'], description: 'Only active answers are used by the assistants; there is no `published` status.' },
      language: { type: 'string', description: 'Language code, up to 12 characters; empty resets it to en.' }
    }
  },
  {
    name: 'delete_faq', title: 'Delete an FAQ', destructive: true, method: 'DELETE', path: '/v1/admin/knowledge/faqs/{id}',
    description: 'Permanently remove one answer. Confirm with the user first.',
    params: { id: id('FAQ') }
  },
  {
    name: 'list_knowledge_documents', title: 'List knowledge documents', readOnly: true, method: 'GET', path: '/v1/admin/knowledge/documents',
    description: 'Documents uploaded as sources for a knowledge model (up to 500, newest first), each with how many FAQs came from it, as `{ documents }`. Only the current version of each is listed unless `all` is 1.',
    params: {
      modelId: { type: 'string', description: 'A knowledge model id (from list_knowledge_models). Left out, every model of the workspace.' },
      all: { type: 'string', enum: ['1'], description: 'Also list the versions a newer upload replaced.' }
    }
  },
  {
    name: 'list_email_templates', title: 'List email templates', readOnly: true, method: 'GET', path: '/v1/admin/emails',
    description: 'A project\'s email templates (with send keys), or the shared master templates when no project is given.',
    params: { project: { type: 'string', description: 'Project id.' } }
  },
  {
    name: 'get_email_template', title: 'Get an email template', readOnly: true, method: 'GET', path: '/v1/admin/emails/{id}',
    description: 'One template: subject, design, variables and sample values.',
    params: { id: id('template') }
  },
  {
    name: 'send_test_email', title: 'Send a test email', method: 'POST', path: '/v1/admin/emails/{id}/test',
    description: 'Sends a template, rendered with sample values, to up to five addresses (default: the person who connected this assistant) with "[Test]" in the subject. Real mail leaves the server: confirm the addresses first.',
    params: {
      id: id('template'),
      to: { type: 'array', description: 'Up to five addresses.' },
      variables: { type: 'object', description: 'Values for the template\'s placeholders.' },
      project: { type: 'string', description: 'For a shared master template: whose brand and sender to use.' }
    }
  },
  {
    name: 'list_email_logs', title: 'Email log', readOnly: true, method: 'GET', path: '/v1/admin/email-logs',
    description: 'Every message HelpBites sent or tried to send, newest first. The reply is `{ logs, nextBefore }`: page with `before` set to the previous reply\'s nextBefore.',
    params: {
      project: { type: 'string', description: 'Project id. Leave out for the whole workspace.' },
      to: { type: 'string', description: 'An exact address (with an @), or the start of one.' },
      q: { type: 'string', description: 'The same as `to`; `to` wins when both are sent.' },
      template: { type: 'string', description: 'A template send key.' },
      status: { type: 'string', enum: ['scheduled', 'sent', 'delivered', 'opened', 'clicked', 'unsubscribed', 'bounced', 'complained', 'failed', 'suppressed'], description: 'Delivery status.' },
      source: { type: 'string', description: 'Where it came from: api, admin, test, notification, feedback, system, campaign, sequence or form.' },
      kind: { type: 'string', description: 'What was sent: template, html, document or message.' },
      batch: { type: 'string', description: 'A batch id, e.g. cm_<campaign id> for one campaign\'s recipients.' },
      since: { type: 'string', description: 'ISO date-time.' },
      until: { type: 'string', description: 'ISO date-time.' },
      before: { type: 'string', description: 'The previous reply\'s nextBefore.' },
      limit: { ...limit(200), description: 'How many to return (up to 200). Default 50.' }
    }
  },
  // ---- contacts --------------------------------------------------------------------------------------,
  {
    name: 'list_email_suppressions', title: 'Suppressed addresses', readOnly: true, method: 'GET', path: '/v1/admin/email-suppressions',
    description: 'Addresses a project no longer mails (bounces, complaints, unsubscribes, ones added by hand), newest first. The reply is `{ suppressions, nextBefore }`: pass `nextBefore` as `before` for the next page (null on the last).',
    params: {
      project: { type: 'string', description: 'Project id. Leave out for the whole workspace.' },
      q: { type: 'string', description: 'The start of an address.' },
      reason: { type: 'string', enum: ['bounce', 'complaint', 'unsubscribe', 'manual'], description: 'Only addresses suppressed for this reason.' },
      before: { type: 'string', description: 'ISO date-time: the previous reply\'s `nextBefore`.' },
      limit: { ...limit(500), description: 'How many to return (up to 500). Default 100.' }
    }
  },
  {
    name: 'list_campaigns', title: 'List campaigns', readOnly: true, method: 'GET', path: '/v1/campaigns',
    description: 'Email campaigns, newest first, each with its numbers (sent, opened, clicked).',
    params: { project: { type: 'string', required: true, description: 'Project id, from list_projects.' } }
  },
  {
    name: 'get_campaign', title: 'Get a campaign', readOnly: true, method: 'GET', path: '/v1/campaigns/{id}',
    description: 'One campaign with live numbers, how many people it would go to now, and `problems` that stop it being sent.',
    params: { id: id('campaign'), project: { type: 'string', required: true, in: 'query', description: 'Project id.' } }
  },
  {
    name: 'create_campaign', title: 'Create a campaign draft', method: 'POST', path: '/v1/campaigns',
    description: 'A draft only: a template sent to subscribed contacts, narrowed by a segment or topic. Nothing is sent until update_campaign schedules or sends it. The template must carry {{unsubscribeUrl}} and {{project.address}}.',
    params: {
      project: { type: 'string', required: true, description: 'Project id.' },
      name: { type: 'string', required: true, description: 'Campaign name.' },
      template: { type: 'string', required: true, description: 'Template send key or id, from list_email_templates.' },
      subject: { type: 'string', description: 'Overrides the template\'s subject.' },
      audience: { type: 'object', description: '{ segment?: segment id (list_segments), topic?: topic to respect }.' },
      testMode: { type: 'boolean', description: 'Log every message but deliver none.' }
    }
  },
  {
    name: 'update_campaign', title: 'Edit, schedule, send, pause or cancel a campaign', destructive: true, method: 'PATCH', path: '/v1/campaigns/{id}',
    description: 'Edit a draft\'s content, or move it with `status`: scheduled (with scheduledAt), sending (SENDS NOW to real people, or resumes a paused one), paused, canceled, draft (unschedule). Sending cannot be taken back: show the user the audience size from get_campaign and get a clear yes first.',
    params: {
      id: id('campaign'),
      project: { type: 'string', required: true, in: 'body', description: 'Project id.' },
      name: { type: 'string', description: 'Campaign name.' },
      template: { type: 'string', description: 'Template send key or id.' },
      subject: { type: 'string', description: 'Subject override.' },
      audience: { type: 'object', description: '{ segment?, topic? }.' },
      testMode: { type: 'boolean', description: 'Log every message but deliver none.' },
      status: { type: 'string', enum: ['draft', 'scheduled', 'sending', 'paused', 'canceled'], description: 'Move the campaign.' },
      scheduledAt: { type: 'string', description: 'ISO date-time, with status scheduled.' }
    }
  },
  {
    name: 'list_legal_documents', title: 'List legal documents', readOnly: true, method: 'GET', path: '/v1/admin/legal/documents',
    description: 'A project\'s legal documents (privacy policy, terms…), drafts included, with sections, summary, status and public path.',
    params: { project: { type: 'string', required: true, description: 'Project id, from list_projects.' } }
  },
  {
    name: 'get_legal_document', title: 'Get a legal document', readOnly: true, method: 'GET', path: '/v1/admin/legal/documents/{id}',
    description: 'One document with its sections and how well the applicable rules are covered.',
    params: { id: id('legal document') }
  },
  {
    name: 'update_legal_document', title: 'Edit a legal document', method: 'PATCH', path: '/v1/admin/legal/documents/{id}',
    description: 'Change `sections` (the FULL list: an unknown id is added, one left out is removed) and/or the `tldr` summary. Editing a published document changes the live page at once: confirm with the user first.',
    params: {
      id: id('legal document'),
      sections: { type: 'array', items: { type: 'object' }, description: 'Every section: { id, body, locked? }, taken from get_legal_document.' },
      tldr: { type: 'string', description: 'The plain-language summary.' }
    }
  },
  {
    name: 'publish_legal_document', title: 'Publish a legal document', method: 'POST', path: '/v1/admin/legal/documents/{id}/publish',
    description: 'Makes the document public at its path and records a version. Visitors will read it: ask the user first.',
    params: { id: id('legal document'), note: { type: 'string', description: 'A note for the version history.' } }
  },
  {
    name: 'unpublish_legal_document', title: 'Take a legal document offline', method: 'POST', path: '/v1/admin/legal/documents/{id}/unpublish',
    description: 'Back to draft: its public path answers 404. Versions are kept.',
    params: { id: id('legal document') }
  },

  // ======== inbox, team and AI assistants ========
  // ---- the team and what needs attention ----------------------------------------------
  {
    name: 'list_team_members', title: 'List the team', readOnly: true, method: 'GET', path: '/v1/admin/agents',
    description: 'Everyone in the workspace with their role (owner, admin or agent): the reply\'s `agents` list has id, name, username, email, role and createdAt. Use an id as `assigneeId` in update_conversation or as `assignee` in list_conversations. Needs a key that is not limited to some projects.',
    params: {}
  },
  {
    name: 'get_workspace_attention', title: 'What needs attention', readOnly: true, method: 'GET', path: '/v1/admin/attention',
    description: 'What waits on someone, in one list: changelog drafts awaiting approval, contact and Stripe syncs that failed, emails that bounced or failed in the last 7 days, error alerts from the last day, a paused sender, and per project the open error reports, knowledge documents that would not process and feedback awaiting triage. Returns `unreadMessages` (the inbox badge), `total` and `items` (key, kind, projectId, count, value, detail, section, at), newest first. A key limited to some projects sees only those. Cached for 15 seconds.',
    params: { fresh: { type: 'boolean', description: 'true skips the 15-second cache and reads the list again now.' } }
  },
  {
    name: 'get_unread_count', title: 'Unread inbox count', readOnly: true, method: 'GET', path: '/v1/admin/unread',
    description: 'The inbox badge: how many customer messages wait on a reply, outside the archive, across the workspace, as `{ unreadMessages }`. Never cached; the total stops at 1,000 conversations. For unread conversations per project use list_conversations (`unreadByProject`) or get_overview.',
    params: {}
  },
  // ---- starting, closing, reading and deleting conversations ---------------------------
  {
    name: 'start_conversation', title: 'Start a conversation with a customer', destructive: true, method: 'POST', path: '/v1/admin/conversations',
    description: 'Opens a new conversation with a customer and sends them the first message from the team, even if they never used the chat: pass the host app\'s user id as `externalId` and the customer is found or created in the project. The `name` and `email` you give replace the ones on record. Emails them the message when they have an address, unless `notifyByEmail` is false. Returns the conversation, the message, the customer and whether the email went out (`emailSent`, `emailError`). This reaches a real person and cannot be taken back: confirm the wording and the recipient with the user first.',
    params: {
      projectId: { type: 'string', required: true, description: 'Project id, from list_projects.' },
      externalId: { type: 'string', required: true, description: 'The customer\'s id in the host app, up to 200 characters. The same id in the same project is always the same customer; search_end_users finds existing ones.' },
      body: { type: 'string', required: true, description: 'The first message, as plain text or Markdown, up to 8,000 characters.' },
      name: { type: 'string', description: 'The customer\'s name. It replaces the one on record.' },
      email: { type: 'string', description: 'The customer\'s email address, where the message is sent. It replaces the one on record, so leave it out for a customer who already has one.' },
      subject: { type: 'string', description: 'A subject line, up to 200 characters.' },
      type: { type: 'string', description: 'The conversation type\'s key, from list_conversation_types. Default support.' },
      fields: { type: 'object', description: 'Values for the type\'s intake fields, by field key (the keys are in list_conversation_types).' },
      subjectRef: { type: 'object', description: 'What the conversation is about, as the host app describes it: { type, id, label, url?, thumbnailUrl?, ownerId?, ownerLabel? }. Shown as a card on the conversation.' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priority. Default: the type\'s default priority.' },
      assistantId: { type: 'string', description: 'The AI assistant that answers this conversation: its id or slug, from list_assistants. An unknown one is ignored.' },
      notifyByEmail: { type: 'boolean', description: 'Set false to skip the email notification. Default true.' }
    }
  },
  {
    name: 'delete_conversation', title: 'Delete a conversation', destructive: true, method: 'DELETE', path: '/v1/admin/conversations/{id}',
    description: 'Permanently removes the conversation and all of its messages, for the customer too. Archive it with archive_conversation to keep the history. Confirm with the user first.',
    params: { id: id('conversation') }
  },
  {
    name: 'set_conversation_status', title: 'Open or close a conversation', method: 'POST', path: '/v1/admin/conversations/{id}/status',
    description: 'Moves a conversation to another status of its type, for example closing it (`done`) or reopening it (`open`). The built-in support type has open and done; other types list theirs in list_conversation_types. Adds a status.changed entry to its timeline and returns `{ conversation }`. update_conversation does the same together with priority, tags and assignee.',
    params: { id: id('conversation'), status: { type: 'string', required: true, description: 'A status key of the conversation\'s type, e.g. open or done.' } }
  },
  {
    name: 'mark_conversation_read', title: 'Mark a conversation read or unread', method: 'POST', path: '/v1/admin/conversations/{id}/read',
    description: 'Marks a conversation read by the team (its unread count goes to 0) or, with `read` false, unread again (the count goes to 1). The customer is not told. Returns `{ conversation }`.',
    params: { id: id('conversation'), read: { type: 'boolean', description: 'false marks it unread. Default true.' } }
  },
  {
    name: 'get_conversation_suggestions', title: 'FAQs and saved replies for a conversation', readOnly: true, method: 'GET', path: '/v1/admin/conversations/{id}/suggestions',
    description: 'Answers to reach for in a conversation: `faqs` (id, question, answer) from the knowledge the project\'s assistants can read, and `savedReplies` (id, title, body, shortcut). With `q` both are searched for it; without, the FAQs answer the customer\'s latest message and the replies are listed by title. A saved reply still has its {{firstName}} and {{name}} placeholders: fill them from the customer before sending with reply_to_conversation.',
    params: { id: id('conversation'), q: { type: 'string', description: 'What to look for, up to 200 characters.' } }
  },
  {
    name: 'run_conversation_action', title: 'Run a host action on a conversation', destructive: true, method: 'POST', path: '/v1/admin/conversations/{id}/actions/{key}',
    description: 'Runs one of the actions configured on the conversation\'s type (the type\'s `actions` in list_conversation_types; the conversation\'s `type` is in get_conversation). HelpBites notes it on the timeline, then calls the project\'s action webhook, and the host app does the work: it can delete or change things outside HelpBites and cannot be taken back. Some actions then move the conversation to another status. Answers 409 when the project has no action webhook set up and 502 when the host app is down or refuses. Returns `{ conversation, event, result }`. Confirm with the user first.',
    params: {
      id: id('conversation'),
      key: { type: 'string', required: true, description: 'The action\'s key, from the type\'s `actions`.' },
      note: { type: 'string', description: 'An internal note recorded on the conversation first, up to 8,000 characters. Required when the action says `requiresNote`.' }
    }
  },
  // ---- messages ------------------------------------------------------------------------
  {
    name: 'unsend_message', title: 'Unsend a team message', destructive: true, method: 'DELETE', path: '/v1/admin/messages/{id}',
    description: 'Deletes a message or note the team sent from its conversation, for the customer too, and recalculates the conversation\'s preview and unread counts. A reply that was already emailed stays in the customer\'s inbox. Only team messages can be unsent: a customer\'s own message answers 403. Confirm with the user first.',
    params: { id: { type: 'string', required: true, description: 'The message\'s id, from get_conversation_messages.' } }
  },
  {
    name: 'toggle_message_reaction', title: 'Add or remove a tapback', method: 'POST', path: '/v1/admin/messages/{id}/reactions',
    description: 'Adds a tapback from the operator to a message, or removes it when the operator already used that emoji. The customer sees tapbacks on public messages. Not possible on timeline events. Returns `{ message }` with its reactions.',
    params: {
      id: { type: 'string', required: true, description: 'The message\'s id, from get_conversation_messages.' },
      emoji: { type: 'string', required: true, enum: ['❤️', '👍', '👎', '😆', '❗', '❓'], description: 'The tapback: one of the six emoji listed.' }
    }
  },
  // ---- conversation types ----------------------------------------------------------------
  {
    name: 'list_conversation_types', title: 'List conversation types', readOnly: true, method: 'GET', path: '/v1/admin/projects/{id}/types',
    description: 'A project\'s conversation (ticket) types, as `types`: each has a key, name, statuses (key, label, category open, pending, resolved or closed), intake fields, host actions, whether it is assignable and its default priority. The built-in `support` type (open and done) is always listed, even without a saved row; then it has no `id`.',
    params: { id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' } }
  },
  {
    name: 'create_conversation_type', title: 'Create a conversation type', method: 'POST', path: '/v1/admin/projects/{id}/types',
    description: 'Adds a ticket type to a project, for example a report or a feature request with its own statuses, intake fields and host actions. The key must be unique in the project (409 otherwise); to customise the built-in support type, create one with key `support`. Needs an owner or admin and a key that is not limited to some projects. Returns `{ type }`.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      key: { type: 'string', required: true, description: 'What conversations store and the API names it by: lowercase letters, digits, dashes and underscores, up to 40 (other characters are dropped).' },
      name: { type: 'string', required: true, description: 'The type\'s name, up to 80 characters.' },
      description: { type: 'string', description: 'What it is for, up to 300 characters.' },
      icon: { type: 'string', description: 'An icon name for the panel, such as i-lucide-bug, up to 80 characters.' },
      statuses: { type: 'array', items: { type: 'object' }, description: 'The statuses, at most 20, each { key, label, category: open|pending|resolved|closed, isDefault?, isTerminal?, reopenTo? (a status key) }. Keys are unique and exactly one is the default (the first when none is marked). Default: open and done.' },
      fields: { type: 'array', items: { type: 'object' }, description: 'Intake fields, at most 50, each { key, label, type: text|longtext|select|url|number|bool, required?, options? (a select needs them), private? (hidden from the customer), editableBy?: user|agent|none }.' },
      actions: { type: 'array', items: { type: 'object' }, description: 'Host actions, at most 30, each { key, label, confirm?, destructive?, statusAfter? (a status key to move to), requiresNote? }. Running one calls the project\'s action webhook (run_conversation_action).' },
      assignable: { type: 'boolean', description: 'Whether conversations of this type can be assigned to a teammate.' },
      userCanReopen: { type: 'boolean', description: 'Whether the customer can reopen a closed conversation by writing again.' },
      defaultPriority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priority of a new conversation of this type. Default normal.' }
    }
  },
  {
    name: 'update_conversation_type', title: 'Update a conversation type', method: 'PATCH', path: '/v1/admin/projects/{id}/types/{typeId}',
    description: 'Edits a conversation type; only the keys you send change, but `statuses`, `fields` and `actions` REPLACE the whole list, so read it with list_conversation_types and send everything back. Existing conversations keep the status and values they stored: do not drop a status or field they still use. The type\'s key cannot be changed here. Needs an owner or admin and a key that is not limited to some projects. Returns `{ type }`.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      typeId: { type: 'string', required: true, description: 'The type\'s id, the `id` in list_conversation_types (the built-in support type has none until you create it with create_conversation_type).' },
      name: { type: 'string', description: 'The type\'s name, up to 80 characters.' },
      description: { type: 'string', description: 'What it is for, up to 300 characters; an empty string clears it.' },
      icon: { type: 'string', description: 'An icon name for the panel, such as i-lucide-bug; an empty string clears it.' },
      statuses: { type: 'array', items: { type: 'object' }, description: 'REPLACES all statuses, at most 20, each { key, label, category: open|pending|resolved|closed, isDefault?, isTerminal?, reopenTo? }. Keys are unique, exactly one is the default (the first when none is marked), and at least one is needed.' },
      fields: { type: 'array', items: { type: 'object' }, description: 'REPLACES all intake fields, at most 50, each { key, label, type: text|longtext|select|url|number|bool, required?, options?, private?, editableBy?: user|agent|none }. An empty list removes them all.' },
      actions: { type: 'array', items: { type: 'object' }, description: 'REPLACES all host actions, at most 30, each { key, label, confirm?, destructive?, statusAfter?, requiresNote? }. An empty list removes them all.' },
      assignable: { type: 'boolean', description: 'Whether conversations of this type can be assigned to a teammate.' },
      userCanReopen: { type: 'boolean', description: 'Whether the customer can reopen a closed conversation by writing again.' },
      defaultPriority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Priority of a new conversation of this type.' }
    }
  },
  {
    name: 'delete_conversation_type', title: 'Delete a conversation type', destructive: true, method: 'DELETE', path: '/v1/admin/projects/{id}/types/{typeId}',
    description: 'Deletes a type that no conversation uses (409 otherwise). The built-in `support` type cannot be deleted. Needs an owner or admin and a key that is not limited to some projects. Confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      typeId: { type: 'string', required: true, description: 'The type\'s id, the `id` in list_conversation_types.' }
    }
  },
  // ---- saved replies ---------------------------------------------------------------------
  {
    name: 'update_saved_reply', title: 'Edit a saved reply', method: 'PATCH', path: '/v1/admin/saved-replies/{id}',
    description: 'Changes a saved reply; only the keys you send change. A shortcut another reply of the project already has answers 409. Returns `{ reply }`.',
    params: {
      id: { type: 'string', required: true, description: 'The saved reply\'s id, from list_saved_replies.' },
      title: { type: 'string', description: 'A short name to find it by, up to 120 characters.' },
      body: { type: 'string', description: 'The reply text, up to 8,000 characters. {{firstName}} and {{name}} are filled with the customer\'s name when it is used.' },
      shortcut: { type: 'string', description: 'A short key: letters, digits, dash and underscore, up to 30, unique in the project (a leading slash is ignored). An empty string clears it.' }
    }
  },
  {
    name: 'delete_saved_reply', title: 'Delete a saved reply', destructive: true, method: 'DELETE', path: '/v1/admin/saved-replies/{id}',
    description: 'Permanently removes one saved reply. Confirm with the user first.',
    params: { id: { type: 'string', required: true, description: 'The saved reply\'s id, from list_saved_replies.' } }
  },
  // ---- AI support assistants (not teammates) ----------------------------------------------
  {
    name: 'list_assistants', title: 'List AI assistants', readOnly: true, method: 'GET', path: '/v1/admin/support-agents',
    description: 'The AI support assistants, not teammates (see list_team_members). The reply\'s `agents` list holds id, projectId (empty for one shared across the workspace), name, slug, description, status (active, disabled or draft), systemPrompt, model, endpoint, hasApiKey (whether a provider key is saved: the key itself is never returned), temperature, autoReply, fallbackBehavior, minConfidence, rules and defaultAction. A key limited to some projects sees only theirs.',
    params: { projectId: { type: 'string', description: 'Only this project\'s assistants (project id, from list_projects). Left out, every one.' } }
  },
  {
    name: 'get_assistant', title: 'Get an AI assistant', readOnly: true, method: 'GET', path: '/v1/admin/support-agents/{id}',
    description: 'One AI assistant with its settings (as in list_assistants), `llm` (whether an AI provider is set up for it, its model and whose it is: assistant, workspace or platform) and `readiness`: `checks` says what it still needs before it answers customers by itself (`llm`, `knowledge`, `active`, `autoReply`), `canAnswer` whether it can answer a test and `live` whether it answers real customers right now. Provider keys are never returned.',
    params: { id: { type: 'string', required: true, description: 'The assistant\'s id, from list_assistants.' } }
  },
  {
    name: 'create_assistant', title: 'Create an AI assistant', method: 'POST', path: '/v1/admin/support-agents',
    description: 'Adds an AI support assistant that answers customers from the knowledge base. It starts as a draft with auto-reply off; give it knowledge with add_assistant_assignment, test it with test_assistant_answer, and turn `status` active and `autoReply` on only when the user says so. Its AI provider key can only be set in the panel. Needs an owner or admin; counts against the plan\'s assistant limit (402 when reached). Returns `{ agent }`.',
    params: {
      name: { type: 'string', required: true, description: 'The assistant\'s name, up to 120 characters.' },
      description: { type: 'string', description: 'What it is for, up to 2,000 characters.' },
      projectId: { type: 'string', description: 'The project it belongs to, from list_projects. Left out, it is shared across the workspace (not allowed for a key limited to some projects).' },
      slug: { type: 'string', description: 'A short name for embeds to pick it by: lowercase letters, digits and dashes, up to 40. Default: from the name.' },
      status: { type: 'string', enum: ['active', 'disabled', 'draft'], description: 'Default draft.' },
      systemPrompt: { type: 'string', description: 'Instructions for the model: tone, what to cover, what to refuse. Up to 8,000 characters.' },
      model: { type: 'string', description: 'The model name at its AI provider. Left empty, the default is used.' },
      temperature: { type: 'number', description: 'From 0 (steady) to 2 (varied). Default 0.2.' },
      autoReply: { type: 'boolean', description: 'true lets an active assistant answer customers by itself. Default false.' },
      fallbackBehavior: { type: 'string', enum: ['human', 'silent'], description: 'When it is unsure: `human` (default) hands the conversation to the team with a needs-human label, `silent` leaves the message unanswered.' },
      minConfidence: { type: 'number', description: 'From 0 to 1: the best knowledge match must score at least this before an answer is sent. 0 (default) means no bar.' },
      defaultAction: { type: 'string', enum: ['auto', 'human'], description: 'What to do with a message no rule matches: `auto` (default) tries to answer, `human` leaves it to the team.' },
      rules: { type: 'array', items: { type: 'object' }, description: 'Routing rules, at most 20, first match wins: each { action: auto|human, conversationType?: a type key, keywords?: up to 20 words, any of which may match }. A rule needs a conversationType or a keyword, or it is dropped.' }
    }
  },
  {
    name: 'update_assistant', title: 'Update an AI assistant', method: 'PATCH', path: '/v1/admin/support-agents/{id}',
    description: 'Changes an AI assistant; only the keys you send change, but `rules` REPLACES the whole list. Its AI provider and key can only be changed in the panel. Setting `status` active together with `autoReply` true makes it answer real customers on its own: confirm with the user first. Needs an owner or admin. Returns `{ agent }`.',
    params: {
      id: { type: 'string', required: true, description: 'The assistant\'s id, from list_assistants.' },
      name: { type: 'string', description: 'The assistant\'s name, up to 120 characters.' },
      description: { type: 'string', description: 'What it is for, up to 2,000 characters; an empty string clears it.' },
      projectId: { type: 'string', description: 'Move it to another project of the workspace (id from list_projects). An empty string makes it shared across the workspace.' },
      slug: { type: 'string', description: 'The short name embeds pick it by: lowercase letters, digits and dashes. Changing it breaks embeds that name the old one.' },
      status: { type: 'string', enum: ['active', 'disabled', 'draft'], description: 'Whether it can run.' },
      systemPrompt: { type: 'string', description: 'Instructions for the model, up to 8,000 characters; an empty string clears them.' },
      model: { type: 'string', description: 'The model name at its AI provider; an empty string goes back to the default.' },
      temperature: { type: 'number', description: 'From 0 (steady) to 2 (varied).' },
      autoReply: { type: 'boolean', description: 'true lets an active assistant answer customers by itself.' },
      fallbackBehavior: { type: 'string', enum: ['human', 'silent'], description: 'When it is unsure: `human` hands the conversation to the team, `silent` leaves the message unanswered.' },
      minConfidence: { type: 'number', description: 'From 0 to 1: the best knowledge match must score at least this before an answer is sent. 0 means no bar.' },
      defaultAction: { type: 'string', enum: ['auto', 'human'], description: 'What to do with a message no rule matches: `auto` tries to answer, `human` leaves it to the team.' },
      rules: { type: 'array', items: { type: 'object' }, description: 'REPLACES all routing rules, at most 20, first match wins: each { action: auto|human, conversationType?: a type key, keywords?: up to 20 words, any of which may match }. An empty list removes them all.' }
    }
  },
  {
    name: 'delete_assistant', title: 'Delete an AI assistant', destructive: true, method: 'DELETE', path: '/v1/admin/support-agents/{id}',
    description: 'Permanently removes an AI assistant and its knowledge assignments. The FAQs it read stay. If it was answering customers, they get no AI replies any more. Needs an owner or admin. Confirm with the user first.',
    params: { id: { type: 'string', required: true, description: 'The assistant\'s id, from list_assistants.' } }
  },
  {
    name: 'duplicate_assistant', title: 'Duplicate an AI assistant', method: 'POST', path: '/v1/admin/support-agents/{id}/duplicate',
    description: 'Makes a draft copy named "<name> (copy)" with auto-reply off, taking its description, instructions, model, endpoint, temperature, fallback and knowledge assignments. The provider key is not copied, and neither are the routing rules, confidence bar or default action: set those on the copy with update_assistant. Needs an owner or admin; counts against the plan\'s assistant limit (402 when reached). Returns `{ agent }`.',
    params: { id: { type: 'string', required: true, description: 'The assistant\'s id to copy, from list_assistants.' } }
  },
  {
    name: 'list_assistant_assignments', title: 'List an assistant\'s knowledge assignments', readOnly: true, method: 'GET', path: '/v1/admin/support-agents/{id}/assignments',
    description: 'The knowledge an assistant is explicitly given, as `assignments`: id, scope (model, path or faq), modelId, nodeId, pathCache, faqId and `exclude` (true keeps that part out; exclusions win). An assistant with no granting assignment reads nothing.',
    params: { id: { type: 'string', required: true, description: 'The assistant\'s id, from list_assistants.' } }
  },
  {
    name: 'add_assistant_assignment', title: 'Give an assistant knowledge', method: 'POST', path: '/v1/admin/support-agents/{id}/assignments',
    description: 'Grants an assistant a whole knowledge model (`scope` model), a path of the knowledge tree with everything under it (`path`) or one answer (`faq`), or with `exclude` true keeps that part out of what a wider grant gives. Pass the id that matches the scope. Needs an owner or admin. Returns `{ assignment }`; remove it with remove_assistant_assignment.',
    params: {
      id: { type: 'string', required: true, description: 'The assistant\'s id, from list_assistants.' },
      scope: { type: 'string', required: true, enum: ['model', 'path', 'faq'], description: 'What is granted: a whole knowledge model, a path (node) of its tree with its subtree, or one FAQ.' },
      modelId: { type: 'string', description: 'The knowledge model\'s id, from list_knowledge_models. Required for scope model.' },
      nodeId: { type: 'string', description: 'The id of a path (node) in a knowledge model\'s tree. Required for scope path.' },
      faqId: { type: 'string', description: 'The FAQ\'s id, from list_faqs. Required for scope faq.' },
      exclude: { type: 'boolean', description: 'true keeps this part out of what the assistant may read instead of granting it. Default false.' }
    }
  },
  {
    name: 'remove_assistant_assignment', title: 'Remove an assistant\'s knowledge assignment', destructive: true, method: 'DELETE', path: '/v1/admin/support-agents/{id}/assignments/{assignmentId}',
    description: 'Removes one grant or exclusion, so the assistant may read (or be kept from) that knowledge by the other assignments only. The knowledge itself is untouched; add it back with add_assistant_assignment. Needs an owner or admin.',
    params: {
      id: { type: 'string', required: true, description: 'The assistant\'s id, from list_assistants.' },
      assignmentId: { type: 'string', required: true, description: 'The assignment\'s id, from list_assistant_assignments.' }
    }
  },
  {
    name: 'get_assistant_knowledge', title: 'Knowledge an assistant can reach', readOnly: true, method: 'GET', path: '/v1/admin/support-agents/{id}/knowledge',
    description: 'The active FAQs an assistant can read right now, with its assignments applied: `faqs` (id, question, pathCache, status, modelId, up to 200) and `count`.',
    params: { id: { type: 'string', required: true, description: 'The assistant\'s id, from list_assistants.' } }
  },
  {
    name: 'test_assistant_retrieval', title: 'Test an assistant\'s retrieval', method: 'POST', path: '/v1/admin/support-agents/{id}/retrieve',
    description: 'Looks up the knowledge an assistant would be given for a question, the same retrieval the support runtime uses, respecting its assignments and FAQ status. Saves nothing and writes no answer. Returns `{ results }`.',
    params: {
      id: { type: 'string', required: true, description: 'The assistant\'s id, from list_assistants.' },
      query: { type: 'string', required: true, description: 'The question to look up, as a customer would write it.' },
      limit: { type: 'integer', maximum: 20, description: 'How many results to return (1 to 20). Default 8.' }
    }
  },
  {
    name: 'generate_assistant_answer', title: 'Generate a test answer', method: 'POST', path: '/v1/admin/support-agents/{id}/generate',
    description: 'Has an assistant answer a question the way it would for a customer: retrieval, then an answer grounded in what it found. Saves nothing and touches no conversation. Counts against the workspace\'s AI credits like a real answer; answers 400 when the assistant has no AI provider. Returns `{ answer, model, knowledge }`. test_assistant_answer also says what the assistant would decide.',
    params: {
      id: { type: 'string', required: true, description: 'The assistant\'s id, from list_assistants.' },
      query: { type: 'string', required: true, description: 'The question to answer, as a customer would write it.' }
    }
  },
  {
    name: 'test_assistant_answer', title: 'Test what an assistant would do', method: 'POST', path: '/v1/admin/support-agents/{id}/test-answer',
    description: 'Runs the decision the support runtime makes for a customer\'s message, without touching any conversation: its routing rules first, then the knowledge it may read and its confidence bar. `decision.outcome` is `answer`, `handoff` (the team gets it) or `silent`, `decision.reason` says why (rule, default, noKnowledge, lowConfidence, confident) and `live` whether the assistant answers customers by itself right now. When it would answer and has an AI provider, `answer` holds the reply it would send, which counts against AI credits like a real one. Saves nothing.',
    params: {
      id: { type: 'string', required: true, description: 'The assistant\'s id, from list_assistants.' },
      query: { type: 'string', required: true, description: 'The customer\'s message to test, up to 4,000 characters.' },
      conversationType: { type: 'string', description: 'The conversation type key to pretend the message arrived as, since rules can depend on it. Default support.' }
    }
  },

  // ======== knowledge base, feedback and changelog ========
  // ---- knowledge base: models ---------------------------------------------------
  {
    name: 'get_knowledge_model', title: 'Get a knowledge model', readOnly: true, method: 'GET', path: '/v1/admin/knowledge/models/{id}',
    description: 'One knowledge base (model): name, slug, description, status (active, draft or archived), icon, default language, metadata and the project it belongs to.',
    params: { id: id('knowledge model') }
  },
  {
    name: 'create_knowledge_model', title: 'Create a knowledge model', method: 'POST', path: '/v1/admin/knowledge/models',
    description: 'Creates an empty knowledge base for a project; FAQs and folders belong to one. It starts active unless `status` says otherwise. Fails with 402 when the plan\'s knowledge model limit is reached. Returns `{ model }` with the id to use in create_faq and create_knowledge_node.',
    params: {
      projectId: { type: 'string', required: true, description: 'The project it belongs to, from list_projects.' },
      name: { type: 'string', required: true, description: 'Its name, up to 120 characters.' },
      slug: { type: 'string', description: 'A URL-friendly key. Default: made from the name.' },
      description: { type: 'string', description: 'What the knowledge base covers, up to 2,000 characters.' },
      status: { type: 'string', enum: ['active', 'draft', 'archived'], description: 'Default active.' },
      icon: { type: 'string', description: 'An icon name or emoji, up to 60 characters.' },
      defaultLanguage: { type: 'string', description: 'A language code such as en or es. Default en.' },
      metadata: { type: 'object', description: 'Free-form data kept with the model.' }
    }
  },
  {
    name: 'update_knowledge_model', title: 'Update a knowledge model', method: 'PATCH', path: '/v1/admin/knowledge/models/{id}',
    description: 'Changes a knowledge base; only the fields you send change. An empty string clears `description` or `icon`. Set status `archived` to retire one instead of deleting it.',
    params: {
      id: id('knowledge model'),
      name: { type: 'string', description: 'New name, up to 120 characters.' },
      slug: { type: 'string', description: 'New URL-friendly key.' },
      description: { type: 'string', description: 'What it covers, up to 2,000 characters; empty clears it.' },
      status: { type: 'string', enum: ['active', 'draft', 'archived'], description: 'Its state.' },
      icon: { type: 'string', description: 'An icon name or emoji, up to 60 characters; empty clears it.' },
      defaultLanguage: { type: 'string', description: 'A language code such as en or es.' },
      metadata: { type: 'object', description: 'Free-form data kept with the model; replaces the old object.' }
    }
  },
  {
    name: 'delete_knowledge_model', title: 'Delete a knowledge model', destructive: true, method: 'DELETE', path: '/v1/admin/knowledge/models/{id}',
    description: 'Permanently deletes a knowledge base AND everything in it: its FAQs, folders, uploaded documents, the assistants\' access to it and its search index. Without `confirm` it deletes nothing and returns the impact (`{ deleted: false, impact: { faqs, nodes, documents, agents } }`): call it that way first and show the user. With `confirm` true it deletes. Prefer update_knowledge_model with status archived. Confirm with the user first.',
    params: { id: id('knowledge model'), confirm: { type: 'boolean', description: 'true really deletes. Left out or false, it only reports what would be lost.' } }
  },
  {
    name: 'get_knowledge_model_dashboard', title: 'Knowledge model numbers', readOnly: true, method: 'GET', path: '/v1/admin/knowledge/models/{id}/dashboard',
    description: 'Counts for one knowledge base: FAQs in total, active, draft and outdated, folders, documents (and how many failed), FAQs waiting for the search index (`needsReindex`), the assistants using it and when a document was last processed.',
    params: { id: id('knowledge model') }
  },
  {
    name: 'duplicate_knowledge_model', title: 'Duplicate a knowledge model', method: 'POST', path: '/v1/admin/knowledge/models/{id}/duplicate',
    description: 'Copies a knowledge base with its folders and FAQs into a new draft model named "… (copy)". Every copied FAQ is a DRAFT, so the copy answers nothing until they are published (see bulk_update_faqs). Uploaded documents are not copied. Fails with 402 when the plan\'s model or FAQ limit would be passed, and nothing is made. Returns `{ model }`.',
    params: { id: id('knowledge model') }
  },
  {
    name: 'reindex_knowledge_model', title: 'Rebuild a knowledge model\'s search index', method: 'POST', path: '/v1/admin/knowledge/models/{id}/reindex',
    description: 'Re-indexes every FAQ of the knowledge base for search, regenerating embeddings when available. Runs in the background and is safe to repeat; watch `needsReindex` in get_knowledge_model_dashboard fall to 0. Returns `{ started: true }`.',
    params: { id: id('knowledge model') }
  },
  // ---- knowledge base: folders (nodes) -----------------------------------------
  {
    name: 'list_knowledge_nodes', title: 'List knowledge folders', readOnly: true, method: 'GET', path: '/v1/admin/knowledge/nodes',
    description: 'The folder tree of one knowledge base. Returns `nodes` (a flat list in path order, each with id, parentId, name, slug, description, order, depth and pathCache such as "Billing/Refunds") and `tree` (the same, nested). Use a node id as `nodeId` or `parentId` elsewhere.',
    params: { modelId: { type: 'string', required: true, description: 'The knowledge model id, from list_knowledge_models.' } }
  },
  {
    name: 'create_knowledge_node', title: 'Create a knowledge folder', method: 'POST', path: '/v1/admin/knowledge/nodes',
    description: 'Adds a folder (path node) to a knowledge base, at the top level or under a parent, after its siblings. Returns `{ node }`.',
    params: {
      modelId: { type: 'string', required: true, description: 'The knowledge model id, from list_knowledge_models.' },
      name: { type: 'string', required: true, description: 'The folder\'s name, up to 120 characters.' },
      parentId: { type: 'string', description: 'The parent folder\'s id, from list_knowledge_nodes; it must be in the same model. Left out, the folder goes at the top level.' },
      description: { type: 'string', description: 'What the folder holds, up to 2,000 characters.' }
    }
  },
  {
    name: 'update_knowledge_node', title: 'Rename or move a knowledge folder', method: 'PATCH', path: '/v1/admin/knowledge/nodes/{id}',
    description: 'Renames, moves or reorders a folder; only the fields you send change. Moving or renaming changes the path of everything beneath it, so its FAQs are re-indexed. A folder cannot be its own parent or move under its own descendant.',
    params: {
      id: id('folder'),
      name: { type: 'string', description: 'New name, up to 120 characters.' },
      description: { type: 'string', description: 'What the folder holds, up to 2,000 characters; empty clears it.' },
      order: { type: 'number', description: 'Its position among its siblings; lower comes first.' },
      parentId: { type: 'string', description: 'The new parent folder\'s id (same model), or an empty string to move it to the top level.' }
    }
  },
  {
    name: 'delete_knowledge_node', title: 'Delete a knowledge folder', destructive: true, method: 'DELETE', path: '/v1/admin/knowledge/nodes/{id}',
    description: 'Deletes a folder; nothing beneath it is deleted: its child folders and FAQs move up to its parent (or the top level). Without `confirm` it deletes nothing and returns the impact (`{ deleted: false, impact: { children, faqs } }`). The folder itself cannot be restored. Confirm with the user first.',
    params: { id: id('folder'), confirm: { type: 'boolean', description: 'true really deletes. Left out or false, it only reports the impact.' } }
  },
  // ---- knowledge base: FAQs in bulk, documents and imports --------------------
  {
    name: 'bulk_update_faqs', title: 'Change many FAQs at once', destructive: true, method: 'POST', path: '/v1/admin/knowledge/faqs/bulk',
    description: 'Applies one `action` to up to 500 FAQs of this workspace: `status` (set `status`), `move` (put them in the folder `nodeId`; leave `nodeId` out to move them to the top level of their model), `tag` (ADD `tags` to the ones they have) or `delete` (permanent). An id that does not exist or is not yours is skipped. Returns `{ affected }`, the number changed. `delete` cannot be undone: confirm with the user first.',
    params: {
      ids: { type: 'array', required: true, description: 'FAQ ids, up to 500, from list_faqs.' },
      action: { type: 'string', required: true, enum: ['status', 'move', 'tag', 'delete'], description: 'What to do to all of them.' },
      status: { type: 'string', enum: ['draft', 'active', 'disabled', 'archived', 'outdated'], description: 'The new status, for action `status`. Only active answers are used by the assistants and the help center.' },
      nodeId: { type: 'string', description: 'The destination folder id, for action `move`; it must be in the same model as each FAQ.' },
      tags: { type: 'array', description: 'Tags to add (each up to 120 characters, 40 per FAQ at most), for action `tag`.' }
    }
  },
  {
    name: 'get_knowledge_document', title: 'Get a knowledge document', readOnly: true, method: 'GET', path: '/v1/admin/knowledge/documents/{id}',
    description: 'One uploaded document with its version history: `document` (filename, size, status, version, who uploaded it, import stats, `faqCount` of FAQs made from it) and `versions` (every version, oldest first). The original file can\'t be downloaded through this tool.',
    params: { id: id('document') }
  },
  {
    name: 'delete_knowledge_document', title: 'Delete a knowledge document', destructive: true, method: 'DELETE', path: '/v1/admin/knowledge/documents/{id}',
    description: 'Removes an uploaded document and its stored file. The FAQs made from it are NOT deleted: they keep their content and lose the link to the source. Without `confirm` it deletes nothing and returns how many FAQs it feeds (`{ deleted: false, impact: { faqs } }`). Cannot be undone. Confirm with the user first.',
    params: { id: id('document'), confirm: { type: 'boolean', description: 'true really deletes. Left out or false, it only reports the impact.' } }
  },
  {
    name: 'reprocess_knowledge_document', title: 'Re-run a document\'s import', method: 'POST', path: '/v1/admin/knowledge/documents/{id}/reprocess',
    description: 'Re-reads the stored file and updates the FAQs made from it in place (matched by their import key, so nothing is duplicated). FAQs a person edited are left alone, FAQs no longer in the file become `outdated` (not deleted), and the search index is rebuilt in the background. Returns `{ stats }` (created, updated, skippedDetached, outdated, nodes). Fails with 402 when it would pass the plan\'s FAQ limit; nothing is written then.',
    params: { id: id('document') }
  },
  {
    name: 'get_knowledge_import', title: 'Import status of a document', readOnly: true, method: 'GET', path: '/v1/admin/knowledge/imports/{id}',
    description: 'Where a document is in its import: `status` (uploaded, queued, processing, processed, failed, outdated or archived), `processingError` when it failed, `importStats`, its version and `faqCount`. The id is a document id, from list_knowledge_documents.',
    params: { id: id('document') }
  },
  {
    name: 'commit_knowledge_import', title: 'Commit reviewed import entries', method: 'POST', path: '/v1/admin/knowledge/imports/{id}/commit',
    description: 'Creates or updates FAQs from reviewed entries for an already-uploaded document (uploading a file happens in the panel, not here). An entry that matches an earlier import of the same question and path updates that FAQ, unless a person edited it (then it is skipped); new ones are created active, filed under their `path` (folders are made as needed). IMPORTANT: FAQs imported earlier from the same document that are NOT in `entries` are marked `outdated`, so send every entry you want to keep. The model is re-indexed in the background. Returns `{ stats }` (created, updated, skippedDetached, outdated, nodes). Fails with 402 when it would pass the plan\'s FAQ limit; nothing is written then.',
    params: {
      id: id('document'),
      entries: { type: 'array', items: { type: 'object' }, required: true, description: 'The entries to import, each { path: folder names from the top such as ["Billing","Refunds"], question (required; an entry without one is dropped), answer, aliases: string[], tags: string[] }.' }
    }
  },
  // ---- feedback board ------------------------------------------------------------
  {
    name: 'get_feedback_config', title: 'Feedback board settings', readOnly: true, method: 'GET', path: '/v1/feedback/config',
    description: 'How a project\'s feedback board is set up: its statuses (key, label, category open/planned/active/done/closed, and whether a change notifies followers), post types, platforms, tags and options, plus the project\'s name and look and where the roadmap comes from (`roadmapSource`: `board` or `posts`). Read it before create_feedback_post or update_feedback_post: they only accept the status, type, platform and tag keys listed here.',
    params: { project: projectId }
  },
  {
    name: 'get_roadmap', title: 'The public roadmap', readOnly: true, method: 'GET', path: '/v1/feedback/roadmap',
    description: 'The roadmap as visitors see it: the project board\'s public items in planned, in-progress or done statuses, each with its public description, its linked posts that are not hidden and their summed votes. Fails with 404 when the project offers no public roadmap. To work on the items themselves, use list_board_items.',
    params: { project: projectId }
  },
  {
    name: 'create_feedback_post', title: 'Post to a feedback board', method: 'POST', path: '/v1/feedback',
    description: 'Files a post on the project\'s board as the team, with no votes. `type`, `platform` and `tags` must be keys the board defines (get_feedback_config). The post gets the board\'s next number and shows on the public board unless `hidden` is true. Returns `{ post }` with its id and number.',
    params: {
      project: { ...projectId, in: 'query' },
      title: { type: 'string', required: true, description: 'Up to 200 characters.' },
      body: { type: 'string', description: 'Markdown or HTML, up to 20,000 characters.' },
      type: { type: 'string', description: 'A post type key of the board, e.g. feature or bug.' },
      platform: { type: 'string', description: 'A platform key of the board, if it uses platforms.' },
      tags: { type: 'array', description: 'Tag keys the board defines, at most 4.' },
      attachments: { type: 'array', items: { type: 'object' }, description: 'Attachment objects returned by upload_board_comment_attachment, up to 10.' },
      status: { type: 'string', description: 'A status key of the board. Default: its default status.' },
      hidden: { type: 'boolean', description: 'Keep it off the public board.' },
      featured: { type: 'boolean', description: 'Feature it.' },
      locked: { type: 'boolean', description: 'Stop new comments from customers.' },
      showOnChangelog: { type: 'boolean', description: 'Offer it to the changelog when it is done.' },
      changelogTitle: { type: 'string', description: 'The title to use for it on the changelog.' },
      changelogBody: { type: 'string', description: 'The text to use for it on the changelog.' },
      icon: { type: 'string', description: 'An icon name or emoji, up to 60 characters.' },
      completedAt: { type: 'string', description: 'ISO date-time it was completed; empty clears it.' },
      adminNote: { type: 'string', description: 'A note only the team sees.' },
      externalId: { type: 'string', description: 'Your own id for the post, so it can be found by it later.' },
      metadata: { type: 'object', description: 'Free-form data kept with the post.' }
    }
  },
  {
    name: 'delete_feedback_post', title: 'Delete a feedback post', destructive: true, method: 'DELETE', path: '/v1/feedback/{id}',
    description: 'Permanently deletes a post with its votes, comments and followers. To keep it but take it off the public board, use update_feedback_post with hidden. Returns `{ deleted: true }`. Confirm with the user first.',
    params: { id: id('post'), project: projectId }
  },
  {
    name: 'merge_feedback_post', title: 'Merge a duplicate feedback post', destructive: true, method: 'POST', path: '/v1/feedback/{id}/merge',
    description: 'Merges a duplicate post (`id`) into another (`into`): its votes move onto `into` (each voter counts once), its followers follow `into` too, it is linked as a duplicate, LOCKED, and moved to `status` (default: the board\'s first closed status), which emails its followers when that status notifies. Moved votes cannot be moved back. Returns `{ post, into }`. Confirm with the user first.',
    params: {
      id: id('duplicate post'), project: { ...projectId, in: 'query' },
      into: { type: 'string', required: true, description: 'The post to keep: its id or number (`12`). It cannot be the same post or itself a duplicate.' },
      status: { type: 'string', description: 'A status key to move the duplicate to. Default: the board\'s first closed status.' }
    }
  },
  {
    name: 'list_feedback_comments', title: 'A post\'s comments', readOnly: true, method: 'GET', path: '/v1/feedback/{id}/comments',
    description: 'A post\'s comments, oldest first, including the team\'s internal notes and moderated (hidden) ones, each marked by its `visibility` (public, internal or hidden). Returns `{ comments }`; each has the id that update_feedback_comment and delete_feedback_comment take, and `parentId` / `replyToId` for replies.',
    params: { id: id('post'), project: projectId }
  },
  {
    name: 'update_feedback_comment', title: 'Moderate or edit a feedback comment', method: 'PATCH', path: '/v1/feedback/{id}/comments/{commentId}',
    description: 'Changes who sees a comment with `visibility`: public, internal (a team-only note) or hidden (moderated away). Only public comments count or notify. `body` rewrites the words under the author\'s name and marks the comment edited: use it only when the user asked for that. Returns `{ comment, post }`.',
    params: {
      id: id('post'), commentId: { type: 'string', required: true, description: 'The comment\'s id, from list_feedback_comments.' },
      project: { ...projectId, in: 'query' },
      visibility: { type: 'string', enum: ['public', 'internal', 'hidden'], description: 'Who sees it.' },
      body: { type: 'string', description: 'The new text, Markdown or HTML, up to 8,000 characters.' }
    }
  },
  {
    name: 'delete_feedback_comment', title: 'Delete a feedback comment', destructive: true, method: 'DELETE', path: '/v1/feedback/{id}/comments/{commentId}',
    description: 'Permanently removes a comment (its replies stay and read as top-level). To only take it off the public board, use update_feedback_comment with visibility hidden. Returns `{ deleted: true, post }` with the new comment count. Confirm with the user first.',
    params: { id: id('post'), commentId: { type: 'string', required: true, description: 'The comment\'s id, from list_feedback_comments.' }, project: projectId }
  },
  {
    name: 'list_feedback_participants', title: 'Who can be @mentioned in a post', readOnly: true, method: 'GET', path: '/v1/feedback/{id}/participants',
    description: 'The people a comment on this post can @mention: its author, public commenters and followers that have a username, the team first, at most 8. Returns `participants` with handle, name, avatarUrl and isTeam (never ids or emails). Write a mention as @handle in the comment text.',
    params: { id: id('post'), project: projectId, q: { type: 'string', description: 'Narrow the list to handles or names matching this text.' } }
  },
  // ---- changelog: entries --------------------------------------------------------
  {
    name: 'create_changelog_entries', title: 'Write several changelog entries', method: 'POST', path: '/v1/admin/changelog/entries/batch',
    description: 'Creates up to 50 entries in one call, drafts by default. An entry is SKIPPED, not created, when a commit it cites in `commitShas` is already cited by an entry of the project (archived ones too), so sending a batch again never writes a commit up twice. Not transactional: one bad entry does not stop the rest. Returns `created` (the entries), `skipped` ([{ index, commitSha, entryId }]) and `failed` ([{ index, message }]). An entry with status `published` goes public and can email followers and subscribers: prefer drafts unless the user said to publish.',
    params: {
      project: { ...projectId, in: 'query' },
      entries: { type: 'array', items: { type: 'object' }, required: true, description: '1 to 50 entries, each { title (required, up to 200 characters), body (Markdown for the public), bodyFormat (markdown or html), summary (up to 300 characters), slug, tag (new, improved, fix, removed or breaking; default improved), area (a lowercase key; one the project lists, if it lists any), status (draft default, or published), publishedAt (ISO date-time), releaseId (from list_changelog_releases) or releaseVersion (uses the release with that version, or CREATES one already published), pinned, iconGlyph, accentColor (#rrggbb), links (up to 6 of { label, url }), images (attachment objects from upload_board_comment_attachment), commitShas (full 40-character git SHAs, up to 50), feedbackPostIds, boardItemIds, conversationIds (ids or #N, up to 50 each to link) }.' }
    }
  },
  {
    name: 'merge_changelog_entries', title: 'Merge changelog entries', method: 'POST', path: '/v1/admin/changelog/entries/merge',
    description: 'Folds 2 to 10 entries into one: creates the merged entry from `entry` and ARCHIVES the entries in `refs` (an archived entry is never public but keeps its slug and commits; update_changelog_entry with another status brings it back). The merged entry also cites every commit the sources did and links what they linked. Writing the merged text is your job, so read the sources first. Not transactional: the merged entry exists before the first source is archived. Returns `{ entry, archived }` (the archived ids). Archiving published entries takes them off the public changelog, and a merged `entry` with status published goes public: confirm with the user first.',
    params: {
      project: { ...projectId, in: 'query' },
      refs: { type: 'array', required: true, description: '2 to 10 entries to fold together: slugs, #N numbers or ids. None may already be archived.' },
      entry: { type: 'object', required: true, description: 'The merged entry, with the same fields as one item of create_changelog_entries (title is required; status defaults to draft).' }
    }
  },
  {
    name: 'delete_changelog_entry', title: 'Delete a changelog entry', destructive: true, method: 'DELETE', path: '/v1/admin/changelog/entries/{id}',
    description: 'Permanently removes the entry and its links; the posts, board items and conversations it linked stay. To only take it off the public changelog, use update_changelog_entry with status archived. Returns `{ deleted: true }`. Confirm with the user first.',
    params: { id: id('changelog entry'), project: { type: 'string', description: 'Project id, needed when `id` is a slug or entry number rather than the entry\'s id.' } }
  },
  {
    name: 'link_changelog_entry', title: 'Link or unlink a source on a changelog entry', method: 'POST', path: '/v1/admin/changelog/entries/{id}/links',
    description: 'Links (or, with `linked` false, unlinks) one feedback post, board item or conversation of the same project to an entry, up to 50 of each kind. The people following a linked post or conversation hear about the entry when it ships; linking a conversation adds a note to its timeline. Returns `{ entry }` with its sources.',
    params: {
      id: id('changelog entry'),
      project: { type: 'string', in: 'query', description: 'Project id, needed when `id` is a slug or entry number rather than the entry\'s id.' },
      kind: { type: 'string', required: true, enum: ['feedback', 'board', 'conversation'], description: 'What is being linked: a feedback post, a board item, or a conversation (a ticket or an error issue).' },
      linkedId: { type: 'string', required: true, as: 'id', description: 'The post, board item or conversation to link: its id, or `#12` for a post or board item.' },
      linked: { type: 'boolean', description: 'false unlinks. Default true.' }
    }
  },
  {
    name: 'review_changelog_entry', title: 'Approve or reject a draft entry', destructive: true, method: 'POST', path: '/v1/admin/changelog/entries/{id}/review',
    description: 'Reviews a DRAFT entry (anything else is a 400). `approve` publishes it now (keeping a publishedAt it already has) and marks it approved: it goes public and can email the followers of what it ships and the subscribers. `reject` leaves it a draft marked rejected, with your `notes`, for its author to revise. An entry whose release is still a draft stays hidden until the release is published. Returns `{ entry }`. Confirm with the user before approving.',
    params: {
      id: id('changelog entry'),
      project: { type: 'string', in: 'query', description: 'Project id, needed when `id` is a slug or entry number rather than the entry\'s id.' },
      action: { type: 'string', required: true, enum: ['approve', 'reject'], description: 'approve publishes the draft; reject sends it back.' },
      notes: { type: 'string', description: 'Why, up to 2,000 characters; shown to its author.' }
    }
  },
  // ---- changelog: AI drafting and email ------------------------------------------
  {
    name: 'generate_changelog_from_commits', title: 'Draft changelog entries from GitHub commits', method: 'POST', path: '/v1/admin/changelog/generate',
    description: 'Starts the AI writing entries from the commit messages of the project\'s connected GitHub repos (default branch, newest 300 at most). It runs in the background: poll get_changelog_generate_run. Entries are always created as DRAFTS waiting for review, never published, and a commit an entry already cites is not written up again. Fails when GitHub or an AI provider is not set up (501), the project has no repos (400), a run is already going (409) or too many runs were started this hour (429). Counts toward the workspace\'s AI use. Returns `{ queued: true }`.',
    params: {
      project: { ...projectId, in: 'query' },
      days: { type: 'integer', maximum: 3650, description: 'Only commits from the last this many days (1 to 3650). Left out, all the cap allows.' }
    }
  },
  {
    name: 'get_changelog_generate_run', title: 'Last AI changelog run', readOnly: true, method: 'GET', path: '/v1/admin/changelog/generate',
    description: 'The most recent run of the AI changelog from commits (started by hand or by a GitHub push): `run` has `state` (running, done or failed), startedAt, finishedAt, how many entries it `created` and how many commits it `skipped` (already written up), and `error` when it failed. `run` is null before the first run.',
    params: { project: projectId }
  },
  {
    name: 'run_changelog_notify', title: 'Run a changelog email job now', destructive: true, method: 'POST', path: '/v1/admin/changelog/notify/run',
    description: 'Runs one beat of the changelog email scheduler for the project right now: `instant` (entries published and gone quiet) or `weekly` (the digest, only when it is due and not already sent). This sends REAL email to subscribers. Use `dryRun` true first: it reports what would go out and sends or marks nothing. Fails with 404 when the changelog has no notifications. Returns instant `{ flushed, entries, recipients }` or weekly `{ due, sent, entries, recipients }`. Confirm with the user first.',
    params: {
      project: { ...projectId, in: 'query' },
      job: { type: 'string', required: true, enum: ['instant', 'weekly'], description: 'Which job to run.' },
      dryRun: { type: 'boolean', description: 'true only reports; nothing is sent or marked.' }
    }
  },
  {
    name: 'get_changelog_subscriber_counts', title: 'Changelog subscriber counts', readOnly: true, method: 'GET', path: '/v1/admin/changelog/subscriptions/summary',
    description: 'How many people the changelog emails: `instant` and `weekly` (active subscribers by how often), `pending` (not yet confirmed) and `unsubscribed`. Counts only, never addresses.',
    params: { project: projectId }
  },
  // ---- changelog: releases --------------------------------------------------------
  {
    name: 'list_changelog_releases', title: 'List changelog releases', readOnly: true, method: 'GET', path: '/v1/admin/changelog/releases',
    description: 'A project\'s releases, newest first, drafts included. A release is a version that groups entries (`releaseId` on an entry). Returns `{ releases }` with id, version, title, summary, status (draft or published) and publishedAt.',
    params: { project: projectId }
  },
  {
    name: 'create_changelog_release', title: 'Create a changelog release', method: 'POST', path: '/v1/admin/changelog/releases',
    description: 'Creates a release, a version that groups entries. It starts as a draft: nothing in it is public until the release is published, so prefer a draft unless the user said to publish. Returns `{ release }` with the id to use as `releaseId` on an entry.',
    params: {
      project: { ...projectId, in: 'query' },
      version: { type: 'string', required: true, description: 'Free text such as 2.4, up to 60 characters.' },
      title: { type: 'string', description: 'A headline, up to 200 characters.' },
      summary: { type: 'string', description: 'An intro, up to 2,000 characters.' },
      status: { type: 'string', enum: ['draft', 'published'], description: 'Default draft.' },
      publishedAt: { type: 'string', description: 'ISO date-time to show as its date. Default: now when published.' }
    }
  },
  {
    name: 'update_changelog_release', title: 'Edit a changelog release', method: 'PATCH', path: '/v1/admin/changelog/releases/{id}',
    description: 'Changes a release; only the fields you send change. Setting `status` to `published` makes the release and its already-published entries public (publish_changelog_release also publishes its draft entries); setting it back to `draft` hides the whole release again. Confirm with the user before publishing. Returns `{ release }`.',
    params: {
      id: id('release'),
      version: { type: 'string', description: 'New version, up to 60 characters.' },
      title: { type: 'string', description: 'A headline, up to 200 characters; empty clears it.' },
      summary: { type: 'string', description: 'An intro, up to 2,000 characters; empty clears it.' },
      status: { type: 'string', enum: ['draft', 'published'], description: 'Its state.' },
      publishedAt: { type: 'string', description: 'ISO date-time shown as its date; empty clears it (a published release then gets now).' }
    }
  },
  {
    name: 'delete_changelog_release', title: 'Delete a changelog release', destructive: true, method: 'DELETE', path: '/v1/admin/changelog/releases/{id}',
    description: 'Permanently removes a release. Its entries stay, as entries of no release (a published one is then public on its own). Returns `{ deleted: true }`. Confirm with the user first.',
    params: { id: id('release') }
  },
  {
    name: 'publish_changelog_release', title: 'Publish a changelog release', destructive: true, method: 'POST', path: '/v1/admin/changelog/releases/{id}/publish',
    description: 'Publishes the release (dated now unless it already has a date) and every entry still a draft in it, dated with the release. Idempotent. The release and its entries become public on the changelog and its feed, and subscribers and the followers of the posts it ships can be emailed. Returns `{ release }`. Confirm with the user first.',
    params: { id: id('release') }
  },
  {
    name: 'suggest_changelog_release_copy', title: 'Write a release\'s title and summary with AI', method: 'POST', path: '/v1/admin/changelog/releases/{id}/suggest',
    description: 'Has the AI propose a headline and a short Markdown intro from the entries inside a release (drafts and published, not archived; the newest 150). Saves nothing: show it to the user, then keep it with update_changelog_release. Fails with 400 when the release has no entries, 501 without an AI provider and 429 past 20 a minute per project. Counts toward the workspace\'s AI use. Returns `{ title, summary }` (either can be empty).',
    params: { id: id('release') }
  },
  // ---- changelog: reader comments (moderation) ------------------------------------
  {
    name: 'list_changelog_comments', title: 'Comments on a changelog entry', readOnly: true, method: 'GET', path: '/v1/changelog/{ref}/comments',
    description: 'What readers wrote under an entry, oldest first, including comments hidden by moderation (marked by `status`: visible or hidden; deleted ones are never returned). Returns `comments` (with the ids moderate_changelog_comment and delete_changelog_comment take), `total` and `hasMore`; page with `skip`.',
    params: {
      ref: { type: 'string', required: true, description: 'The entry\'s slug, number (`12`) or id, from list_changelog_entries.' },
      project: projectId,
      limit: limit(100),
      skip: { type: 'integer', description: 'Comments to skip.' }
    }
  },
  {
    name: 'moderate_changelog_comment', title: 'Hide or show a changelog comment', method: 'PATCH', path: '/v1/changelog/comments/{id}',
    description: 'Hides a reader\'s comment from the public changelog, or shows it again. This is moderation only: the words are never changed (a moderator cannot edit what someone said). Returns `{ comment, commentCount }` with the entry\'s new visible comment count.',
    params: {
      id: id('comment'), project: { ...projectId, in: 'query' },
      status: { type: 'string', required: true, enum: ['visible', 'hidden'], description: 'hidden takes it off the public changelog; visible brings it back.' }
    }
  },
  {
    name: 'delete_changelog_comment', title: 'Delete a changelog comment', destructive: true, method: 'DELETE', path: '/v1/changelog/comments/{id}',
    description: 'Takes a reader\'s comment down for good: its words are erased and it is no longer returned (the row stays for the audit trail). To only hide it, use moderate_changelog_comment. Returns `{ deleted: true, commentCount }`. Confirm with the user first.',
    params: { id: id('comment'), project: projectId }
  },

  // ======== contacts, segments, sequences, forms, onboarding, email and campaigns ========
  // ---- contacts ------------------------------------------------------------------------
  {
    name: 'upsert_contacts', title: 'Create or update contacts', method: 'POST', path: '/v1/contacts',
    description: 'Create a person, or update the one who matches: found by `externalId` (their user id in the app), then by `email`; anyone not found is created. Attributes merge (a null value removes one) and tags are added to the ones they already have. Send one person\'s fields, or up to 1000 people as `contacts` (not both). Answers `{ contact, status }` for one person, or `{ results, created, updated, unchanged, failed }` for a batch. This cannot subscribe anyone to marketing mail, which needs the person\'s own consent: never put `subscription` or `resubscribe` in a `contacts` item either.',
    params: {
      project: { ...projectId, in: 'query' },
      externalId: { type: 'string', description: 'Their user id in the app, up to 200 characters. Send this, `email` or both.' },
      email: { type: 'string', description: 'Their email address.' },
      name: { type: 'string', description: 'Their name, up to 120 characters.' },
      language: { type: 'string', description: 'The language to write to them in, a tag such as es or pt-BR; an empty string clears it.' },
      attributes: { type: 'object', description: 'Up to 50 keys (letters, digits and _, starting with a letter) with string, number or boolean values; they merge into the existing ones and a null value removes a key.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add (they keep the ones they have); up to 50 of up to 40 characters.' },
      subscription: { type: 'string', enum: ['unsubscribed'], description: 'Only `unsubscribed` is accepted here: it stops all marketing mail to them. Subscribing someone needs their own consent and is not done through this tool.' },
      contacts: { type: 'array', items: { type: 'object' }, description: 'A batch of up to 1000 people instead of the single-person fields: each item takes externalId, email, name, language, attributes and tags as above.' },
      fillOnly: { type: 'boolean', description: 'Batch only: fill blank fields and never overwrite what is there, for importing older data.' }
    }
  },
  {
    name: 'erase_contact', title: 'Erase a contact', destructive: true, method: 'DELETE', path: '/v1/contacts/{id}',
    description: 'Permanently removes the person and everything they left in the project: feedback, conversations and messages, files they sent through lead forms, the email log for their address and their sequence enrollments. Someone who had unsubscribed stays on the suppression list so no import can mail them again. Answers `{ erased: { …counts } }`. Confirm with the user first.',
    params: { id: id('contact'), project: projectId }
  },
  // ---- segments -----------------------------------------------------------------------
  {
    name: 'create_segment', title: 'Create a segment', method: 'POST', path: '/v1/segments',
    description: 'Save a filter over a project\'s contacts as a segment, to aim campaigns and sequences at. A segment with no rules is everyone. Try a filter first with preview_segment. Answers `{ segment }`.',
    params: {
      project: { ...projectId, in: 'query' },
      name: { type: 'string', required: true, description: 'The segment\'s name, up to 80 characters.' },
      filter: { type: 'object', description: 'The rules: `{ match: "all" | "any", rules: [{ field, op, value }] }`, up to 20 rules. Fields: email, name, externalId, language, subscription (none, pending, subscribed, unsubscribed), tags, unsubscribedTopics, sources, origin (app, lead_form, signup, import, sync, stripe, api, panel, feedback), leadForms (a lead form id), stripePlan, createdAt, lastSeenAt, updatedAt, `attributes.<key>`, and the yes/no questions hasOpenConversation, votedOnPost, hasErrors, finishedOnboarding. Ops: is, is_not, contains, starts_with, exists, not_exists (these two take no value), gt, lt, before, after, within_days, not_within_days, includes, excludes. Which ops fit which field is checked by the server and its error says.' }
    }
  },
  {
    name: 'preview_segment', title: 'Count who a filter matches', method: 'POST', path: '/v1/segments/preview',
    description: 'How many contacts a filter (or an existing segment) matches, with up to 10 of them as a sample (most recently updated). Saves nothing. Answers `{ count, sample }`.',
    params: {
      project: { ...projectId, in: 'query' },
      filter: { type: 'object', description: 'A filter to try, `{ match: "all" | "any", rules: [{ field, op, value }] }` as in create_segment. Use this or `segment`; with neither, everyone matches.' },
      segment: { type: 'string', description: 'A saved segment\'s id, from list_segments, to count instead of a filter.' }
    }
  },
  {
    name: 'update_segment', title: 'Rename a segment or change its filter', method: 'PATCH', path: '/v1/segments/{id}',
    description: 'Rename a segment or give it a new filter; only what you send changes. A new `filter` REPLACES all its rules, so read the segment with list_segments and send the whole filter back with your change. Campaigns and sequences aimed at it use the new filter from then on. Answers `{ segment }`.',
    params: {
      id: id('segment'),
      project: { ...projectId, in: 'query' },
      name: { type: 'string', description: 'The new name, up to 80 characters.' },
      filter: { type: 'object', description: 'The whole new filter, `{ match: "all" | "any", rules: [{ field, op, value }] }` as in create_segment.' }
    }
  },
  {
    name: 'delete_segment', title: 'Delete a segment', destructive: true, method: 'DELETE', path: '/v1/segments/{id}',
    description: 'Deletes the saved filter; the contacts stay. Campaigns already sent keep their numbers and a scheduled campaign aimed at it is refused when it starts. Confirm with the user first.',
    params: { id: id('segment'), project: projectId }
  },
  // ---- sequences ----------------------------------------------------------------------
  {
    name: 'get_sequence', title: 'Get a sequence', readOnly: true, method: 'GET', path: '/v1/sequences/{id}',
    description: 'One sequence with its status, trigger, steps and counts (enrolled, completed, exited, active). See who is on it with list_sequence_enrollments.',
    params: { id: id('sequence'), project: projectId }
  },
  {
    name: 'create_sequence', title: 'Create a sequence', method: 'POST', path: '/v1/sequences',
    description: 'A draft series of emails: nothing is sent until the sequence is activated with update_sequence. Answers `{ sequence }`. Needs a plan that includes sequences.',
    params: {
      project: { ...projectId, in: 'query' },
      name: { type: 'string', description: 'The sequence\'s name, up to 120 characters. Default Untitled sequence.' },
      trigger: { type: 'object', description: 'What starts it: `{ type: "subscribed", topic? }` (when someone subscribes), `{ type: "event", event }` (when the app tracks that event, a name such as trial_started) or `{ type: "manual" }` (people are added by hand). Default manual.' },
      steps: { type: 'array', items: { type: 'object' }, description: 'Up to 20 steps, each `{ delayMinutes, template, subject? }`: the delay (0 to 525600) is counted from the step before, the first from enrollment; `template` is a send key or id from list_email_templates. Every template must exist in the project.' }
    }
  },
  {
    name: 'update_sequence', title: 'Edit, activate or pause a sequence', destructive: true, method: 'PATCH', path: '/v1/sequences/{id}',
    description: 'Edit a sequence or move it with `status`: active (STARTS EMAILING the people on it and anyone its trigger enrolls; every step must have an unsubscribe link and the postal address), paused (people stay where they are) or draft. New `steps` REPLACE the whole list and, on an active sequence, apply to each person from their next step. Activating reaches real people: confirm with the user first. Answers `{ sequence }`.',
    params: {
      id: id('sequence'),
      project: { ...projectId, in: 'query' },
      name: { type: 'string', description: 'The new name, up to 120 characters.' },
      trigger: { type: 'object', description: 'The new trigger: `{ type: "subscribed", topic? }`, `{ type: "event", event }` or `{ type: "manual" }`.' },
      steps: { type: 'array', items: { type: 'object' }, description: 'The whole new list of up to 20 steps, each `{ id?, delayMinutes, template, subject? }`; keep a step\'s `id` to keep it the same step. Read the current ones with get_sequence first.' },
      status: { type: 'string', enum: ['draft', 'active', 'paused'], description: 'Move the sequence. Activating needs a plan that includes sequences and email sending set up.' }
    }
  },
  {
    name: 'delete_sequence', title: 'Delete a sequence', destructive: true, method: 'DELETE', path: '/v1/sequences/{id}',
    description: 'Deletes the sequence and every enrollment on it: everyone stops getting its emails. The email log keeps what was already sent. Confirm with the user first.',
    params: { id: id('sequence'), project: projectId }
  },
  {
    name: 'list_sequence_enrollments', title: 'Who is on a sequence', readOnly: true, method: 'GET', path: '/v1/sequences/{id}/enrollments',
    description: 'The 200 most recent people on a sequence, newest first, each with the contact, the step they are at, their status, when the next email is due, when one was last sent and the last error.',
    params: {
      id: id('sequence'),
      project: projectId,
      status: { type: 'string', enum: ['active', 'completed', 'exited'], description: 'Only enrollments in this state.' }
    }
  },
  // ---- campaigns ----------------------------------------------------------------------
  {
    name: 'delete_campaign', title: 'Delete a campaign', destructive: true, method: 'DELETE', path: '/v1/campaigns/{id}',
    description: 'Deletes a campaign. Refused while it is sending: pause or cancel it with update_campaign first. The email log keeps what was sent. Confirm with the user first.',
    params: { id: id('campaign'), project: projectId }
  },
  {
    name: 'send_campaign_test', title: 'Send a test of a campaign', destructive: true, method: 'POST', path: '/v1/campaigns/{id}/test',
    description: 'Sends the campaign, with "[Test]" in the subject, to up to five addresses. An address that is a contact gets their own values filled in and its unsubscribe link works for real; the suppression list does not apply. Real mail leaves the server: confirm the addresses with the user first. Answers `{ id, sent, failed, suppressed, results }`. Needs a plan that includes campaigns.',
    params: {
      id: id('campaign'),
      project: { ...projectId, in: 'query' },
      to: { type: 'array', required: true, description: 'Up to five addresses, plain (`ada@example.com`) or with a name (`Ada Lovelace <ada@example.com>`).' }
    }
  },
  // ---- lead forms and the files sent through them -------------------------------------------
  {
    name: 'list_lead_forms', title: 'List lead forms', readOnly: true, method: 'GET', path: '/v1/admin/lead-forms',
    description: 'Every lead form (waitlist or interest form) of a project with its fields, words, look, settings and stats: `leads` (people who came through it) and `confirmed` (those on the list). `path` is the public URL sites read and post to, `pagePath` the hosted page. The leads themselves are contacts: list_contacts with the form\'s segment.',
    params: { project: projectId }
  },
  {
    name: 'get_lead_form', title: 'Get a lead form', readOnly: true, method: 'GET', path: '/v1/admin/lead-forms/{id}',
    description: 'One lead form with its fields, words, look, settings, translations and live stats.',
    params: { id: id('lead form') }
  },
  {
    name: 'create_lead_form', title: 'Create a lead form', method: 'POST', path: '/v1/admin/lead-forms',
    description: 'A waitlist or interest form, live at once at its public URL. `preset` starts it from an email box and a button (email), email and name (waitlist) or email, name, company, role and a question (detailed); anything else you send replaces the preset\'s. A segment of the form\'s leads is made with it. A project has at most 50 forms. Answers `{ form }`.',
    params: {
      project: { ...projectId, in: 'query' },
      name: { type: 'string', description: 'The form\'s name, up to 80 characters. Default Waitlist.' },
      preset: { type: 'string', enum: ['email', 'waitlist', 'detailed'], description: 'The starting point. Default email.' },
      key: { type: 'string', description: 'The name sites ask for it by: 1 to 40 lowercase letters, digits and dashes. Default: made from the name.' },
      active: { type: 'boolean', description: 'false creates it closed (its public URL answers 404). Default true.' },
      locale: { type: 'string', description: 'The language the form is written in, a tag such as en or pt-BR. Default en.' },
      fields: { type: 'array', items: { type: 'object' }, description: 'Up to 12 fields in order, each `{ id?, type, key?, label?, placeholder?, required?, options?, accept?, maxMB? }`. `type` is email, name, text, textarea, number, url, phone, select, checkbox or file; there is always one email field (added first when missing) and at most one name. `key` is the contact attribute the answer is saved in (letters, digits and _; not email, name, website, pk, form, project, externalId, tags or subscription). A select needs `options` (up to 20). A file field takes `accept` (images, documents or any) and `maxMB` (1 to 20), at most three, and needs file storage on the server.' },
      content: { type: 'object', description: 'The form\'s words: `{ title, description, buttonLabel, successTitle, successMessage, confirmMessage, footnote }`; keys you leave out keep the preset\'s.' },
      style: { type: 'object', description: 'The look: `{ accent, background, text }` as #rrggbb or empty for the project\'s, `radius` (0 to 32), `font` (system, rounded, serif or mono), `layout` (stacked or inline).' },
      settings: { type: 'object', description: 'What happens after sign-up: `{ doubleOptIn, confirmTemplate, welcomeTemplate, sequence, tags, redirectUrl }`. doubleOptIn (default true) makes people confirm their address by email first: leave it on unless the user says otherwise. confirmTemplate (a send key or id; must use {{confirmUrl}}) and welcomeTemplate (sent once they are on the list) are email templates of the project, `sequence` is a sequence id they start, `tags` (up to 10) are added to the contact and `redirectUrl` is an http(s) address people are sent to afterwards.' },
      translations: { type: 'object', description: 'Other languages, by tag: `{ es: { content: { title, … }, fields: { "<fieldId>": { label, placeholder, options } } } }`. Words left out show in the form\'s own language. translate_lead_form fills this with AI.' }
    }
  },
  {
    name: 'update_lead_form', title: 'Edit a lead form', method: 'PATCH', path: '/v1/admin/lead-forms/{id}',
    description: 'Change a form; only the keys you send change and they are live at once. `fields` is the WHOLE list, in order (it REPLACES the old one, so read the form first and keep each field\'s `id` to keep its answers and translations). `content`, `style` and `settings` merge key by key. `active: false` closes the form (its public URL answers 404). Changing `key` moves the public URL. Answers `{ form }`.',
    params: {
      id: id('lead form'),
      name: { type: 'string', description: 'The form\'s name, up to 80 characters.' },
      key: { type: 'string', description: 'The name sites ask for it by: 1 to 40 lowercase letters, digits and dashes. Sites using the old one get a 404.' },
      active: { type: 'boolean', description: 'false closes the form, true opens it again.' },
      locale: { type: 'string', description: 'The language the form is written in, a tag such as en or pt-BR.' },
      fields: { type: 'array', items: { type: 'object' }, description: 'The whole list of up to 12 fields, each `{ id?, type, key?, label?, placeholder?, required?, options?, accept?, maxMB? }`. `type` is email, name, text, textarea, number, url, phone, select, checkbox or file; one email field is always kept and there is at most one name. `key` is the contact attribute the answer is saved in. A select needs `options` (up to 20). A file field takes `accept` (images, documents or any) and `maxMB` (1 to 20), at most three, and needs file storage on the server.' },
      content: { type: 'object', description: 'The form\'s words, merged key by key: `{ title, description, buttonLabel, successTitle, successMessage, confirmMessage, footnote }`.' },
      style: { type: 'object', description: 'The look, merged key by key: `{ accent, background, text }` as #rrggbb or empty, `radius` (0 to 32), `font` (system, rounded, serif or mono), `layout` (stacked or inline).' },
      settings: { type: 'object', description: 'Merged key by key: `{ doubleOptIn, confirmTemplate, welcomeTemplate, sequence, tags, redirectUrl }`. An empty string clears a template, the sequence or the redirect; `tags` REPLACES the list. The templates and the sequence must exist in the project; the confirmation template must use {{confirmUrl}}. Keep doubleOptIn on unless the user says otherwise.' },
      translations: { type: 'object', description: 'Languages by tag, each `{ content, fields: { "<fieldId>": { label, placeholder, options } } }`: a language you send REPLACES that language and a null value removes it.' }
    }
  },
  {
    name: 'delete_lead_form', title: 'Delete a lead form', destructive: true, method: 'DELETE', path: '/v1/admin/lead-forms/{id}',
    description: 'Sites that ask for the form get a 404 from then on. Its leads stay contacts and its segment stays, so campaigns aimed at it keep working. Confirm with the user first.',
    params: { id: id('lead form') }
  },
  {
    name: 'translate_lead_form', title: 'Translate a lead form with AI', method: 'POST', path: '/v1/admin/lead-forms/{id}/translate',
    description: 'Translates the form\'s words (title, description, button, thank-you messages, footnote, and each field\'s label, placeholder and options) from its own language into each language in `locales` and saves them in `translations`; visitors see them at once. Words that already have a translation are kept unless `overwrite` is true. Uses the workspace\'s AI provider or the server\'s gateway (metered in AI credits). Answers `{ form }`.',
    params: {
      id: id('lead form'),
      locales: { type: 'array', required: true, description: 'Up to 8 language tags such as es, fr or pt-BR, other than the form\'s own language.' },
      overwrite: { type: 'boolean', description: 'true replaces translations that already exist (including ones a person edited). Default false.' }
    }
  },
  {
    name: 'list_lead_files', title: 'List files sent through lead forms', readOnly: true, method: 'GET', path: '/v1/admin/lead-files',
    description: 'The files people attached through a form\'s file fields, newest first: one person\'s (`contact`) or one form\'s (`form`), one of the two is required. Each says which form and field it came through, its name, type and size. The files themselves are not downloadable here. Page with `before` set to the last row\'s createdAt.',
    params: {
      project: projectId,
      contact: { type: 'string', description: 'A contact\'s id, from list_contacts.' },
      form: { type: 'string', description: 'A lead form\'s id, from list_lead_forms.' },
      before: { type: 'string', description: 'ISO createdAt of the last row of the previous page.' },
      limit: { ...limit(200), default: 100 }
    }
  },
  {
    name: 'delete_lead_file', title: 'Delete a file sent through a lead form', destructive: true, method: 'DELETE', path: '/v1/admin/lead-files/{id}',
    description: 'Removes the file for good and gives its space back to the workspace\'s storage. The contact stays. Confirm with the user first.',
    params: { id: id('file') }
  },
  // ---- onboarding flows ---------------------------------------------------------------
  {
    name: 'list_onboarding_flows', title: 'List onboarding flows', readOnly: true, method: 'GET', path: '/v1/admin/onboarding/flows',
    description: 'Every onboarding flow of a project, drafts included, each with its working steps, style, options and translations, `status`, `version` and `published` (what apps get now, null while it is a draft). `changed` is true when the working copy differs from the published one.',
    params: { project: projectId }
  },
  {
    name: 'get_onboarding_flow', title: 'Get an onboarding flow', readOnly: true, method: 'GET', path: '/v1/admin/onboarding/flows/{id}',
    description: 'One onboarding flow: its working steps, style, options and translations, and what is published.',
    params: { id: id('onboarding flow') }
  },
  {
    name: 'create_onboarding_flow', title: 'Create an onboarding flow', method: 'POST', path: '/v1/admin/onboarding/flows',
    description: 'Creates a DRAFT flow with three starter steps unless you send `steps`. Apps see nothing until it is published. A project has at most 50 flows and a flow at most 12 steps. Answers `{ flow }` with its id.',
    params: {
      project: { ...projectId, in: 'query' },
      name: { type: 'string', description: 'The flow\'s name, up to 80 characters. Default Welcome.' },
      key: { type: 'string', description: 'The name apps ask for it by: 1 to 40 lowercase letters, digits and dashes. Default: made from the name.' },
      steps: { type: 'array', items: { type: 'object' }, description: 'The steps, up to 12, each `{ title (up to 120 characters), body (up to 600), imageUrl (an http(s) URL or empty), imageAlt, buttonLabel (up to 40), pricingTable (the key of one of the project\'s pricing tables, or empty) }`.' },
      style: { type: 'object', description: 'The look: `{ accent, background, text }` as #rrggbb or empty for the project\'s, `radius` (0 to 32), `font` (system, rounded, serif or mono).' },
      options: { type: 'object', description: '`{ skippable: true or false, progress: bar, dots or none }`.' },
      locale: { type: 'string', description: 'The language the flow is written in, a tag such as en or pt-BR. Default en.' },
      translations: { type: 'object', description: 'Other languages, by tag: `{ es: { name, steps: { "<stepId>": { title, body, imageAlt, buttonLabel } } } }`.' }
    }
  },
  {
    name: 'update_onboarding_flow', title: 'Edit an onboarding flow', method: 'PATCH', path: '/v1/admin/onboarding/flows/{id}',
    description: 'Change the working copy; only the keys you send change. `steps` is the WHOLE list, in order (it REPLACES the old one, so read the flow first and keep each step\'s `id`; a step without an id is new). `style` and `options` merge key by key. Apps keep the published version until publish_onboarding_flow. Changing `key` of a published flow moves its public URL, so apps asking for the old key get a 404. Answers `{ flow }`.',
    params: {
      id: id('onboarding flow'),
      name: { type: 'string', description: 'The flow\'s name, up to 80 characters.' },
      key: { type: 'string', description: 'The name apps ask for it by: 1 to 40 lowercase letters, digits and dashes.' },
      steps: { type: 'array', items: { type: 'object' }, description: 'The whole list of up to 12 steps, each `{ id?, title (up to 120 characters), body (up to 600), imageUrl (an http(s) URL or empty), imageAlt, buttonLabel (up to 40), pricingTable (the key of one of the project\'s pricing tables, or empty) }`.' },
      style: { type: 'object', description: 'The look, merged key by key: `{ accent, background, text }` as #rrggbb or empty, `radius` (0 to 32), `font` (system, rounded, serif or mono).' },
      options: { type: 'object', description: 'Merged key by key: `{ skippable: true or false, progress: bar, dots or none }`.' },
      locale: { type: 'string', description: 'The language the flow is written in, a tag such as en or pt-BR.' },
      translations: { type: 'object', description: 'Languages by tag, each `{ name, steps: { "<stepId>": { title, body, imageAlt, buttonLabel } } }`: a language you send REPLACES that language and a null value removes it. translate_onboarding_flow fills this with AI.' }
    }
  },
  {
    name: 'delete_onboarding_flow', title: 'Delete an onboarding flow', destructive: true, method: 'DELETE', path: '/v1/admin/onboarding/flows/{id}',
    description: 'Apps that ask for the flow get a 404 from then on; apps that cached it keep showing their copy until they next reach HelpBites. Confirm with the user first.',
    params: { id: id('onboarding flow') }
  },
  {
    name: 'publish_onboarding_flow', title: 'Publish an onboarding flow', method: 'POST', path: '/v1/admin/onboarding/flows/{id}/publish',
    description: 'Freezes the working copy into the next version and serves it to apps at once. Apps that show a flow once per version show it again. Needs at least one step. Confirm with the user first.',
    params: { id: id('onboarding flow') }
  },
  {
    name: 'unpublish_onboarding_flow', title: 'Take an onboarding flow offline', method: 'POST', path: '/v1/admin/onboarding/flows/{id}/unpublish',
    description: 'Back to draft: the public URL answers 404 and apps stop showing it. The version number is kept, so the next publish counts on from it.',
    params: { id: id('onboarding flow') }
  },
  {
    name: 'translate_onboarding_flow', title: 'Translate an onboarding flow with AI', method: 'POST', path: '/v1/admin/onboarding/flows/{id}/translate',
    description: 'Translates the working copy (name, titles, bodies, button labels and image descriptions) from the flow\'s own language into each language in `locales` and saves it in `translations`. Strings that already have a translation are kept unless `overwrite` is true. Apps see it after the next publish. Uses the workspace\'s AI provider or the server\'s gateway (metered in AI credits). Answers `{ flow }`.',
    params: {
      id: id('onboarding flow'),
      locales: { type: 'array', required: true, description: 'Up to 8 language tags such as es, fr or pt-BR, other than the flow\'s own language.' },
      overwrite: { type: 'boolean', description: 'true replaces translations that already exist (including ones a person edited). Default false.' }
    }
  },
  // ---- email templates ---------------------------------------------------------------
  {
    name: 'list_email_starters', title: 'List starter email designs', readOnly: true, method: 'GET', path: '/v1/admin/emails/starters',
    description: 'The built-in designs a new template can start from, each with its id, name and full design. Use an id as `starterId` in create_email_template. The answer is long.',
    params: {}
  },
  {
    name: 'create_email_template', title: 'Create an email template', method: 'POST', path: '/v1/admin/emails',
    description: 'Adds a template. With `project` it is that project\'s own; without, a shared master (workspace-wide keys only). With `master` and `project` it links that master into the project. Otherwise the design comes from `document`, a starter (`starterId`) or a blank page. Sends nothing. Answers `{ template }` with its id and send key.',
    params: {
      project: { type: 'string', description: 'Project id, from list_projects. Leave out to create a shared master.' },
      master: { type: 'string', description: 'The id of a master template to link into the project (needs `project`); its design stays the master\'s.' },
      name: { type: 'string', description: 'The template\'s name, up to 120 characters. Default: the design\'s title.' },
      starterId: { type: 'string', description: 'A built-in design to start from, an id from list_email_starters.' },
      document: { type: 'object', description: 'The design, `{ settings, blocks }`: settings (title, preheader, backgroundColor, contentBackground, contentWidth, fontFamily, textColor) and blocks, each with a unique `id` and a `type` (heading, text, button, image, divider, spacer, columns, section, html or component) with that type\'s fields. Placeholders are written {{name}}. Copy the shape from a starter or get_email_template.' },
      variables: { type: 'array', items: { type: 'object' }, description: 'Labels and defaults for the {{placeholders}} the design uses: `[{ key, label?, defaultValue? }]`. Entries for placeholders the design does not use are dropped.' },
      folder: { type: 'string', description: 'A folder id from list_email_folders, of the same project (or of the masters).' }
    }
  },
  {
    name: 'update_email_template', title: 'Edit an email template', method: 'PATCH', path: '/v1/admin/emails/{id}',
    description: 'Change a template; only the keys you send change. `document` REPLACES the whole design: read it with get_email_template first and send it back whole with your change. A template linked to a master takes only `name`, `key`, `folder` and `variableValues` (its design is the master\'s: edit the master instead, which changes the mail of every project linked to it). Answers `{ template }`.',
    params: {
      id: id('template'),
      name: { type: 'string', description: 'The template\'s name, up to 120 characters.' },
      key: { type: 'string', description: 'The send key mail is sent by (turned into lowercase letters, digits and dashes). Anything that sends it by the old key stops finding it; a key another template of the project has answers 409. The keys confirm-subscription, changelog-confirm and changelog are mail the server sends itself.' },
      description: { type: 'string', description: 'A note about the template, up to 500 characters; an empty string clears it.' },
      document: { type: 'object', description: 'The whole new design, `{ settings, blocks }`, as returned by get_email_template.' },
      variables: { type: 'array', items: { type: 'object' }, description: 'Labels and defaults for the design\'s {{placeholders}}: `[{ key, label?, defaultValue? }]`.' },
      variableValues: { type: 'object', description: 'Linked templates only: this project\'s value for each of the master\'s placeholders, `{ key: "value" }`.' },
      folder: { type: 'string', description: 'Move it to this folder id (from list_email_folders); an empty string moves it out of any folder.' },
      locale: { type: 'string', description: 'The language the design is written in, a tag such as en or pt-BR.' },
      translations: { type: 'object', description: 'Other languages by tag, `{ es: { subject: "…", "<blockId>#label": "…" } }` (the keys translate_email_template writes): a language you send REPLACES that language and a null value removes it. Not for linked templates.' }
    }
  },
  {
    name: 'delete_email_template', title: 'Delete an email template', destructive: true, method: 'DELETE', path: '/v1/admin/emails/{id}',
    description: 'Permanently removes a template; anything that sends it by key (campaigns, sequences, forms, the app) will no longer find it. A master still linked into projects is refused with 409: detach or remove those first. Confirm with the user first.',
    params: { id: id('template') }
  },
  {
    name: 'duplicate_email_template', title: 'Duplicate an email template', method: 'POST', path: '/v1/admin/emails/{id}/duplicate',
    description: 'Copies a template (design, variables, translations, folder) as "<name> copy" with a new send key. Answers `{ template }`.',
    params: { id: id('template') }
  },
  {
    name: 'detach_email_template', title: 'Detach a linked master', destructive: true, method: 'POST', path: '/v1/admin/emails/{id}/detach',
    description: 'Turns a project\'s link to a master into its own copy, with the project\'s accent and values baked in. Later edits to the master no longer reach it and the link cannot be restored. Only for linked templates. Confirm with the user first. Answers `{ template }`.',
    params: { id: id('linked template') }
  },
  {
    name: 'share_email_template', title: 'Set an email template\'s share link', method: 'POST', path: '/v1/admin/emails/{id}/share',
    description: 'Opens or closes a link to one template for people outside the workspace. `view`: anyone with the link sees the rendered email. `edit`: anyone with the link can also change the design (not for masters, linked templates or mail the server sends itself). `off` revokes the link. Every view or edit call restarts the expiry. Answers `{ mode, token, expiresAt }`; the token is the secret part of the link. Confirm with the user first.',
    params: {
      id: id('template'),
      mode: { type: 'string', required: true, enum: ['off', 'view', 'edit'], description: 'What the link allows, or off to revoke it.' },
      expiresInDays: { type: 'integer', maximum: 90, description: 'Days until the link stops working (1 to 90). Default 7 for edit and 30 for view.' }
    }
  },
  {
    name: 'translate_email_template', title: 'Translate an email template with AI', method: 'POST', path: '/v1/admin/emails/{id}/translate',
    description: 'Translates the template\'s words (subject, preheader, headings, text, buttons, image descriptions and component text) from its own language into each language in `locales` and saves them in `translations`. Placeholders, links and tags are kept; a string whose translation lost one stays in the original language. Strings already translated are kept unless `overwrite` is true. A linked template uses its master\'s translations, so translate the master. Uses the workspace\'s AI provider or the server\'s gateway (metered in AI credits). Answers `{ template }`.',
    params: {
      id: id('template'),
      locales: { type: 'array', required: true, description: 'Up to 8 language tags such as es, fr or pt-BR, other than the template\'s own language.' },
      overwrite: { type: 'boolean', description: 'true replaces translations that already exist (including ones a person edited). Default false.' }
    }
  },
  {
    name: 'list_email_chats', title: 'AI designer chats for a template', readOnly: true, method: 'GET', path: '/v1/admin/emails/{id}/chats',
    description: 'The conversations people had with the AI email designer about a template, most recently asked first: `{ chats: [{ id, title, updatedAt, running }] }`, the title being the first question. Read one with get_email_chat.',
    params: { id: id('template') }
  },
  {
    name: 'get_email_chat', title: 'Read an AI designer chat', readOnly: true, method: 'GET', path: '/v1/admin/emails/{id}/chat',
    description: 'The messages of one AI designer chat for a template, oldest first: `{ chatId, messages, streamId }` (`chatId` is null before anyone has asked anything; `streamId` is set while a turn is running).',
    params: { id: id('template'), chat: { type: 'string', description: 'A chat id from list_email_chats. Default: the most recent chat.' } }
  },
  {
    name: 'delete_email_chat', title: 'Delete an AI designer chat', destructive: true, method: 'DELETE', path: '/v1/admin/emails/{id}/chat',
    description: 'Deletes one AI designer chat and its messages for good, stopping a turn it has running. Without `chat` it deletes the MOST RECENT chat. The template\'s design is not changed. Confirm with the user first.',
    params: { id: id('template'), chat: { type: 'string', description: 'A chat id from list_email_chats. Default: the most recent chat.' } }
  },
  {
    name: 'stop_email_chat_turn', title: 'Stop a running AI designer turn', destructive: true, method: 'DELETE', path: '/v1/admin/emails/{id}/chat/stream',
    description: 'Stops the AI email designer while it is answering in a chat. What the turn already changed stays and its reply so far is saved.',
    params: {
      id: id('template'),
      chat: { type: 'string', required: true, description: 'The chat id, from list_email_chats.' },
      message: { type: 'string', description: 'The id of the question: a turn the server has not started yet then stops as soon as it does.' }
    }
  },
  // ---- email folders and components --------------------------------------------------------
  {
    name: 'list_email_folders', title: 'List email folders', readOnly: true, method: 'GET', path: '/v1/admin/email-folders',
    description: 'The folders that organise email templates, by name: a project\'s with `project`, the masters\' without. Each has its id, parent folder and name. Needs a workspace-wide key.',
    params: { project: { type: 'string', description: 'Project id. Leave out for the masters\' folders.' } }
  },
  {
    name: 'create_email_folder', title: 'Create an email folder', method: 'POST', path: '/v1/admin/email-folders',
    description: 'Adds a folder for email templates, at the top level or inside another folder of the same project (or of the masters). Answers `{ folder }`. Needs a workspace-wide key.',
    params: {
      name: { type: 'string', required: true, description: 'The folder\'s name, up to 80 characters.' },
      project: { type: 'string', description: 'Project id. Leave out for a folder of the masters.' },
      parent: { type: 'string', description: 'The id of the folder to put it in, of the same project. Default: the top level.' }
    }
  },
  {
    name: 'update_email_folder', title: 'Rename or move an email folder', method: 'PATCH', path: '/v1/admin/email-folders/{id}',
    description: 'Rename a folder or move it inside another folder of the same project; a folder cannot move into itself. Answers `{ folder }`. Needs a workspace-wide key.',
    params: {
      id: id('folder'),
      name: { type: 'string', description: 'The new name, up to 80 characters.' },
      parent: { type: 'string', description: 'The id of the folder to move it into; an empty string moves it to the top level.' }
    }
  },
  {
    name: 'delete_email_folder', title: 'Delete an email folder', destructive: true, method: 'DELETE', path: '/v1/admin/email-folders/{id}',
    description: 'Deletes the folder. The templates and subfolders inside move up to its parent; nothing else is deleted. Confirm with the user first.',
    params: { id: id('folder') }
  },
  {
    name: 'list_email_components', title: 'List email components', readOnly: true, method: 'GET', path: '/v1/admin/email-components',
    description: 'The library of reusable email blocks (custom HTML with `{{@key}}` fields): the ones shared by every project, plus one project\'s own with `project`. Each has its id, name, description, html, fields and project. Needs a workspace-wide key.',
    params: { project: { type: 'string', description: 'Project id, to add that project\'s own components to the shared ones.' } }
  },
  {
    name: 'create_email_component', title: 'Create an email component', method: 'POST', path: '/v1/admin/email-components',
    description: 'Saves custom HTML as a reusable block. Write `{{@key}}` where each email changes something (copy, a link, an image, a colour). Emails copy a component when they use it, so later edits to the library do not change emails already made. Answers `{ component }`. Needs a workspace-wide key.',
    params: {
      name: { type: 'string', required: true, description: 'The component\'s name, up to 80 characters.' },
      html: { type: 'string', required: true, description: 'The HTML, up to 100,000 characters, with `{{@key}}` slots (a key starts with a letter and has letters, digits and _).' },
      description: { type: 'string', description: 'When to use it, up to 500 characters; the AI designer reads this.' },
      fields: { type: 'array', items: { type: 'object' }, description: 'One per slot: `{ key, label?, type (text, richtext, url, image, color or number), group (content or style), default? }`. A slot with none becomes a text field, guessed from where it sits.' },
      project: { type: 'string', description: 'Project id, to keep it to that project\'s templates. Leave out to share it with every project and master.' }
    }
  },
  {
    name: 'update_email_component', title: 'Update an email component', method: 'PATCH', path: '/v1/admin/email-components/{id}',
    description: 'Changes the library only: emails that already use the component keep their copy until they update from the library. Only the keys you send change. Answers `{ component }`. Needs a workspace-wide key.',
    params: {
      id: id('component'),
      name: { type: 'string', description: 'The new name, up to 80 characters.' },
      description: { type: 'string', description: 'When to use it, up to 500 characters.' },
      html: { type: 'string', description: 'The new HTML with `{{@key}}` slots.' },
      fields: { type: 'array', items: { type: 'object' }, description: 'The fields, `{ key, label?, type, group, default? }`, one per slot.' },
      project: { type: 'string', description: 'Project id to keep it to that project. An empty string shares it with every project.' }
    }
  },
  {
    name: 'delete_email_component', title: 'Delete an email component', destructive: true, method: 'DELETE', path: '/v1/admin/email-components/{id}',
    description: 'Removes the component from the library. Emails that already use it keep their copy. Confirm with the user first.',
    params: { id: id('component') }
  },
  // ---- email log, totals, settings and suppressions -------------------------------------------
  {
    name: 'get_email_log', title: 'Get one email log entry', readOnly: true, method: 'GET', path: '/v1/admin/email-logs/{id}',
    description: 'One message HelpBites sent or tried to send: recipient, subject, status, error, delivery events, the values it was filled with and, when the project keeps message content, its HTML and text; otherwise `templatePreview` shows the template as it renders with the logged values. The id is a `logId` from list_email_logs or a send result.',
    params: { id: id('email log entry') }
  },
  {
    name: 'get_email_stats', title: 'Email totals', readOnly: true, method: 'GET', path: '/v1/admin/email-logs/stats',
    description: 'Counts over the last `days`: by status, by source, per day (total, sent, failed) and the most-sent templates, for one project or the whole workspace. `truncated` is true when the window held more than 50,000 messages.',
    params: {
      project: { type: 'string', description: 'Project id. Leave out for the whole workspace.' },
      days: { type: 'integer', maximum: 365, description: 'How many days back (1 to 365, default 30).' }
    }
  },
  {
    name: 'delete_email_logs', title: 'Delete old email log entries', destructive: true, method: 'DELETE', path: '/v1/admin/email-logs',
    description: 'Permanently deletes log entries created before a date, for one project or the whole workspace. One of `before` or `olderThanDays` is required. At most 20,000 entries go per call: `more: true` in the answer means call again. Old entries are also pruned automatically after the server\'s retention period. Needs the marketing role. Confirm with the user first.',
    params: {
      project: { type: 'string', description: 'Project id. Leave out for every project of the workspace.' },
      before: { type: 'string', description: 'ISO date-time: entries created before it are deleted.' },
      olderThanDays: { type: 'integer', description: 'Entries older than this many days are deleted. Use this or `before`.' }
    }
  },
  {
    name: 'get_email_settings', title: 'How this server sends email', readOnly: true, method: 'GET', path: '/v1/admin/email-settings',
    description: 'Whether email sending (Mailgun) is configured, the default sender every project falls back to, the delivery-webhook address to give Mailgun (and whether its signing key is set) and how many days the log is kept. Holds no secrets. A project\'s own sender is on the project. Needs a workspace-wide key.',
    params: {}
  },
  {
    name: 'add_email_suppressions', title: 'Suppress addresses', method: 'POST', path: '/v1/admin/email-suppressions',
    description: 'Stop a project mailing these addresses (campaigns, sequences and API sends skip them; a test send does not). Addresses already on the list keep their first reason. Answers `{ added, existing }`. Needs the marketing role.',
    params: {
      project: { ...projectId, in: 'body' },
      emails: { type: 'array', required: true, description: 'Up to 1000 email addresses.' },
      reason: { type: 'string', enum: ['manual', 'unsubscribe', 'bounce', 'complaint'], description: 'Why. Default manual.' },
      detail: { type: 'string', description: 'A note for the list, up to 500 characters.' }
    }
  },
  {
    name: 'remove_email_suppression', title: 'Remove a suppressed address', destructive: true, method: 'DELETE', path: '/v1/admin/email-suppressions/{id}',
    description: 'Takes an address off the list: the project mails it again, even if the person unsubscribed or complained. It does not subscribe them to anything. Needs the marketing role. Confirm with the user first.',
    params: { id: id('suppression') }
  },
  // ---- the transactional email API -----------------------------------------------------------
  {
    name: 'send_email', title: 'Send an email', destructive: true, method: 'POST', path: '/v1/emails/send',
    description: 'Sends one message per recipient on behalf of a project: one of its templates (by send key or id), your own HTML, a block document, or a plain-text message in the project\'s layout. Pass exactly one of `template`, `html`, `document` or `message`. Real mail leaves the server and every recipient gets a log entry: confirm the content and the addresses with the user first. Answers `{ id, sent, failed, suppressed, results }` where each result has its `status` and `logId`. Addresses on the suppression list are skipped. Needs email sending set up and room in the workspace\'s monthly and daily allowance.',
    params: {
      project: { ...projectId, in: 'query' },
      to: { type: 'array', required: true, description: 'Up to 50 recipients, plain (`ada@example.com`) or with a name (`Ada Lovelace <ada@example.com>`); each gets their own message.' },
      template: { type: 'string', description: 'A send key (such as welcome) or id of one of the project\'s templates, from list_email_templates.' },
      html: { type: 'string', description: 'Your own HTML, a full document or a fragment, up to 2 MB. {{key}} fills in escaped and {{{key}}} raw. Needs a `subject` unless it has a title tag.' },
      document: { type: 'object', description: 'A block design, `{ settings, blocks }`, as get_email_template returns it.' },
      message: { type: 'object', description: 'A plain-text message in the project\'s layout: `{ subject, body, ctaUrl?, ctaLabel? }`.' },
      subject: { type: 'string', description: 'Overrides the template\'s subject, up to 300 characters; placeholders fill in.' },
      text: { type: 'string', description: 'The plain-text part. Made from the HTML when left out.' },
      locale: { type: 'string', description: 'The language to send a `template` in, a tag such as es or pt-BR: its translation when it has one, else its own language.' },
      variables: { type: 'object', description: 'Values for the {{placeholders}}, `{ key: "value" }`. {{recipient.email}}, {{recipient.name}} and {{project.*}} fill in by themselves.' },
      from: { type: 'string', description: 'Sender name, or `Name <address>`. A different address must be on a domain the project set up.' },
      replyTo: { type: 'string', description: 'The address replies go to.' },
      cc: { type: 'array', description: 'Up to 10 addresses copied on every message.' },
      bcc: { type: 'array', description: 'Up to 10 addresses blind-copied on every message.' },
      headers: { type: 'object', description: 'Extra headers such as List-Unsubscribe, up to 20; values may use placeholders. Reserved headers are refused.' },
      tags: { type: 'array', description: 'Up to 3 short printable-ASCII tags for filtering in the log.' },
      metadata: { type: 'object', description: 'Up to 10 of your own keys with values up to 200 characters, stored on the log and echoed by delivery webhooks.' },
      attachments: { type: 'array', items: { type: 'object' }, description: 'Up to 10 files, 10 MB in all, each `{ filename, content (base64), contentType?, inline? }`.' },
      sendAt: { type: 'string', description: 'ISO date-time to deliver at, up to 72 hours ahead. Left out or in the past means now.' },
      tracking: { type: 'object', description: 'Override open and click tracking: `{ opens: true or false, clicks: true or false }`.' },
      testMode: { type: 'boolean', description: 'Mailgun accepts and logs the message but delivers nothing.' },
      idempotencyKey: { type: 'string', description: 'Up to 128 printable characters without spaces: a retry with the same key within 24 hours returns the first answer instead of sending again.' }
    }
  },
  {
    name: 'render_email', title: 'Preview an email without sending it', method: 'POST', path: '/v1/emails/render',
    description: 'Takes the same content as send_email (a `template`, `html`, `document` or `message`) and returns exactly what the first recipient would get: `{ subject, locale, html, text, from, replyTo, to, cc, bcc, headers, kind, template, attachments }`. Nothing is sent or logged. Saves nothing. `to` is optional (a stand-in recipient is used).',
    params: {
      project: { ...projectId, in: 'query' },
      template: { type: 'string', description: 'A send key (such as welcome) or id of one of the project\'s templates, from list_email_templates.' },
      html: { type: 'string', description: 'Your own HTML, a full document or a fragment. {{key}} fills in escaped and {{{key}}} raw.' },
      document: { type: 'object', description: 'A block design, `{ settings, blocks }`.' },
      message: { type: 'object', description: 'A plain-text message in the project\'s layout: `{ subject, body, ctaUrl?, ctaLabel? }`.' },
      to: { type: 'array', description: 'Recipients: the first one\'s name and address fill the placeholders. Default a stand-in address.' },
      subject: { type: 'string', description: 'Overrides the template\'s subject; placeholders fill in.' },
      text: { type: 'string', description: 'The plain-text part. Made from the HTML when left out.' },
      locale: { type: 'string', description: 'The language to render a `template` in, a tag such as es or pt-BR, when it has a translation.' },
      variables: { type: 'object', description: 'Values for the {{placeholders}}, `{ key: "value" }`.' },
      from: { type: 'string', description: 'Sender name, or `Name <address>`.' },
      replyTo: { type: 'string', description: 'The address replies go to.' },
      cc: { type: 'array', description: 'Addresses copied on the message.' },
      bcc: { type: 'array', description: 'Addresses blind-copied on the message.' },
      headers: { type: 'object', description: 'Extra headers; values may use placeholders.' },
      attachments: { type: 'array', items: { type: 'object' }, description: 'Files, each `{ filename, content (base64), contentType?, inline? }`; the answer lists their names and sizes.' }
    }
  },
  {
    name: 'preview_email_template', title: 'Render a template by id', readOnly: true, method: 'GET', path: '/v1/emails/{template}',
    description: 'Renders one template (a project\'s or a master, by id) with its brand and its default or sample values: `{ id, key, name, subject, locale, html, text, variables }`. It cannot fill in your own values: use render_email for that.',
    params: {
      template: { type: 'string', required: true, description: 'The template\'s id, from list_email_templates.' },
      locale: { type: 'string', description: 'The language to render in, a tag such as es, when the template has a translation for it.' }
    }
  },

  // ======== legal, errors, pricing, revenue and project infrastructure ========
  // ---- legal documents: create, delete, checks, AI helpers, versions, wizard, rules --------
  {
    name: 'create_legal_document', title: 'Create a legal document', method: 'POST', path: '/v1/admin/legal/documents',
    description: 'Creates a draft legal document (privacy policy, terms, cookie or refund policy) and returns it with its sections. `mode` template (default) composes it from reviewed clauses and your `answers` with no AI; ai has the model write it in full (needs an AI provider); blank starts empty; import splits a text you already have (`text`) at its headings, untouched and never sent to an AI. Nothing is public until publish_legal_document. A drafting aid, not legal advice. Needs a plan that includes legal documents.',
    params: {
      project: projectId,
      type: { type: 'string', required: true, enum: ['privacy', 'terms', 'cookies', 'refund'], description: 'The kind of document.' },
      mode: { type: 'string', enum: ['template', 'ai', 'blank', 'import'], description: 'How to write it. Default template.' },
      answers: { type: 'object', description: 'Wizard answers by question id, as get_legal_wizard lists them (for example app_name, entity_name, contact_email, regions as a list of region ids, governing_law for terms). Answers you leave out fall back to the project\'s saved answers and company profile; a required question that is still missing is refused with its name. Optional for blank and import (regions decide which rules apply when you check it).' },
      title: { type: 'string', description: 'The document\'s title. Default: from the type.' },
      slug: { type: 'string', description: 'The public path name. Default: the type, made unique.' },
      locale: { type: 'string', description: 'The document\'s language tag, such as en or pt-BR. Default en.' },
      text: { type: 'string', description: 'Mode import only: the document to import, up to 200,000 characters.' },
      format: { type: 'string', enum: ['markdown', 'html', 'text'], description: 'Mode import only: how `text` is written. Detected when left out.' },
      saveAnswers: { type: 'boolean', description: 'true remembers the answers on the project so its other documents are pre-filled with them.' }
    }
  },
  {
    name: 'delete_legal_document', title: 'Delete a legal document', destructive: true, method: 'DELETE', path: '/v1/admin/legal/documents/{id}',
    description: 'Permanently deletes a legal document and every published version of it. If it was published its public page goes at once. Confirm with the user first.',
    params: { id: { type: 'string', required: true, description: 'The legal document\'s id, from list_legal_documents.' } }
  },
  {
    name: 'get_legal_wizard', title: 'Legal wizard questions', readOnly: true, method: 'GET', path: '/v1/admin/legal/wizard/{type}',
    description: 'The questions the wizard asks for a document type, the regions and the third-party services you can pick, so you know which `answers` create_legal_document, preview_legal_document and recompose_legal_document take. With `project`, `defaults` holds the answers the project already supplies (its company profile and saved answers) and `shared` says whether answers were saved for reuse.',
    params: {
      type: { type: 'string', required: true, enum: ['privacy', 'terms', 'cookies', 'refund'], description: 'The kind of document.' },
      project: { type: 'string', description: 'Project id, from list_projects. Left out, `defaults` is empty.' }
    }
  },
  {
    name: 'preview_legal_document', title: 'Preview a legal document', method: 'POST', path: '/v1/admin/legal/wizard/{type}/compose',
    description: 'Composes the sections from wizard answers and checks them against the applicable rulepacks, without saving anything or using AI. Returns the sections, the Markdown, the cleaned `answers` and the rulepack `coverage`. Saves nothing.',
    params: {
      type: { type: 'string', required: true, enum: ['privacy', 'terms', 'cookies', 'refund'], description: 'The kind of document.' },
      project: { type: 'string', description: 'Project id, from list_projects. When given, gaps are filled from the project\'s company profile and saved answers.' },
      answers: { type: 'object', description: 'Wizard answers by question id, as get_legal_wizard lists them.' }
    }
  },
  {
    name: 'suggest_legal_answers', title: 'Suggest legal answers from the repos', method: 'POST', path: '/v1/admin/legal/wizard/{type}/suggest',
    description: 'Reads the project\'s connected GitHub repos (read-only: the file list and a few dependency manifests) and maps the SDKs and services found to wizard answers, with the evidence for each. Returns `{ answers, evidence, repos, ai }`. Saves nothing: pass the answers you keep to create_legal_document. Fails when the project has no repos (set them with set_project_repos).',
    params: {
      type: { type: 'string', required: true, enum: ['privacy', 'terms', 'cookies', 'refund'], description: 'The kind of document.' },
      project: projectId,
      ai: { type: 'boolean', description: 'true also asks the AI provider about dependencies the built-in table does not know (privacy policy only); it sends dependency names, never code.' }
    }
  },
  {
    name: 'list_legal_clauses', title: 'Legal clause library', readOnly: true, method: 'GET', path: '/v1/admin/legal/clauses',
    description: 'The reviewed clauses the template composer assembles, each with the condition it needs and the rulepack requirements it answers.',
    params: { type: { type: 'string', enum: ['privacy', 'terms', 'cookies', 'refund'], description: 'Only the clauses of this document type. Default all.' } }
  },
  {
    name: 'list_legal_rulepacks', title: 'Legal rulepacks', readOnly: true, method: 'GET', path: '/v1/admin/legal/rulepacks',
    description: 'The curated requirement checklists (laws, platform policies, best practice) that ground the checks, with their sources. `lastReviewed` is null until a person has compared a pack with its sources. A drafting aid, not legal advice.',
    params: { type: { type: 'string', enum: ['privacy', 'terms', 'cookies', 'refund'], description: 'Only the requirements for this document type. Default all.' } }
  },
  {
    name: 'check_legal_document', title: 'Check a legal document', method: 'POST', path: '/v1/admin/legal/documents/{id}/check',
    description: 'Checks a document against the rulepacks that apply to its regions. Always returns the structural `coverage` (which requirements some section answers, which none does; no AI). With `ai: true` the model also reads the text and returns per-requirement `findings` (ok, unclear, missing, conflict). Saves nothing.',
    params: {
      id: { type: 'string', required: true, description: 'The legal document\'s id, from list_legal_documents.' },
      ai: { type: 'boolean', description: 'true also has the AI read the text (needs an AI provider). Default false.' }
    }
  },
  {
    name: 'analyse_legal_text', title: 'Analyse legal text with AI', method: 'POST', path: '/v1/admin/legal/analyse',
    description: 'Reads a privacy policy, terms, cookie or refund text you supply, or one of the project\'s documents by `documentId`, against the rulepack requirements for the regions in `answers.regions`, and reports per requirement whether it is ok, unclear, missing or in conflict. Needs an AI provider. Saves nothing. Not legal advice.',
    params: {
      documentId: { type: 'string', description: 'A legal document\'s id, from list_legal_documents. When given, `type`, `text` and `answers` are taken from the document and ignored here.' },
      type: { type: 'string', enum: ['privacy', 'terms', 'cookies', 'refund'], description: 'The kind of text. Required unless `documentId` is given.' },
      text: { type: 'string', description: 'The text to analyse (the first 60,000 characters are read). Required unless `documentId` is given.' },
      answers: { type: 'object', description: 'Wizard answers; mainly `regions` (a list such as eu, uk, us-ca), which decides the rules that apply.' }
    }
  },
  {
    name: 'suggest_legal_change_note', title: 'Suggest a legal version note', method: 'POST', path: '/v1/admin/legal/documents/{id}/change-note',
    description: 'Has the AI compare the working text with the last published version and write a one or two sentence note of what changed, to pass as `note` to publish_legal_document. Saves nothing. Fails when nothing differs from the last published version. Needs an AI provider.',
    params: { id: { type: 'string', required: true, description: 'The legal document\'s id, from list_legal_documents.' } }
  },
  {
    name: 'recompose_legal_document', title: 'Recompose a legal document', method: 'POST', path: '/v1/admin/legal/documents/{id}/recompose',
    description: 'Re-runs the clause composer (no AI) on the document\'s saved answers, or on new `answers`. Sections written by a person or the AI, and locked sections, keep their text; template sections are refreshed, and clauses that stop or start applying are removed or added. Returns the document and its coverage. On a published document the live page changes at once: confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The legal document\'s id, from list_legal_documents.' },
      answers: { type: 'object', description: 'New wizard answers by question id (see get_legal_wizard). Left out, the saved answers are used again.' },
      saveAnswers: { type: 'boolean', description: 'true also remembers the answers on the project for its other documents.' }
    }
  },
  {
    name: 'rewrite_legal_section', title: 'Rewrite a legal section with AI', method: 'POST', path: '/v1/admin/legal/documents/{id}/sections/{sid}/rewrite',
    description: 'The AI rewrites one section following your `instruction`, keeping what the section\'s requirements need. By default it only returns a `proposal` and saves nothing. With `apply: true` the proposal is saved into the section (marked ai); on a published document the live page then changes at once, so confirm with the user first. A locked section is refused. Needs an AI provider.',
    params: {
      id: { type: 'string', required: true, description: 'The legal document\'s id, from list_legal_documents.' },
      sid: { type: 'string', required: true, description: 'The section\'s id, from get_legal_document.' },
      instruction: { type: 'string', required: true, description: 'What to change, up to 1,000 characters, such as "Mention that we keep logs for 30 days".' },
      apply: { type: 'boolean', description: 'true saves the rewrite into the section. Default false: only a proposal is returned.' }
    }
  },
  {
    name: 'generate_legal_tldr', title: 'Write a legal summary with AI', method: 'POST', path: '/v1/admin/legal/documents/{id}/tldr/generate',
    description: 'The AI writes a short plain-language summary (80 words at most) shown at the top of the public page, marked as AI-written, and saves it. A summary a person wrote is not replaced unless `force` is true (refused otherwise). On a published document the live page changes at once: confirm with the user first. Needs an AI provider.',
    params: {
      id: { type: 'string', required: true, description: 'The legal document\'s id, from list_legal_documents.' },
      force: { type: 'boolean', description: 'true replaces a summary a person wrote. Default false.' }
    }
  },
  {
    name: 'translate_legal_document', title: 'Translate a legal document with AI', method: 'POST', path: '/v1/admin/legal/documents/{id}/translate',
    description: 'Creates a new draft that is this document in another language: every section, the title and the summary are translated, and the text is marked as AI-written for review. The copy is linked to the original, so the public pages link the languages to each other. Nothing is published. Refused when the document already has a copy in that language. Needs an AI provider and a plan with legal documents. Not legal advice: have the translation reviewed.',
    params: {
      id: { type: 'string', required: true, description: 'The legal document\'s id, from list_legal_documents.' },
      locale: { type: 'string', required: true, description: 'The target language tag, such as es, fr or pt-BR; it must differ from the document\'s own.' }
    }
  },
  {
    name: 'list_legal_versions', title: 'Legal document versions', readOnly: true, method: 'GET', path: '/v1/admin/legal/documents/{id}/versions',
    description: 'The published versions of a document, newest first (up to 100): version number, note, who published it and when. Use a version number with restore_legal_version.',
    params: { id: { type: 'string', required: true, description: 'The legal document\'s id, from list_legal_documents.' } }
  },
  {
    name: 'restore_legal_version', title: 'Restore a legal version', destructive: true, method: 'POST', path: '/v1/admin/legal/documents/{id}/versions/{version}/restore',
    description: 'Copies a published version\'s title, sections, summary and answers back into the document, REPLACING the current working text (edits not yet published are lost). It does not record a new version. The live page reads the working text, so on a published document it changes at once: publish a new version afterwards to record it. Confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The legal document\'s id, from list_legal_documents.' },
      version: { type: 'integer', required: true, description: 'The version number to restore, from list_legal_versions.' }
    }
  },
  // ---- errors: status, AI analysis and reports, schedule, alert rules, tracker links ----------
  {
    name: 'get_error_alerts', title: 'Error alert rules', readOnly: true, method: 'GET', path: '/v1/admin/errors/alerts',
    description: 'The project\'s error alert rules, who is mailed and the alerts that fired recently. Returns `{ rules, emails, notifyEmails, recent }`: each rule has id, name, kind (new, total or rate), threshold, windowMinutes, cooldownMinutes, link (a tracker project id, empty for all) and enabled; `emails` are the alert recipients (when empty, the project\'s `notifyEmails` are mailed); `recent` is the last 50 alerts fired.',
    params: { project: projectId }
  },
  {
    name: 'set_error_alerts', title: 'Save error alert rules', destructive: true, method: 'PUT', path: '/v1/admin/errors/alerts',
    description: 'REPLACES the project\'s error alert rules and recipient list with the ones you send, so call get_error_alerts first and send back every rule you want to keep (a rule left out is deleted; at most 20). Matching issues then mail the recipients. Returns the saved `{ rules, emails }`. Confirm with the user first.',
    params: {
      project: projectId,
      rules: { type: 'array', items: { type: 'object' }, required: true, description: 'Every rule to keep: { id?, name, kind: new | total | rate, threshold (times; ignored for new), windowMinutes (rate only: the window), cooldownMinutes (before the same issue can trigger it again), link? (a tracker project id; empty for all), enabled? (default true) }. An empty list removes all rules.' },
      emails: { type: 'array', items: { type: 'string' }, required: true, description: 'Addresses to mail, up to 20. An empty list mails the project\'s notify addresses instead.' }
    }
  },
  {
    name: 'list_error_analyses', title: 'Saved error analyses', readOnly: true, method: 'GET', path: '/v1/admin/errors/analyses',
    description: 'The AI write-ups saved for a project: one per error that was analysed (keyed `link:provider:issueId`, each with text, files, count and time) plus `overview`, the latest triage report. Reads saved text only; nothing is generated (that is analyze_error and analyze_errors).',
    params: { project: projectId }
  },
  {
    name: 'analyze_errors', title: 'Triage unresolved errors with AI', method: 'POST', path: '/v1/admin/errors/analyze',
    description: 'Runs an AI triage of all unresolved errors (the first page of each tracker project): what is pressing, what can wait, shared causes and fixes to try, using the project\'s linked GitHub source where there is any. Saves the result as a new report (see list_error_reports) and returns it as `{ id, text, files, count, source, at }`. Uses the workspace\'s AI provider or AI credits; fails when AI is not set up.',
    params: { project: projectId }
  },
  {
    name: 'analyze_error', title: 'Analyse an error with AI', method: 'POST', path: '/v1/admin/errors/{id}/analyze',
    description: 'AI analysis of one error: likely cause, suggested fix, how to verify and impact, in Markdown. The result is saved and reused: a repeat call returns the saved one (`cached: true`) unless `refresh` is true. With `prompt: true` no AI is called and it returns `{ prompt, files }`, the error context (the event plus the project\'s source files near the failing frames), to hand to a coding agent. Source excerpts from the project\'s linked GitHub repos are sent to the AI provider. Needs an AI provider unless `prompt` is true.',
    params: {
      id: { type: 'string', required: true, description: 'The tracker\'s issue id, from list_errors.' },
      project: projectId,
      link: { type: 'string', description: 'The tracker project (link) id when the project reports to several; default the first.' },
      prompt: { type: 'boolean', description: 'true returns the context for a coding agent and calls no AI.' },
      refresh: { type: 'boolean', description: 'true asks the AI again instead of returning the saved analysis.' }
    }
  },
  {
    name: 'set_error_status', title: 'Set an error\'s status', method: 'PUT', path: '/v1/admin/errors/{id}',
    description: 'Sets an issue\'s status in the connected tracker and moves the inbox conversation made from it (if any) to the same status. `open` reopens it, `resolved` and `closed` finish it. Note list_errors filters on the tracker\'s own words (such as unresolved) while this takes open, resolved or closed. Returns `{ conversation }`, null when the error has none.',
    params: {
      id: { type: 'string', required: true, description: 'The tracker\'s issue id, from list_errors.' },
      project: projectId,
      status: { type: 'string', required: true, enum: ['open', 'resolved', 'closed'], description: 'The new status.' },
      link: { type: 'string', description: 'The tracker project (link) id when the project reports to several; default the first.' }
    }
  },
  {
    name: 'get_filed_error', title: 'Board item for an error', readOnly: true, method: 'GET', path: '/v1/admin/errors/{id}/board',
    description: 'The board item an error was filed as (see file_error_on_board), or `item: null` when it has not been filed. `boardEnabled` says whether the project board is on, which filing needs.',
    params: {
      id: { type: 'string', required: true, description: 'The tracker\'s issue id, from list_errors.' },
      project: projectId,
      link: { type: 'string', description: 'The tracker project (link) id when the project reports to several; default the first.' }
    }
  },
  {
    name: 'list_error_providers', title: 'Error trackers', readOnly: true, method: 'GET', path: '/v1/admin/errors/providers',
    description: 'The error trackers HelpBites supports (GlitchTip, Bugsink) and whether this workspace has a server connected for each. Returns no credentials.',
    params: {}
  },
  {
    name: 'list_error_servers', title: 'Error tracking servers', readOnly: true, method: 'GET', path: '/v1/admin/errors/servers',
    description: 'The error tracking servers every project of this workspace can report to: id, provider, name, url, apiUrl, org, `builtIn` (the HelpBites server\'s own, not editable) and `hasToken`. Tokens are never returned. Servers are added in the panel.',
    params: {}
  },
  {
    name: 'list_error_reports', title: 'Saved error reports', readOnly: true, method: 'GET', path: '/v1/admin/errors/reports',
    description: 'The saved AI triage reports on a project\'s errors, newest first (up to 100): id, text (Markdown), files, count of errors, source (manual or scheduled) and time.',
    params: { project: projectId }
  },
  {
    name: 'delete_error_report', title: 'Delete an error report', destructive: true, method: 'DELETE', path: '/v1/admin/errors/reports/{id}',
    description: 'Permanently removes one saved AI triage report. Confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The report\'s id, from list_error_reports.' },
      project: projectId
    }
  },
  {
    name: 'get_error_report_schedule', title: 'Error triage schedule', readOnly: true, method: 'GET', path: '/v1/admin/errors/schedule',
    description: 'How often the AI triage of unresolved errors runs on its own: `frequency` (off, daily, weekly or monthly) and `nextAt`.',
    params: { project: projectId }
  },
  {
    name: 'set_error_report_schedule', title: 'Set the error triage schedule', method: 'PUT', path: '/v1/admin/errors/schedule',
    description: 'Sets how often the AI triage of unresolved errors runs on its own. The first run is one interval from now; each run saves a report (see list_error_reports) and uses AI credits or the workspace\'s AI provider; a run with nothing open saves none. Returns `{ frequency, nextAt }`.',
    params: {
      project: projectId,
      frequency: { type: 'string', required: true, enum: ['off', 'daily', 'weekly', 'monthly'], description: 'How often it runs; off stops it.' }
    }
  },
  {
    name: 'rename_error_link', title: 'Rename a tracker project', method: 'PUT', path: '/v1/admin/errors/links/{id}',
    description: 'Changes the label shown for one tracker project the project reports to; the project in the tracker keeps its name. Returns `{ project, link }`. The reply is the whole project record and can include an alert webhook URL that carries a token: do not repeat it.',
    params: {
      id: { type: 'string', required: true, description: 'The link id, from `errorLinks` of the project in list_projects (`main` is the first).' },
      project: projectId,
      label: { type: 'string', required: true, description: 'The new label, up to 100 characters.' }
    }
  },
  {
    name: 'remove_error_link', title: 'Stop reporting to a tracker project', destructive: true, method: 'DELETE', path: '/v1/admin/errors/links/{id}',
    description: 'Disconnects one tracker project from this project. The project in the tracker and the conversations made from its errors are left alone; removing the first link promotes the next. Connecting again is done in the panel. The reply is the whole project record and can include an alert webhook URL that carries a token: do not repeat it. Confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The link id, from `errorLinks` of the project in list_projects (`main` is the first).' },
      project: projectId
    }
  },
  // ---- pricing tables: delete, unpublish, translate, preview ---------------------------------
  {
    name: 'delete_pricing_table', title: 'Delete a pricing table', destructive: true, method: 'DELETE', path: '/v1/admin/pricing-tables/{id}',
    description: 'Permanently deletes a pricing table. Apps that ask for it get a 404 from then on and its checkout links stop working; nothing changes in Stripe. Confirm with the user first.',
    params: { id: { type: 'string', required: true, description: 'The pricing table\'s id, from list_pricing_tables.' } }
  },
  {
    name: 'unpublish_pricing_table', title: 'Unpublish a pricing table', method: 'POST', path: '/v1/admin/pricing-tables/{id}/unpublish',
    description: 'Takes a pricing table back to a draft: its public URL and checkout links answer 404 and onboarding steps that show it show their text only. The working copy is kept and it can be published again. Real visitors are affected: confirm with the user first.',
    params: { id: { type: 'string', required: true, description: 'The pricing table\'s id, from list_pricing_tables.' } }
  },
  {
    name: 'translate_pricing_table', title: 'Translate a pricing table with AI', method: 'POST', path: '/v1/admin/pricing-tables/{id}/translate',
    description: 'Machine-translates the working copy (name, title, plans, features, buttons, small print; prices and numbers stay) from the table\'s own language into each of `locales` and saves the result in `translations`. Strings that already have a translation are kept unless `overwrite` is true. Apps see it after the next publish_pricing_table. Uses the workspace\'s AI provider or AI credits. Returns the table.',
    params: {
      id: { type: 'string', required: true, description: 'The pricing table\'s id, from list_pricing_tables.' },
      locales: { type: 'array', items: { type: 'string' }, required: true, description: 'Language tags to translate into, up to 8, such as es, fr or pt-BR; the table\'s own language is skipped.' },
      overwrite: { type: 'boolean', description: 'true replaces translations that already exist. Default false.' }
    }
  },
  {
    name: 'preview_pricing_table', title: 'Preview a pricing table', method: 'POST', path: '/v1/admin/pricing-tables/{id}/preview',
    description: 'Shows the table as apps would get it, with Stripe\'s current prices, after applying the changes you pass to a copy of the working copy (send nothing for the table as saved). Saves nothing, and the buttons carry no checkout links: use it to check a draft before update_pricing_table. The change fields take the same shapes as update_pricing_table. Returns `{ preview }`.',
    params: {
      id: { type: 'string', required: true, description: 'The pricing table\'s id, from list_pricing_tables.' },
      previewLocale: { type: 'string', description: 'A language tag to show the table in, such as es. Default the table\'s own.' },
      previewCurrency: { type: 'string', description: 'A currency code to show prices in, such as eur.' },
      name: { type: 'string', description: 'Try a different name (up to 80 characters).' },
      template: { type: 'string', enum: ['tiers', 'rows', 'paywall', 'matrix', 'spotlight'], description: 'Try a different layout.' },
      plans: { type: 'array', items: { type: 'object' }, description: 'Try these plans instead of the saved ones (the whole list, as in update_pricing_table).' },
      features: { type: 'array', items: { type: 'object' }, description: 'Try these feature rows instead of the saved ones (the whole list).' },
      content: { type: 'object', description: 'Try these words: title, subtitle, footnote, labels and links, as in update_pricing_table.' },
      style: { type: 'object', description: 'Try this look: accent, background, text, radius, font, density, surface, highlight.' },
      options: { type: 'object', description: 'Try these options: defaultInterval, yearlyAs, cumulative, showExcluded, compare, currency.' },
      checkout: { type: 'object', description: 'Try these checkout settings: successUrl, cancelUrl, allowPromotionCodes.' },
      locale: { type: 'string', description: 'Try a different language for the table\'s own text.' },
      translations: { type: 'object', description: 'Try these translations by language tag, as in update_pricing_table.' }
    }
  },
  // ---- revenue and Stripe ----------------------------------------------------------------------
  {
    name: 'get_revenue_report', title: 'Revenue report', readOnly: true, method: 'GET', path: '/v1/admin/revenue/report',
    description: 'A project\'s revenue over every connected source (Stripe, App Store, Paddle, Lemon Squeezy, RevenueCat, custom): net revenue, refunds, MRR, ARR, subscribers (active, trialing, past due), new and churned subscribers, the last 12 months month by month, plans, top customers, recent payments and what each source brought in the period. Totals are in the currency with the most revenue; others are listed in `otherCurrencies`. `report` is null until something has been paid.',
    params: {
      project: projectId,
      range: { type: 'string', enum: ['30d', '90d', '12m', 'all'], description: 'The period for the totals. Default 30d.' }
    }
  },
  {
    name: 'sync_revenue_source', title: 'Sync a revenue source now', method: 'POST', path: '/v1/admin/revenue/sync',
    description: 'Starts a background run that reads one revenue source again (Stripe, App Store, Paddle or Lemon Squeezy; RevenueCat and the custom source send their data themselves and cannot be synced). Runs also happen hourly. Returns the connection with status running; check get_stripe_connection for Stripe. Refused when the source is not connected or a run is already going.',
    params: {
      project: projectId,
      source: { type: 'string', required: true, enum: ['stripe', 'apple', 'paddle', 'lemonsqueezy'], description: 'The source to read.' },
      reset: { type: 'boolean', description: 'true reads the whole history again (slow), to pick up refunds and changes to old payments. Default false.' }
    }
  },
  {
    name: 'get_testflight_usage', title: 'TestFlight usage', readOnly: true, method: 'GET', path: '/v1/admin/revenue/testflight',
    description: 'The App Store Connect account\'s apps (up to 10), each with its 8 newest builds and their TestFlight usage: installs, sessions, crashes, invites and feedback, per build and per app. Read through the connected App Store source\'s key, which must be allowed to see apps. Cached for ten minutes. Returns `{ report }`; refused when the App Store is not connected.',
    params: {
      project: projectId,
      fresh: { type: 'string', enum: ['1'], description: 'Send 1 to skip the ten-minute cache.' }
    }
  },
  {
    name: 'get_stripe_connection', title: 'Is Stripe connected?', readOnly: true, method: 'GET', path: '/v1/admin/stripe',
    description: 'Whether Stripe is connected to the project and how the last sync went, as `{ connection }`: connected, accountName, currency, livemode, status (idle, running or error), lastRunAt, lastError and counts of payments, subscriptions and contacts. The key is never returned.',
    params: { project: projectId }
  },
  {
    name: 'get_contact_billing', title: 'A contact\'s Stripe data', readOnly: true, method: 'GET', path: '/v1/admin/stripe/contact',
    description: 'One person\'s billing: their Stripe customer (read live from Stripe by their stripe_customer attribute or email; null when there is none, Stripe is not connected or it does not answer), and their subscriptions and payments from every revenue source, newest first (up to 50 each). Returns `{ currency, customer, subscriptions, payments }`.',
    params: {
      project: projectId,
      contact: { type: 'string', required: true, description: 'The contact id, from list_contacts.' }
    }
  },
  // ---- project infrastructure: webhooks, domains, inbound mail, repos, overview, AI cards ------
  {
    name: 'update_webhook_endpoint', title: 'Change a webhook endpoint', destructive: true, method: 'PATCH', path: '/v1/admin/projects/{id}/webhooks/{wid}',
    description: 'Changes a webhook endpoint\'s URL, description, event filters or whether it is on. Only the keys you send change, and `events` REPLACES the filters. Changing `url` sends every matching event to the new address: confirm with the user first. The signing secret is not returned or changed here.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      wid: { type: 'string', required: true, description: 'The endpoint\'s id, from list_webhook_endpoints.' },
      url: { type: 'string', description: 'The http(s) address to post to.' },
      description: { type: 'string', description: 'What it is for.' },
      events: { type: 'array', items: { type: 'string' }, description: 'Event filters, replacing the old ones: * (everything), a group such as feedback.*, or an exact type such as changelog.entry.published.' },
      enabled: { type: 'boolean', description: 'false pauses it without deleting it.' }
    }
  },
  {
    name: 'delete_webhook_endpoint', title: 'Remove a webhook endpoint', destructive: true, method: 'DELETE', path: '/v1/admin/projects/{id}/webhooks/{wid}',
    description: 'Permanently removes a webhook endpoint; deliveries still waiting for it are dropped. Confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      wid: { type: 'string', required: true, description: 'The endpoint\'s id, from list_webhook_endpoints.' }
    }
  },
  {
    name: 'test_webhook_endpoint', title: 'Send a test webhook', method: 'POST', path: '/v1/admin/projects/{id}/webhooks/{wid}/test',
    description: 'Queues a `webhook.test` event for the endpoint, signed and retried like a real one, so it is posted to the endpoint\'s URL. See how it went with list_webhook_deliveries. At most 10 a minute per endpoint.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      wid: { type: 'string', required: true, description: 'The endpoint\'s id, from list_webhook_endpoints.' }
    }
  },
  {
    name: 'list_webhook_deliveries', title: 'Recent webhook deliveries', readOnly: true, method: 'GET', path: '/v1/admin/projects/{id}/webhooks/deliveries',
    description: 'The latest webhook deliveries across the project, or one endpoint\'s, newest first: endpoint, event type, status (pending, delivered or failed), attempts, last error and times. The payloads are not included.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      endpoint: { type: 'string', description: 'Only this endpoint\'s deliveries (an id from list_webhook_endpoints).' },
      limit: { type: 'integer', maximum: 100, description: 'How many to return (up to 100). Default 30.' }
    }
  },
  {
    name: 'list_project_domains', title: 'Custom domains', readOnly: true, method: 'GET', path: '/v1/admin/projects/{id}/domains',
    description: 'The custom domains of a project, each with its `state` (pending, verified or failed), the public page its root shows, the DNS records to add with the result of the last check, and the per-project `limit`.',
    params: { id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' } }
  },
  {
    name: 'add_project_domain', title: 'Add a custom domain', method: 'POST', path: '/v1/admin/projects/{id}/domains',
    description: 'Registers a host such as feedback.example.com for the project\'s public pages and returns it with the DNS records (a TXT that proves the host is yours, a CNAME or A that points it here) for the user to add at their DNS provider. Nothing is served until verify_project_domain finds them. Needs a plan with custom domains.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      host: { type: 'string', required: true, description: 'The host name, such as feedback.example.com.' },
      target: { type: 'string', enum: ['hub', 'feedback', 'roadmap', 'changelog', 'blog'], description: 'The public page the host\'s root shows (every public page is also reachable under it). Default hub.' }
    }
  },
  {
    name: 'update_project_domain', title: 'Change what a custom domain shows', method: 'PATCH', path: '/v1/admin/projects/{id}/domains/{domainId}',
    description: 'Changes which public page a custom domain\'s root shows; every public page stays reachable under it.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      domainId: { type: 'string', required: true, description: 'The domain\'s id, from list_project_domains.' },
      target: { type: 'string', required: true, enum: ['hub', 'feedback', 'roadmap', 'changelog', 'blog'], description: 'The public page the host\'s root shows.' }
    }
  },
  {
    name: 'verify_project_domain', title: 'Check a custom domain\'s DNS', method: 'POST', path: '/v1/admin/projects/{id}/domains/{domainId}/verify',
    description: 'Looks up the domain\'s TXT and CNAME/A records. When both are right the domain becomes `verified` and starts serving; otherwise it is `failed` and each record says whether it was found. DNS changes can take a while to spread: call it again later. At most 10 checks a minute.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      domainId: { type: 'string', required: true, description: 'The domain\'s id, from list_project_domains.' }
    }
  },
  {
    name: 'remove_project_domain', title: 'Remove a custom domain', destructive: true, method: 'DELETE', path: '/v1/admin/projects/{id}/domains/{domainId}',
    description: 'Stops serving the host at once; its DNS records are the user\'s to remove. Confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      domainId: { type: 'string', required: true, description: 'The domain\'s id, from list_project_domains.' }
    }
  },
  {
    name: 'list_inbound_addresses', title: 'Inbound mail addresses', readOnly: true, method: 'GET', path: '/v1/admin/projects/{id}/inbound-addresses',
    description: 'The addresses a project receives mail at: mail sent to one becomes a conversation in the inbox. Each has a kind (`domain` or `forward`), a state (pending, verified or failed), the MX records to set and the public address replies use. Also returns `limit` and `forwardingDomain` (empty when the server offers none). A forwarding alias works like a password, since anyone who knows it can write into the inbox: do not repeat it.',
    params: { id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' } }
  },
  {
    name: 'add_inbound_address', title: 'Add an inbound mail address', method: 'POST', path: '/v1/admin/projects/{id}/inbound-addresses',
    description: 'Adds an address that receives mail. Kind `domain` takes an `address` on a domain whose MX records point at the mail provider; it stays pending until verify_inbound_address. Kind `forward` makes a HelpBites alias for the user to forward their own mailbox to; pass `publicAddress` so replies come from the address customers know. Needs a plan with support email addresses.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      kind: { type: 'string', required: true, enum: ['domain', 'forward'], description: 'domain: an address on the user\'s own domain; forward: a HelpBites alias to forward to.' },
      address: { type: 'string', description: 'Kind domain only: the address to receive at, such as support@mail.example.com.' },
      publicAddress: { type: 'string', description: 'Kind forward: the address customers know, such as support@example.com, which replies are sent from.' },
      fromName: { type: 'string', description: 'The sender name replies carry (up to 80 characters).' }
    }
  },
  {
    name: 'remove_inbound_address', title: 'Remove an inbound mail address', destructive: true, method: 'DELETE', path: '/v1/admin/projects/{id}/inbound-addresses/{addressId}',
    description: 'Stops receiving mail at an address: mail sent to it afterwards is dropped. Conversations already made from it stay. Confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      addressId: { type: 'string', required: true, description: 'The address\'s id, from list_inbound_addresses.' }
    }
  },
  {
    name: 'verify_inbound_address', title: 'Check an address\'s MX records', method: 'POST', path: '/v1/admin/projects/{id}/inbound-addresses/{addressId}/verify',
    description: 'For a `domain` address: looks up the domain\'s MX records and marks the address `verified` when they point at the mail provider, otherwise `failed`. A forwarding alias has nothing to check. At most 10 checks a minute.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      addressId: { type: 'string', required: true, description: 'The address\'s id, from list_inbound_addresses.' }
    }
  },
  {
    name: 'get_project_repos', title: 'A project\'s GitHub repos', readOnly: true, method: 'GET', path: '/v1/admin/projects/{id}/repos',
    description: 'The GitHub repos a project reads, as `{ repos: [{ installationId, id, fullName, defaultBranch }] }`. They are read-only sources for AI error notes, legal-document answers and pricing suggestions.',
    params: { id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' } }
  },
  {
    name: 'set_project_repos', title: 'Set a project\'s GitHub repos', destructive: true, method: 'PUT', path: '/v1/admin/projects/{id}/repos',
    description: 'REPLACES the project\'s repo list (up to 10). Each repo must be visible to one of the workspace\'s GitHub connections (see list_github_connection_repos), so read get_project_repos first and send back the ones to keep. Returns `{ repos }`. Confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      repos: { type: 'array', items: { type: 'object' }, required: true, description: 'Every repo to keep, each { installationId, id }: the connection\'s id from list_github_connections and the repo\'s numeric id from list_github_connection_repos. An empty list removes all.' }
    }
  },
  {
    name: 'get_project_overview', title: 'Project overview', readOnly: true, method: 'GET', path: '/v1/admin/projects/{id}/overview',
    description: 'One project\'s headline numbers, its setup checklist, what needs attention (unread conversations and more) and the latest activity, as `{ stats, setup, attention, activity }`.',
    params: { id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' } }
  },
  {
    name: 'get_project_setup', title: 'Project setup checklist', readOnly: true, method: 'GET', path: '/v1/admin/projects/{id}/setup',
    description: 'What is wired up in one project, judged from what HelpBites has seen: the chat widget loaded, an identity token accepted, someone who gets notified, a sender mail can go from, a live assistant, Stripe synced, a GitHub repo linked, an error tracker connected. Returns `{ done, total, items }`; each item has a `state` (done, todo or attention), a `reason` code and a `value`.',
    params: { id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' } }
  },
  {
    name: 'get_project_email_setup', title: 'Is the project\'s email set up?', readOnly: true, method: 'GET', path: '/v1/admin/projects/{id}/email-setup',
    description: 'What the project\'s email needs before it works: a mailer on the server, a sender address and domain, the delivery webhook that brings bounces and opens back, and for campaigns and sequences a postal address and a sender the reputation guard has not paused. Returns `{ sending, bulk, checks }`: `sending` means mail can go out, `bulk` that campaigns and sequences can start; each check has a key, state (ok, warn or todo), scope and value.',
    params: { id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' } }
  },
  {
    name: 'create_cards_with_ai', title: 'Turn text into cards with AI', method: 'POST', path: '/v1/admin/projects/{id}/ai-cards',
    description: 'The AI chat of the feedback and board pages: the AI splits the last user message into separate cards and creates them, at most 20 per call. Kind `feedback` makes posts on the public feedback board, authored by the team; kind `board` makes board items, and the AI can also change existing board items (at most 20 changes) and link items to each other. It uses only the types, tags, labels and statuses the project defines and treats the text as data. Returns the AI\'s `reply` and the `created`, `updated` and `failed` lists. Metered like every AI call; needs an AI provider. Confirm with the user first.',
    params: {
      id: { type: 'string', required: true, description: 'The project\'s id, from list_projects.' },
      kind: { type: 'string', required: true, enum: ['feedback', 'board'], description: 'Make feedback posts or board items.' },
      messages: { type: 'array', items: { type: 'object' }, required: true, description: 'The conversation so far, oldest first, up to 12 messages, each { role: user or assistant, content } with content up to 20,000 characters. The last one must be from the user: its text is what is split into cards.' },
      attachments: { type: 'array', items: { type: 'object' }, description: 'Files added to every card it makes, up to 10, each exactly as upload_board_comment_attachment returned it.' }
    }
  },
  // ---- GitHub connections (read-only) and the workspace -------------------------------------
  {
    name: 'list_github_connections', title: 'GitHub connections', readOnly: true, method: 'GET', path: '/v1/admin/github',
    description: 'The GitHub accounts connected to this workspace: id, account, type, avatar, the user id of who connected it and when, as `{ configured, installations }`. `configured` is false until the server owner has registered a GitHub App. No tokens are returned. Connecting and disconnecting are done in the panel.',
    params: {}
  },
  {
    name: 'list_github_connection_repos', title: 'Repos a GitHub connection can read', readOnly: true, method: 'GET', path: '/v1/admin/github/installations/{id}/repos',
    description: 'The repos one GitHub connection can read (up to 500): id, fullName, private and defaultBranch. Use the ids with set_project_repos. Needs a role that can manage projects; refused when GitHub no longer has the installation.',
    params: { id: { type: 'string', required: true, description: 'The connection\'s id, from list_github_connections.' } }
  },
  {
    name: 'get_workspace', title: 'This workspace', readOnly: true, method: 'GET', path: '/v1/admin/workspace',
    description: 'The workspace this key acts in: id, name, status and the role it has there. Needs a key that is not limited to some projects.',
    params: {}
  },
  {
    name: 'get_usage', title: 'Plan and usage', readOnly: true, method: 'GET', path: '/v1/admin/usage',
    description: 'The workspace\'s plan, its limits (null means none) and the features it includes, and what has been used: gauges as they stand now and counters for the current month. Needs a key that is not limited to some projects.',
    params: {}
  },
  {
    name: 'rename_workspace', title: 'Rename the workspace', method: 'PATCH', path: '/v1/admin/workspace',
    description: 'Changes the workspace\'s name (up to 80 characters). Needs a role that can change workspace settings. Returns `{ workspace }`.',
    params: { name: { type: 'string', required: true, description: 'The new name.' } }
  },

  // ======== pages, blog and brand ========
  // ---- blog: posts and pages ---------------------------------------------------------
  {
    name: 'list_blog_posts', title: 'List blog posts', readOnly: true, method: 'GET', path: '/v1/admin/blog/posts',
    description: 'A project\'s blog posts and standalone blog pages (About, Contact), drafts first, then published newest first, up to 1,000, with no paging. The reply is `{ posts }`: each has `id`, `slug`, `title`, `status` (draft or published), `live` (false while its `publishedAt` is still ahead: scheduled), `tags`, `commentCount` and `newsletter` (its campaign, if sent), but an empty `body`: read one with get_blog_post for the text.',
    params: {
      project: projectId,
      status: { type: 'string', enum: ['draft', 'published'], description: 'Only drafts, or only published posts.' },
      tag: { type: 'string', description: 'Only posts with this tag (any case).' },
      type: { type: 'string', enum: ['post', 'page'], description: 'Only posts, or only standalone blog pages. Both when left out.' }
    }
  },
  {
    name: 'get_blog_post', title: 'Get a blog post', readOnly: true, method: 'GET', path: '/v1/admin/blog/posts/{id}',
    description: 'One post with its Markdown `body` and rendered `bodyHtml`, drafts included, plus its slug, excerpt, cover, SEO fields, tags, visibility, comment count and newsletter state.',
    params: { id: id('post') }
  },
  {
    name: 'create_blog_post', title: 'Write a blog post', method: 'POST', path: '/v1/admin/blog/posts',
    description: 'Creates a draft post by default, or a standalone page with `type` page (it stays out of the post list, the feed and the newsletter). `body` is Markdown, or HTML with `bodyFormat` html; it is rendered and sanitised once. The slug comes from the title unless you send one, and gets -2, -3 when taken. `status` published with no `publishedAt` makes it PUBLIC now (and sends the blog.post.published webhook); a `publishedAt` in the future schedules it. Prefer a draft unless the user said to publish: confirm with the user first before publishing. Returns `{ post }` with its id.',
    params: {
      project: projectId,
      title: { type: 'string', required: true, description: 'Up to 200 characters.' },
      slug: { type: 'string', description: 'Up to 80 characters of lowercase words and dashes. Default: made from the title.' },
      excerpt: { type: 'string', description: 'The lead-in, up to 300 characters. Left out, it is taken from the body.' },
      type: { type: 'string', enum: ['post', 'page'], description: 'post (default) or a standalone page.' },
      body: { type: 'string', description: 'The text, up to 200,000 characters: Markdown, or HTML with bodyFormat html.' },
      bodyFormat: { type: 'string', enum: ['markdown', 'html'], description: 'Default markdown.' },
      data: { type: 'object', description: 'JSON of your own (up to 200,000 characters as JSON) returned as `data` on the post, for a site that renders posts itself. Not shown on the hosted blog.' },
      coverImageUrl: { type: 'string', description: 'An http(s) URL of the cover image.' },
      coverImageAlt: { type: 'string', description: 'Alt text of the cover, up to 300 characters.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Up to 10 tags of up to 40 characters.' },
      featured: { type: 'boolean', description: 'Show it first: large on the magazine layout, marked on the others. Default false.' },
      visibility: { type: 'string', enum: ['public', 'members'], description: 'members: the excerpt is public and the body is for signed-in readers. Default public.' },
      metaTitle: { type: 'string', description: 'For search engines, up to 300 characters. The title when empty.' },
      metaDescription: { type: 'string', description: 'For search engines and link previews, up to 500 characters. The excerpt when empty.' },
      ogImageUrl: { type: 'string', description: 'An http(s) URL for link previews. The cover when empty.' },
      canonicalUrl: { type: 'string', description: 'An http(s) URL of where the post first appeared, when elsewhere.' },
      status: { type: 'string', enum: ['draft', 'published'], description: 'Default draft. published makes it public (or scheduled, with a future publishedAt).' },
      publishedAt: { type: 'string', description: 'ISO date-time. Past or left out with status published: live now; in the future: scheduled.' },
      commentsOpen: { type: 'boolean', description: 'Whether readers may comment. Default true.' },
      authorName: { type: 'string', description: 'Shown as the author. Default: the operator who owns this assistant\'s key.' }
    }
  },
  {
    name: 'update_blog_post', title: 'Edit a blog post', method: 'PATCH', path: '/v1/admin/blog/posts/{id}',
    description: 'Edits a post or page; only the keys you send change. Publishing it with `status` published (no date: dated now) makes it PUBLIC, and editing a live post changes the hosted page, the embed and the feed at once; both send the blog.post.* webhooks. Unpublishing (`status` draft) keeps the date. A newsletter that already went out stays as sent; one scheduled with the post follows it. Confirm with the user first before publishing or changing a live post. Returns `{ post }`.',
    params: {
      id: id('post'),
      title: { type: 'string', description: 'Up to 200 characters.' },
      slug: { type: 'string', description: 'Lowercase words and dashes, up to 80 characters. Changing it moves a live post\'s address. An empty string is ignored.' },
      excerpt: { type: 'string', description: 'The lead-in, up to 300 characters. An empty string clears it, so it follows the body again.' },
      type: { type: 'string', enum: ['post', 'page'], description: 'Turn it into a standalone page, or back into a post.' },
      body: { type: 'string', description: 'The whole new text (it REPLACES the old one), up to 200,000 characters. Read get_blog_post first when you only mean to change part of it.' },
      bodyFormat: { type: 'string', enum: ['markdown', 'html'], description: 'How `body` is written.' },
      data: { type: 'object', description: 'Your own JSON, replacing the old. Send {} to empty it (only a null would remove it, which an assistant cannot send).' },
      coverImageUrl: { type: 'string', description: 'An http(s) URL. An empty string removes the cover.' },
      coverImageAlt: { type: 'string', description: 'Alt text of the cover, up to 300 characters; empty clears it.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'REPLACES all tags: up to 10 of up to 40 characters. An empty list removes them all.' },
      featured: { type: 'boolean', description: 'Show it first.' },
      visibility: { type: 'string', enum: ['public', 'members'], description: 'members: the body is for signed-in readers.' },
      metaTitle: { type: 'string', description: 'For search engines, up to 300 characters; empty clears it.' },
      metaDescription: { type: 'string', description: 'For search engines and link previews, up to 500 characters; empty clears it.' },
      ogImageUrl: { type: 'string', description: 'An http(s) URL for link previews; empty clears it.' },
      canonicalUrl: { type: 'string', description: 'An http(s) URL of where it first appeared; empty clears it.' },
      status: { type: 'string', enum: ['draft', 'published'], description: 'published makes it public (or scheduled, with a future publishedAt); draft takes it offline.' },
      publishedAt: { type: 'string', description: 'ISO date-time; a future one schedules it. An empty string clears the date (a published post is then dated now).' },
      commentsOpen: { type: 'boolean', description: 'Whether readers may comment.' },
      authorName: { type: 'string', description: 'Shown as the author, up to 120 characters.' }
    }
  },
  {
    name: 'delete_blog_post', title: 'Delete a blog post', destructive: true, method: 'DELETE', path: '/v1/admin/blog/posts/{id}',
    description: 'Permanently removes the post with all its comments and reactions. A newsletter it went out as stays under the campaigns with its numbers. Deleting a public post sends the blog.post.deleted webhook. Confirm with the user first.',
    params: { id: id('post') }
  },
  {
    name: 'send_blog_newsletter', title: 'Send a blog post as a newsletter', destructive: true, method: 'POST', path: '/v1/admin/blog/posts/{id}/newsletter',
    description: 'Emails a published post to the project\'s subscribers as a campaign (it then shows with the other campaigns, with test sends, pause, cancel and numbers). The audience is subscribed contacts with an email: `audience.topic` (default: the blog\'s newsletter topic) leaves out anyone who opted out of it, `audience.segment` narrows it. With `send` now or schedule it REACHES REAL PEOPLE and cannot be unsent; with `send` draft or left out it only prepares a draft campaign to test first. A post goes out once (a canceled campaign can be replaced). The post must be published or scheduled (a scheduled post\'s newsletter waits for it), not a page; the project needs a postal address set for campaigns and a plan with campaigns. Needs the marketing role. Returns `{ campaign, post }`. Confirm with the user first.',
    params: {
      id: id('post'),
      subject: { type: 'string', description: 'The email subject. Default: the post\'s title.' },
      name: { type: 'string', description: 'The campaign\'s name. Default: "Blog: <title>".' },
      audience: { type: 'object', description: '{ topic?: topic key to respect, segment?: segment id from list_segments }. Default: the blog\'s newsletter topic.' },
      send: { type: 'string', enum: ['now', 'schedule', 'draft'], description: 'now: send immediately (or when the post goes live); schedule: send at `scheduledAt`; draft or left out: only prepare the campaign.' },
      scheduledAt: { type: 'string', description: 'ISO date-time, with send schedule. Not before the post goes live.' },
      testMode: { type: 'boolean', description: 'Log every message but deliver none.' }
    }
  },
  {
    name: 'draft_blog_post_with_ai', title: 'Write a blog post with AI', method: 'POST', path: '/v1/admin/blog/ai',
    description: 'Asks the project\'s AI to propose Markdown, reading up to three of its linked GitHub repos (read-only), the post as it stands and your `instruction`. Saves nothing: show the draft to the user, then apply what they keep with create_blog_post or update_blog_post. Returns `{ result: { body, title, excerpt, metaDescription, tags, notes, repos } }`; fields a mode does not produce are empty. Uses the workspace\'s AI provider or the server\'s gateway (metered in AI credits); six requests a minute per operator; 501 when no AI provider is set up.',
    params: {
      project: projectId,
      mode: { type: 'string', required: true, enum: ['write', 'continue', 'improve', 'meta', 'insert'], description: 'write: a whole post (needs `instruction` or `title`); continue: text to add after `body`; improve: `body` rewritten with the same meaning (or only `selection`); meta: title, excerpt, meta description and tags for `body`; insert: a passage for `instruction`.' },
      instruction: { type: 'string', description: 'What the post is about, or how to change it, up to 2,000 characters. Required for insert.' },
      title: { type: 'string', description: 'The post\'s title so far, up to 200 characters.' },
      body: { type: 'string', description: 'The post\'s Markdown so far. Required for continue, improve and meta.' },
      selection: { type: 'string', description: 'With improve: only this passage (up to 20,000 characters of Markdown) is rewritten, following `instruction`; the result `body` replaces it.' },
      repos: { type: 'array', items: { type: 'string' }, description: 'Linked repos to read, as owner/name (from list_cms_repos). All of them (three at most) when left out.' }
    }
  },
  // ---- blog: comments ---------------------------------------------------------------
  {
    name: 'list_blog_comments', title: 'List blog comments', readOnly: true, method: 'GET', path: '/v1/admin/blog/comments',
    description: 'The comments on every post of the project for moderation, newest first, each with its post (`postTitle`, `postSlug`), author, `status` and `body`. Visible and hidden ones unless `status` narrows it. The reply is `{ comments, total, hasMore }`: page with `skip`. Hide, show or remove one with update_blog_comment and delete_blog_comment, and answer as the team with comment_on_blog_post.',
    params: {
      project: projectId,
      status: { type: 'string', enum: ['visible', 'hidden', 'deleted'], description: 'Only comments in this state. Left out: visible and hidden.' },
      post: { type: 'string', description: 'Only the comments on this post (its id or slug).' },
      limit: limit(100),
      skip: { type: 'integer', description: 'Comments to skip.' }
    }
  },
  {
    name: 'update_blog_comment', title: 'Hide or show a blog comment', method: 'PATCH', path: '/v1/blog/comments/{id}',
    description: 'Moderates a comment with `status`: hidden takes it off the post, visible brings it back (the post\'s comment count follows). With `body` it edits the words, but only a comment this same operator wrote as the team: a moderator cannot rewrite what a reader said (403). Returns `{ comment, commentCount }`. To remove one for good use delete_blog_comment.',
    params: {
      id: id('comment'),
      status: { type: 'string', enum: ['visible', 'hidden'], description: 'Moderation: show or hide the comment.' },
      body: { type: 'string', description: 'New Markdown text, up to 4,000 characters. Only for a team comment you wrote yourself.' }
    }
  },
  {
    name: 'delete_blog_comment', title: 'Delete a blog comment', destructive: true, method: 'DELETE', path: '/v1/blog/comments/{id}',
    description: 'Takes a comment down for good: its words are erased and the row stays only so the replies under it keep their place. Returns the post\'s new visible `commentCount`. To only hide it, use update_blog_comment. Confirm with the user first.',
    params: { id: id('comment') }
  },
  {
    name: 'comment_on_blog_post', title: 'Answer a blog post as the team', method: 'POST', path: '/v1/blog/{ref}/comments',
    description: 'Posts a PUBLIC comment on a live post, marked as the team\'s and signed with the operator\'s name. `parentId` replies to a comment (a reply to a reply joins its thread). Markdown up to 4,000 characters with no raw HTML, images or headings and at most six links. Fails when comments are off for the blog or closed on the post, on a page, on a post that is not live yet, or when the same text was just posted. Returns `{ comment, commentCount }`. Confirm the wording with the user first.',
    params: {
      ref: { type: 'string', required: true, description: 'The post\'s slug or id, from list_blog_posts.' },
      project: { ...projectId, in: 'query' },
      body: { type: 'string', required: true, description: 'The comment, as Markdown.' },
      parentId: { type: 'string', description: 'The id of the comment to reply to, from list_blog_comments.' }
    }
  },
  // ---- pages: entries ----------------------------------------------------------------
  {
    name: 'list_cms_entries', title: 'List pages', readOnly: true, method: 'GET', path: '/v1/admin/cms/entries',
    description: 'Every entry (landing page or other content) of the project\'s Pages, drafts included, newest edit first, without their content (read one with get_cms_entry). Each has `id`, `name`, `slug`, `type`, `status` (draft or published), `version`, `changed` (true when the working copy differs from what visitors get) and `path` (where a page is hosted).',
    params: {
      project: projectId,
      type: { type: 'string', description: 'Only entries of this type: the key of a root component, e.g. page. See list_cms_components.' }
    }
  },
  {
    name: 'get_cms_entry', title: 'Get a page', readOnly: true, method: 'GET', path: '/v1/admin/cms/entries/{id}',
    description: 'One entry\'s working copy (the draft, which may differ from what visitors see): its `content` (a tree of blocks `{ _uid, component, ...fields }`, children in `blocks` fields) and `style`, plus its status, version, `changed` and `path`.',
    params: { id: id('entry') }
  },
  {
    name: 'create_cms_entry', title: 'Create a page', method: 'POST', path: '/v1/admin/cms/entries',
    description: 'Creates a DRAFT entry (nothing is public until publish_cms_entry). Start it from a `template` (list_cms_templates), from your own `content` block tree, or leave both out for an empty one. The slug is made from the name unless you send one; the project\'s first entry is `home`. The content is checked against the components: values are fitted to their field types and blocks a field does not allow are dropped, each listed in `issues`. Returns `{ entry, issues }`. Up to 1,000 entries; content up to 512 KB.',
    params: {
      project: projectId,
      name: { type: 'string', description: 'The entry\'s name, up to 80 characters. Default: the template\'s title, else the component\'s name.' },
      slug: { type: 'string', description: 'Lowercase words and dashes, with / between folders (blog/hello-world); home is the site\'s root. Must be free: 409 otherwise.' },
      type: { type: 'string', description: 'The key of a root component (default page). See list_cms_components.' },
      template: { type: 'string', description: 'Start a page from this template id (saas, app, waitlist, devtool, design-tool or blank), with the project\'s name in its copy. Pages only.' },
      content: { type: 'object', description: 'The whole block tree: { component, ...fields } with child blocks in `blocks` fields; `_uid`s are added. Overrides the template\'s content.' },
      style: { type: 'object', description: 'Look of the page: accent (#rrggbb, empty for the project\'s), mode (light, dark or auto), radius (sharp, soft or round), headingFont and bodyFont (Google Fonts family names, empty for the system font), width (narrow, normal or wide).' }
    }
  },
  {
    name: 'update_cms_entry', title: 'Edit a page', method: 'PATCH', path: '/v1/admin/cms/entries/{id}',
    description: 'Edits an entry\'s working copy; only the keys you send change. `content` is the WHOLE block tree and REPLACES the old one, so read it with get_cms_entry first and send it all back with your change. `style` merges key by key. Visitors keep the published version until publish_cms_entry, except that changing the slug of a published page moves it at once. Returns `{ entry, issues }` (what checking the content had to fix). An entry keeps its type.',
    params: {
      id: id('entry'),
      name: { type: 'string', description: 'The entry\'s name, 1 to 80 characters.' },
      slug: { type: 'string', description: 'Lowercase words and dashes, with / between folders. Must be free: 409 otherwise.' },
      content: { type: 'object', description: 'The whole block tree, replacing the old: { component, ...fields } with child blocks in `blocks` fields. Up to 512 KB.' },
      style: { type: 'object', description: 'Merged key by key: accent (#rrggbb, empty for the project\'s), mode (light, dark or auto), radius (sharp, soft or round), headingFont and bodyFont (Google Fonts family names, empty for the system font), width (narrow, normal or wide).' }
    }
  },
  {
    name: 'delete_cms_entry', title: 'Delete a page', destructive: true, method: 'DELETE', path: '/v1/admin/cms/entries/{id}',
    description: 'Permanently removes the entry, draft and published copy: its page answers 404 from then on and the delivery API stops listing it. Confirm with the user first.',
    params: { id: id('entry') }
  },
  {
    name: 'publish_cms_entry', title: 'Publish a page', method: 'POST', path: '/v1/admin/cms/entries/{id}/publish',
    description: 'Freezes the working copy into the next version: the hosted page and the delivery API serve it to the PUBLIC from now on, and the cms.entry.published webhook is sent (so a static site can rebuild). Returns `{ entry }`. Confirm with the user first.',
    params: { id: id('entry') }
  },
  {
    name: 'unpublish_cms_entry', title: 'Take a page offline', method: 'POST', path: '/v1/admin/cms/entries/{id}/unpublish',
    description: 'The page answers 404 and the delivery API stops serving it; the working copy stays and can be published again. Sends the cms.entry.unpublished webhook. Returns `{ entry }`.',
    params: { id: id('entry') }
  },
  // ---- pages: components -------------------------------------------------------------
  {
    name: 'list_cms_components', title: 'List page components', readOnly: true, method: 'GET', path: '/v1/admin/cms/components',
    description: 'Every component the project\'s pages can use: the built-ins first (`builtin: true`, read-only, ids starting with hb_) then the project\'s own. Each has its `key` (what a block\'s `component` names), `fields` (the schema), `root` (an entry type) or `nestable` (goes inside a `blocks` field), and its `html` and `css` template. The reply can be long.',
    params: { project: projectId }
  },
  {
    name: 'get_cms_component', title: 'Get a page component', readOnly: true, method: 'GET', path: '/v1/admin/cms/components/{id}',
    description: 'One of the project\'s own components with its fields, html and css. Built-ins are only in list_cms_components.',
    params: { id: id('component') }
  },
  {
    name: 'create_cms_component', title: 'Create a page component', method: 'POST', path: '/v1/admin/cms/components',
    description: 'A component is a schema (`fields`) and, optionally, an HTML and CSS template that hosted pages render; leave `html` empty for a data-only component the developer\'s own app renders. In the template `{{@field}}` prints a field (see the Pages guide in the docs). Templates are HTML and CSS only: scripts, on... handlers and javascript: links are refused, and the HTML must start with one wrapping element. Up to 200 components per project. Returns `{ component }`.',
    params: {
      project: projectId,
      key: { type: 'string', required: true, description: '1 to 40 lowercase letters, digits, _ and -, starting with a letter. Unique in the project and not a built-in\'s.' },
      name: { type: 'string', required: true, description: 'Up to 80 characters.' },
      description: { type: 'string', description: 'What it is for, up to 500 characters.' },
      root: { type: 'boolean', description: 'true makes it an entry type (entries are made of it), like page.' },
      nestable: { type: 'boolean', description: 'true lets it go inside another component\'s `blocks` field. Default: true unless root.' },
      fields: { type: 'array', items: { type: 'object' }, description: 'Up to 40 fields: { key (letters, digits, _), label, type, default, required, options, allow, description }. type is text, textarea, markdown, number, boolean, color, url, date, select (needs `options`), icon, asset or blocks (`allow`: the component keys it takes; empty takes any nestable one).' },
      html: { type: 'string', description: 'The template, up to 100 KB: one wrapping element with {{@field}} slots.' },
      css: { type: 'string', description: 'Styles for the template, up to 100 KB.' }
    }
  },
  {
    name: 'update_cms_component', title: 'Edit a page component', method: 'PATCH', path: '/v1/admin/cms/components/{id}',
    description: 'Edits one of the project\'s own components; only the keys you send change, but `fields` is the whole list and REPLACES the old one (read it with get_cms_component first). Published pages render with the current components, so this changes live pages at once: confirm with the user first when pages use it. Entries keep their values when a field is renamed or removed (they stop rendering until a field takes the key again), and blocks of a component whose `key` changes render as nothing until it changes back. Returns `{ component }`.',
    params: {
      id: id('component'),
      key: { type: 'string', description: 'A new key: 1 to 40 lowercase letters, digits, _ and -. Unique in the project.' },
      name: { type: 'string', description: 'Up to 80 characters.' },
      description: { type: 'string', description: 'What it is for, up to 500 characters; empty clears it.' },
      root: { type: 'boolean', description: 'Whether it is an entry type.' },
      nestable: { type: 'boolean', description: 'Whether it goes inside another component\'s `blocks` field.' },
      fields: { type: 'array', items: { type: 'object' }, description: 'The WHOLE field list, replacing the old: { key, label, type, default, required, options, allow, description }, up to 40.' },
      html: { type: 'string', description: 'The template, up to 100 KB; empty makes it data-only.' },
      css: { type: 'string', description: 'Styles for the template, up to 100 KB; empty clears them.' }
    }
  },
  {
    name: 'delete_cms_component', title: 'Delete a page component', destructive: true, method: 'DELETE', path: '/v1/admin/cms/components/{id}',
    description: 'Permanently removes one of the project\'s own components. Entries keep the blocks that used it, with their values, but they render as nothing (on live pages too) until a component with the same key exists again. Confirm with the user first.',
    params: { id: id('component') }
  },
  // ---- pages: files, settings, templates, repos, wizard -------------------------------
  {
    name: 'list_cms_assets', title: 'List page files', readOnly: true, method: 'GET', path: '/v1/admin/cms/assets',
    description: 'The files (images, video, PDFs) uploaded for the project\'s pages, newest first: `{ assets }`, each `{ id, name, alt, url, mime, size, width, height }`. Put `{ id, url, alt }` in an asset field of a block. Uploading is not offered here: use the panel.',
    params: { project: projectId }
  },
  {
    name: 'update_cms_asset', title: 'Rename a page file', method: 'PATCH', path: '/v1/admin/cms/assets/{id}',
    description: 'Changes a file\'s `name` and/or its `alt` text. Blocks keep the alt text they were saved with; set the file again in the block to take the new one. Returns `{ asset }`.',
    params: {
      id: id('file'),
      name: { type: 'string', description: 'The new name, up to 120 characters. It cannot be empty.' },
      alt: { type: 'string', description: 'Alt text for screen readers, up to 300 characters. An empty string clears it.' }
    }
  },
  {
    name: 'delete_cms_asset', title: 'Delete a page file', destructive: true, method: 'DELETE', path: '/v1/admin/cms/assets/{id}',
    description: 'Permanently removes the file from storage and frees its space. Pages that use it keep its address and show it broken from then on. Confirm with the user first.',
    params: { id: id('file') }
  },
  {
    name: 'get_cms_settings', title: 'Get the Pages settings', readOnly: true, method: 'GET', path: '/v1/admin/cms/settings',
    description: 'The project\'s Pages settings: `previewUrl` (the developer\'s own site that the editor frames; {slug} stands for the entry\'s slug) and `brief`, the messaging brief the Pages assistant reads (audience, problem, valueProposition, pillars, proof, tone, callToAction).',
    params: { project: projectId }
  },
  {
    name: 'update_cms_settings', title: 'Change the Pages settings', method: 'PATCH', path: '/v1/admin/cms/settings',
    description: 'Changes `previewUrl` and/or the messaging `brief`. Only the keys you send change, and `brief` merges key by key. Returns `{ settings }`.',
    params: {
      project: projectId,
      previewUrl: { type: 'string', description: 'An http(s) URL of the developer\'s own site, up to 500 characters; {slug} becomes the entry\'s slug. An empty string clears it.' },
      brief: { type: 'object', description: 'Any of: audience, problem, valueProposition, proof (each up to 2,000 characters), tone, callToAction (up to 300), and pillars (a list of up to 6 messages, up to 300 characters each; it REPLACES the old list). An empty string clears a text key.' }
    }
  },
  {
    name: 'list_cms_templates', title: 'List page templates', readOnly: true, method: 'GET', path: '/v1/admin/cms/templates',
    description: 'The templates a new page can start from, for create_cms_entry\'s `template`: each has `id`, `name`, `description`, `style` and its full block `content` (with {project} standing for the project\'s name). The reply is long.',
    params: {}
  },
  {
    name: 'list_cms_repos', title: 'List the repos the assistants can read', readOnly: true, method: 'GET', path: '/v1/admin/cms/repos',
    description: 'The full names (owner/name) of the project\'s linked GitHub repositories that the Pages assistant, the page wizard and the blog AI may read: `{ repos }`. Empty when no repo is linked.',
    params: { project: projectId }
  },
  {
    name: 'suggest_cms_wizard_answers', title: 'Suggest page wizard answers from GitHub', method: 'POST', path: '/v1/admin/cms/wizard/suggest',
    description: 'Reads the project\'s linked GitHub repos (read-only, three at most) and asks the AI for answers to the page wizard\'s text questions (product, oneLiner, audience, problem, features, proof, links), using only facts the repos show. Saves nothing: show the answers to the user, then use them as the messaging brief with update_cms_settings or as copy in create_cms_entry. Returns `{ answers }`. Fails when the project has no linked repos (400) or no AI provider is set up (501).',
    params: {
      project: projectId,
      repos: { type: 'array', items: { type: 'string' }, description: 'Repos to read, as owner/name (from list_cms_repos). All linked repos (three at most) when left out.' }
    }
  },
  // ---- brand kit ---------------------------------------------------------------------
  {
    name: 'get_brand_kit', title: 'Get a project\'s brand kit', readOnly: true, method: 'GET', path: '/v1/admin/brand',
    description: 'The brand kit: tagline, about, colours, fonts, guidelines and the public brand page\'s settings (`page`), and every file in it, private ones included (`assets`, each with `id`, `kind`, `name`, `description`, `url`, `mime`, `size`, `background`, `public`, `order`). `url` is the public page\'s path, which answers only while `brand.page.public` is on.',
    params: { project: { ...projectId, in: 'query' } }
  },
  {
    name: 'update_brand_kit', title: 'Edit a project\'s brand kit', method: 'PATCH', path: '/v1/admin/brand',
    description: 'Edits the kit; only the keys you send change. `colors`, `fonts` and `guidelines` are FULL lists and REPLACE the old ones, so read the kit with get_brand_kit first and send them all back with your change. `page` merges key by key. Turning `page.public` on puts the public brand page online, and editing the kit while it is on changes that page at once: confirm with the user first. Returns `{ brand }`.',
    params: {
      project: { ...projectId, in: 'query' },
      tagline: { type: 'string', description: 'Up to 160 characters. An empty string clears it.' },
      about: { type: 'string', description: 'Up to 2,000 characters. An empty string clears it.' },
      colors: { type: 'array', items: { type: 'object' }, description: 'The WHOLE colour list (up to 24): { name (up to 60 characters), hex (#rrggbb), usage (up to 200 characters) }. The first colour is the default accent.' },
      fonts: { type: 'array', items: { type: 'object' }, description: 'The WHOLE font list (up to 6): { name, role (display, body, mono or other), cssUrl (a https://fonts.googleapis.com/css2 link the page loads), downloadUrl (an http(s) URL), weights (text such as "400, 600"), sample (sample text) }.' },
      guidelines: { type: 'array', items: { type: 'object' }, description: 'The WHOLE guideline list (up to 20): { id (keep the existing one to keep a guideline), title (up to 120 characters), body (Markdown, up to 8,000 characters) }.' },
      page: { type: 'object', description: 'The public page, merged key by key: public (true turns the page on), template (minimal, editorial or split), theme (auto, light or dark), radius (sharp, soft or round), accent (#rrggbb; empty uses the first colour), headline (up to 120 characters), intro (up to 600), sections (the shown sections in order, from colors, typography, logos, screenshots, assets, guidelines; REPLACES the old list) and style ({ source: project or custom, custom }).' }
    }
  },
  {
    name: 'update_brand_asset', title: 'Edit a brand kit file', method: 'PATCH', path: '/v1/admin/brand/assets/{id}',
    description: 'Edits a file of the brand kit (ids from get_brand_kit); only the keys you send change. Changing the first logo or icon also updates the logo the project wears across its pages. Returns `{ asset }`. Uploading a new file is not offered here: use the panel.',
    params: {
      id: id('brand kit file'),
      name: { type: 'string', description: 'Up to 120 characters. It cannot be empty.' },
      description: { type: 'string', description: 'Up to 300 characters. An empty string clears it.' },
      kind: { type: 'string', enum: ['logo', 'icon', 'favicon', 'screenshot', 'social', 'other'], description: 'What the file is; it decides the page section it shows in.' },
      background: { type: 'string', enum: ['light', 'dark', 'any'], description: 'What a logo is drawn to sit on, so its tile matches. A dark one is used on dark pages.' },
      public: { type: 'boolean', description: 'false keeps the file off the public brand page.' },
      order: { type: 'integer', description: 'Files sort by this, lowest first. A whole number, 0 or more.' }
    }
  },
  {
    name: 'delete_brand_asset', title: 'Delete a brand kit file', destructive: true, method: 'DELETE', path: '/v1/admin/brand/assets/{id}',
    description: 'Permanently removes the file from storage and frees its space. A project logo or onboarding image that pointed at its address stops loading. Confirm with the user first.',
    params: { id: id('brand kit file') }
  },

  // ======== project settings ========
  // ---- project settings (PATCH /v1/admin/projects/{id}; replaces the older update_project_settings) ----------
  {
    name: 'update_project_settings', title: 'Change a project\'s settings', destructive: true, method: 'PATCH', path: '/v1/admin/projects/{id}',
    description: 'Changes what the panel\'s Settings pages edit: the basics (name, site, sender, access), the feedback board, changelog, blog, legal pages, newsletter, chat widget, public hub, company profile and the project style. ' +
      'Only the arguments you pass change, and inside a section object only the keys you send change. Lists marked REPLACES (allowedOrigins, notifyEmails, guestSurfaces, hiddenSections and the lists inside sections) are swapped whole, so read the current values from list_projects first and send the full list with your change. ' +
      'A bad value is a 400 that names it and nothing is saved; a few values are cleaned silently instead (said on the argument). The Planning board has its own tool, update_board_settings, and feature flags have update_project_flags. ' +
      'Returns the updated project. Needs the admin role. Some settings go live or reach people (turning on a public page or the hub, emailing changelog subscribers, which sites may embed the chat): confirm with the user first.',
    params: {
      id: { ...id('project'), description: 'The project\'s id, from list_projects.' },
      name: { type: 'string', description: 'The project\'s name, up to 80 characters. An empty value is ignored: a name cannot be cleared.' },
      slug: { type: 'string', description: 'The project\'s short name for URLs: lowercased, anything but letters and digits becomes a dash, cut to 40 characters. An empty value is ignored.' },
      siteUrl: { type: 'string', description: 'The address of the project\'s own site or app (http or https), used to build links in emails and the {siteUrl} part of the changelog and blog link templates. A trailing slash is removed. An empty string clears it; a value that is not an http(s) URL is silently saved as empty.' },
      allowedOrigins: { type: 'array', items: { type: 'string' }, description: 'REPLACES the sites (browser origins) allowed to use the project\'s embeds, forms and checkout return links, e.g. https://app.example.com. Each entry is cut down to its origin (no path); entries that are not URLs are dropped silently, duplicates removed, at most 20. An empty list clears it. Removing an origin can break the embed on that site.' },
      inboxPath: { type: 'string', description: 'Where the chat lives on the project\'s own site, as a path such as /support: the "you have a reply" email to a customer of an in-app chat links to siteUrl plus this path. Up to 200 characters; an empty string clears it.' },
      fromName: { type: 'string', description: 'The sender name on the project\'s emails; it also signs the team\'s chat replies. Up to 80 characters; an empty string falls back to the project name.' },
      fromEmail: { type: 'string', description: 'The address the project\'s emails are sent from, up to 200 characters. It should be on mailDomain so SPF and DKIM line up. A value that is not an email address is a 400; an empty string uses the server\'s default sender.' },
      replyTo: { type: 'string', description: 'The reply-to address on the project\'s emails, up to 200 characters. A value that is not an email address is a 400; an empty string means none.' },
      mailDomain: { type: 'string', description: 'The sending domain, such as mail.example.com; it must belong to the mail account the server uses. Lowercased; a value that is not a domain is a 400; an empty string uses the server\'s default domain.' },
      emailLogContent: { type: 'boolean', description: 'Keep a copy of every sent email\'s HTML and text in the email log (default off). The copies can include one-time sign-in codes, so only turn it on when the user wants it.' },
      notifyEmails: { type: 'array', items: { type: 'string' }, description: 'REPLACES the addresses emailed when a customer writes in the chat (also the fallback recipients of error alerts). Up to 5; `Name <a@b.com>` is reduced to the address; entries that are not email addresses are dropped silently. An empty list clears it.' },
      allowAttachments: { type: 'boolean', description: 'Whether customers may attach images and files in the chat.' },
      allowAnonymousUsers: { type: 'boolean', description: 'Let people use chat and feedback with only an email address, with no sign-in from the host app. After a few actions they must confirm the address with a code we email them.' },
      guestSurfaces: { type: 'array', items: { type: 'string' }, description: 'REPLACES the surfaces open to guests (visitors with no account and no email): any of chat, feedback, comments. An empty list turns guest access off and ends every guest session. Unknown names are dropped silently.' },
      letUsersChooseType: { type: 'boolean', description: 'Offer a request-type picker when a customer starts a chat. It only takes effect once the project has more than one ticket type.' },
      allowOtherType: { type: 'boolean', description: 'Add an "Other" choice to that picker; it creates a plain support ticket.' },
      hiddenSections: { type: 'array', items: { type: 'string' }, description: 'REPLACES the sections left out of the project\'s sidebar and command list (their pages and API keep working). Allowed: conversations, knowledge, assistants, types, feedback, board, changelog, onboarding, contacts, forms, email, revenue, pricing, pages, blog, legal, brand, errors, flags, dev. `overview` and `settings` cannot be hidden; any other name is a 400. An empty list shows every section.' },
      chatNotice: { type: 'string', description: 'A fixed line shown centered at the top of every new chat, up to 500 characters. An empty string hides it.' },
      feedback: { type: 'object', description: 'The public feedback board. Partial: only the keys you send change. ' +
        'Booleans: enabled, showAuthorNames (show authors\' names to everyone), allowComments, allowUserEdits (authors edit their own posts), emailNotifications, roadmap (offer the roadmap view), changelog (offer the changelog view). ' +
        'Text: title (up to 120 characters), description (up to 500), postUrlTemplate (an http(s) address where a post lives on your site, with {id}, {number} and {slug} filled in; up to 300; an empty string clears it). ' +
        'style: { source, custom }, as in `widget.style`. ' +
        'Lists, each REPLACING the old one (at most 40 entries, unique keys; a key is lowercased, anything but a-z, 0-9, - and _ becomes a dash, up to 40 characters): ' +
        'statuses [{ key, label (up to 60), category (required: open, planned, active, done or closed), color (neutral, primary, info, success, warning or error), isDefault (at most one; the first is the default when none is), notify (email the author when a post moves there) }] with at least one; ' +
        'types [{ key, label, icon (an Iconify name such as lucide:bug, or an emoji), description (up to 200) }]; platforms [{ key, label }]; tags [{ key, label, color }]. ' +
        'The category is what a status means: open, planned and active show by default, planned, active and done make the roadmap, done and closed stop voting. A post whose status you remove reads as open.' },
      changelog: { type: 'object', description: 'The public changelog. Partial: only the keys you send change. ' +
        'Booleans: enabled (serve it without a feedback board), autoDraft (a post or board item reaching done drafts an entry, never publishes it), comments (signed-in readers may comment), notify (EMAILS subscribers when entries publish, plus a weekly digest). ' +
        'commitAi: { onPush (draft entries from new GitHub commits), autoPublish (publish what it drafts with no review) }. ' +
        'Text: siteName (up to 80 characters, the product name in email subjects), imageWidth (full, medium or small), pageUrl (your changelog page: http(s) or starting {siteUrl}, up to 300, cannot be empty), entryUrl (where an entry lives: http(s) or starting {siteUrl}, must contain {slug}, up to 300), confirmUrl and unsubscribeUrl (your own confirmation and unsubscribe pages: must contain {token}, up to 300; an empty string uses the hosted pages). ' +
        'digest: { timezone (IANA name such as Europe/Madrid), weeklyHour (0 to 23), quietMinutes (1 to 1440), maxWaitMinutes (1 to 1440, not below quietMinutes) }, each key optional. ' +
        'copy: email wording overrides merged into the existing ones, keys instantSubjectMany, weeklySubject, instantIntroOne, instantIntroMany, weeklyIntroOne, weeklyIntroMany, footerInstant, footerWeekly, confirmInstant, confirmWeekly, each 1 to 300 characters (an empty override is rejected). ' +
        'style: { source, custom }, as in `widget.style`. ' +
        'Lists, each REPLACING the old one: commentNotify (up to 5 email addresses told about comments), areas (the areas an entry may name: up to 30 keys of lowercase letters, digits and hyphens, up to 40 characters; empty allows any), reservedSlugs (slugs your own site already uses: up to 50, up to 60 characters).' },
      style: { type: 'object', description: 'The project\'s own style, worn by every public page and embed unless a feature sets its own. Partial: only the keys you send change, and `light` and `dark` merge colour by colour. ' +
        'Keys: scheme (an empty string follows the visitor, or auto, light, dark); light and dark, each an object with accent, background, surface, text, muted, border (a #rrggbb colour, or an empty string to clear it); radius (corner radius in pixels, a whole number 0 to 32; null or an empty string clears it); shadow (an empty string, none, soft, medium or strong); font (an empty string, system, serif or mono); logoUrl, logoDarkUrl, iconUrl (http(s) addresses). ' +
        'An empty string clears a value, and whatever stays empty comes from the Brand kit and the defaults.' },
      widget: { type: 'object', description: 'The chat widget\'s settings. Partial. One key today: style { source: "project" | "custom", custom: a style object shaped like the `style` argument }. With `project` the widget wears the project style; with `custom` the keys in `custom` lie over it, and whatever `custom` leaves empty still comes from the project style.' },
      blog: { type: 'object', description: 'The hosted blog. Partial: only the keys you send change. ' +
        'Booleans (anything else is a 400): enabled (the hosted blog, public API and RSS answer), comments, reactions, subscribeForm (a sign-up form under each post). ' +
        'Text: title (up to 120 characters), description (up to 300), postUrl (where a post lives on your site: http(s) or starting {siteUrl}, must contain {slug}, up to 300; an empty string uses the hosted page), newsletterTopic (a topic key of lowercase letters, digits and hyphens, up to 40, or an empty string for every subscriber). ' +
        'commentNotify: REPLACES the addresses told about comments (up to 10 email addresses). ' +
        'design (partial too): { layout (list, grid or magazine), font (sans or serif), colorScheme (auto, light or dark), accent (#rrggbb or an empty string for the project accent), logoUrl, coverImageUrl (http(s) or an empty string), footer (up to 300 characters), navigation (REPLACES the header links: up to 8 of { label up to 40 characters, url as an http(s) address or a blog path such as /about }), social (merged per network, keys x, bluesky, mastodon, github, linkedin, instagram, youtube, website, each an http(s) address; an empty string removes that network) }. ' +
        'style: { source, custom }, as in `widget.style`.' },
      legal: { type: 'object', description: 'The hosted legal pages\' look and the operator\'s identity. Partial: only the keys you send change. ' +
        'entity: { name (up to 120 characters), address (up to 300), email (a valid address, up to 200), dpo (up to 200) }; it is written to the company profile too, so prefer the `company` argument. ' +
        'Look: accent (#rrggbb or an empty string for the project look), font (system, serif or mono), logoUrl (an http(s) address or an empty string), footerText (up to 300 characters), style { source, custom }, as in `widget.style`.' },
      marketing: { type: 'object', description: 'Newsletter settings. Partial: only the keys you send change. ' +
        'doubleOptIn (boolean: sign-ups stay pending until they click the confirmation email), postalAddress (up to 300 characters; every marketing email must carry one; it is written to the company profile\'s address too), confirmRedirectUrl (an http(s) address, up to 500, where sign-up and confirmation links send people; an empty string clears it), fromName (up to 80), fromEmail (a valid address, lowercased; it must be on mailDomain when both are set), mailDomain (a domain such as news.example.com; an empty string clears it). ' +
        'topics REPLACES the newsletter topics (at most 20): [{ key (lowercase a-z, 0-9, - and _, starting with a letter or digit, up to 40, unique), name (up to 80), description (up to 200) }].' },
      company: { type: 'object', description: 'The company profile: who is behind the product, used by the legal documents and the campaign footers. Partial: { name (the everyday name, up to 120 characters), legalName (the registered name, up to 120; empty means name), address (postal address, up to 300), email (public contact address, up to 200), phone (up to 40; digits, spaces and + ( ) - . / only), website (an http(s) address of the company\'s own site, up to 300), dpo (the data protection contact, up to 200) }. An empty string clears a field. It is mirrored into legal.entity and marketing.postalAddress.' },
      hub: { type: 'object', description: 'The public hub page (/hub/<publicKey>) and the chat widget\'s Home tab. Partial: only the keys you send change. ' +
        'enabled (boolean: turns the page on; off it answers 404), title (up to 80 characters; empty uses the project name), tagline (up to 200; empty uses the Brand kit\'s). ' +
        'sections REPLACES the list and its order: any of about, changelog, roadmap, feedback, blog, legal, brand, contact (one with nothing public to show is left out). ' +
        'links REPLACES the extra links: up to 8 of { label (1 to 60 characters), url (an http(s) address, up to 500) }. ' +
        'widgetHome: { enabled (show a Home tab in the chat widget), sections (REPLACES: any of changelog, feedback, onboarding) }. ' +
        'style: { source, custom }, as in `widget.style`.' }
    }
  },
  // ---- the Planning board's settings (same route) -------------------------------------------------------------
  {
    name: 'update_board_settings', title: 'Change a project\'s Planning board settings', destructive: true, method: 'PATCH', path: '/v1/admin/projects/{id}',
    description: 'Changes the Planning board\'s settings: turning it on, its statuses and labels, the public roadmap\'s layout, and whether linked feedback follows item status. ' +
      'Partial: only the keys you send inside `board` change, but `statuses` and `labels` REPLACE their whole lists, so read the current ones from list_projects (the project\'s `board` field) and send every one you want to keep. ' +
      'Removing a status or a label does not touch the items that use it, and nothing checks or moves them: an item keeps the old status key, the panel shows it in the default status\'s column, it counts as category open and it stays off the public roadmap until it is moved to a status that exists (move items first with update_board_item when you remove or rename a key; to rename only what people read, keep the key and change `label`). An item keeps a removed label\'s key too. ' +
      'Returns the updated project. Needs the admin role. A bad value is a 400 that names it and nothing is saved. Confirm with the user first.',
    params: {
      id: { ...id('project'), description: 'The project\'s id, from list_projects.' },
      board: { type: 'object', required: true, description: 'The board settings to change. Keys: ' +
        'enabled (boolean: turns Planning on; the public roadmap keeps listing feedback posts until at least one item is public in a planned, active or done status); ' +
        'syncFeedback (boolean, off by default: when an item moves to a status of another category, every feedback post linked to it moves to the feedback board\'s first status of that category, and the post\'s followers get the usual status emails); ' +
        'roadmap: { layout (columns, timeline or list), showLabels (send each item\'s labels to the public roadmap), showDates (send target dates; the timeline layout always does) }, merged key by key; ' +
        'statuses REPLACES the list: [{ key, label, category, color, isDefault }], at least one and at most 40, keys unique. A key is lowercased, anything but a-z, 0-9, - and _ becomes a dash, up to 40 characters; label up to 60 (the key when empty); category is required: open, planned, active, done or closed, and is what the status means (only planned, active and done statuses, and their names, reach the public roadmap; moving an item into done marks it completed); color is neutral, primary, info, success, warning or error (default follows the category); isDefault is true on at most one status, where new items start (the first when none is marked); ' +
        'labels REPLACES the list: [{ key, label, color }], at most 40, keys as above, label up to 60, color as above (default neutral). An empty labels list removes every label.' }
    }
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
  for (const [name, { required, in: _in, as: _as, ...schema }] of Object.entries(tool.params)) properties[name] = schema
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
      if (param.default !== undefined) query.set(param.as || name, String(param.default))
      else if (param.required) return { error: `Missing required argument "${name}".` }
      continue
    }
    const problem = checkValue(param, value)
    if (problem) return { error: `Argument "${name}" ${problem}.` }
    const where = paramLocation(tool, name)
    if (where === 'path') path = path.replace(`{${name}}`, encodeURIComponent(String(value)))
    else if (where === 'query') query.set(param.as || name, Array.isArray(value) ? value.join(',') : String(value))
    else body[param.as || name] = value
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
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? '' : 'must be a number'
    case 'boolean': return typeof value === 'boolean' ? '' : 'must be true or false'
    case 'array':
      if (param.items?.type === 'object') return Array.isArray(value) && value.every(item => item && typeof item === 'object' && !Array.isArray(item)) ? '' : 'must be a list of objects'
      return Array.isArray(value) && value.every(item => typeof item === 'string') ? '' : 'must be a list of strings'
    default: return value && typeof value === 'object' && !Array.isArray(value) ? '' : 'must be an object'
  }
}
