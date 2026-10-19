// End-to-end smoke test against a running stack (API on BASE, default the dev
// server). Creates a project as an agent, mints an identity token with its
// secret exactly the way a host app would, starts a conversation as the end
// user, replies as the agent, checks unread counts, read receipts, idempotent
// retries, unsend, and that the end user's SSE stream saw the reply; then the
// feedback board, the project board and its public roadmap, the changelog, and email.
//
//   bun scripts/smoke.mjs                      # needs an agent: AGENT_USER / AGENT_PASS

import { createHmac } from 'node:crypto'

const BASE = (process.env.BASE || 'http://localhost:3100').replace(/\/+$/, '')
const AGENT_USER = process.env.AGENT_USER || ''
const AGENT_PASS = process.env.AGENT_PASS || ''
if (!AGENT_USER || !AGENT_PASS) {
  console.error('Set AGENT_USER and AGENT_PASS to an operator account on the stack under test.')
  process.exit(2)
}

function mint(secret, claims, ttl = 3600) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ iat: now, exp: now + ttl, ...claims })
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`
}

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.statusMessage || json.message || ''}`)
  return json
}

function assert(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`)
  console.log(`ok  ${label}`)
}

// --- agent ---
const login = await api('/v1/admin/login', { method: 'POST', body: { username: AGENT_USER, password: AGENT_PASS } })
const agentToken = login.sessionToken
assert(agentToken.startsWith('r:'), 'agent login returns a Parse session')

const created = await api('/v1/admin/projects', { token: agentToken, method: 'POST', body: { name: `Smoke ${Date.now()}`, siteUrl: 'https://example.test', inboxPath: '/app', fromName: 'Elías', allowedOrigins: ['https://example.test'] } })
const project = created.project
assert(project.publicKey.startsWith('pk_') && created.secret.startsWith('sk_'), 'project created with keys')

const pub = await api(`/v1/projects/${project.publicKey}/public`)
assert(pub.name === project.name && pub.allowedOrigins[0] === 'https://example.test', 'public project config')

// --- end user ---
const userToken = mint(created.secret, { iss: project.publicKey, sub: 'host-user-42', name: 'Ada', email: 'ada@example.test' })
const bad = await fetch(`${BASE}/v1/conversations`, { headers: { Authorization: `Bearer ${mint('sk_wrong', { iss: project.publicKey, sub: 'x' })}` } })
assert(bad.status === 401, 'wrong secret is rejected')
// No Accept header: still a JSON error body, not Nuxt's HTML page.
assert(bad.headers.get('content-type')?.includes('application/json') && (await bad.json()).statusCode === 401, 'a /v1 error is JSON without an Accept header')

const before = await api('/v1/conversations', { token: userToken })
assert(before.conversations.length === 0 && before.unreadCount === 0, 'fresh user has no conversations')

// SSE: subscribe before writing so the reply is observed.
const events = []
const controller = new AbortController()
const sse = fetch(`${BASE}/v1/events`, { headers: { Authorization: `Bearer ${userToken}` }, signal: controller.signal }).then(async (res) => {
  if (!res.ok) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const data = chunk.split('\n').find(l => l.startsWith('data:'))
      if (data) { try { events.push(JSON.parse(data.slice(5))) } catch {} }
    }
  }
}).catch(() => {})
await new Promise(r => setTimeout(r, 300))

const started = await api('/v1/conversations', { token: userToken, method: 'POST', body: { subject: 'Broken import', body: 'Hi, my import hangs.', clientId: 'c_1', context: { type: 'bookmark', id: 'b1', label: 'Some site', url: 'https://example.test/b1' } } })
const conv = started.conversation
assert(conv.status === 'open' && conv.unreadByAgent === 1 && started.message.sender === 'user', 'user started a conversation')
assert(conv.context?.label === 'Some site', 'context stored on the conversation')

const retry = await api('/v1/conversations', { token: userToken, method: 'POST', body: { body: 'Hi, my import hangs.', clientId: 'c_1' } })
assert(retry.created === true, 'a new conversation with a reused clientId is a new conversation (clientId is per conversation)')
const dup = await api(`/v1/conversations/${conv.id}/messages`, { token: userToken, method: 'POST', body: { body: 'again', clientId: 'c_2' } })
const dup2 = await api(`/v1/conversations/${conv.id}/messages`, { token: userToken, method: 'POST', body: { body: 'again', clientId: 'c_2' } })
assert(dup.created && !dup2.created && dup.message.id === dup2.message.id, 'retry with the same clientId is idempotent')

// --- agent side ---
const inbox = await api('/v1/admin/conversations?unread=true', { token: agentToken })
const mine = inbox.conversations.find(c => c.id === conv.id)
assert(mine && mine.unreadByAgent === 2 && inbox.endUsers[mine.endUserId]?.name === 'Ada', 'agent inbox lists the conversation with the end user')

await api(`/v1/admin/conversations/${conv.id}/read`, { token: agentToken, method: 'POST' })
const reply = await api(`/v1/admin/conversations/${conv.id}/messages`, { token: agentToken, method: 'POST', body: { body: 'Looking into it!', replyToId: started.message.id, notifyByEmail: false } })
assert(reply.message.sender === 'agent' && reply.message.senderName === 'Elías' && reply.message.replyToId === started.message.id, 'agent reply is signed and threaded')
assert(reply.conversation.unreadByAgent === 0 && reply.conversation.unreadByUser === 1, 'counters after reply')

const unread = await api('/v1/unread', { token: userToken })
assert(unread.unreadCount === 1, 'user badge shows 1')
await api(`/v1/conversations/${conv.id}/read`, { token: userToken, method: 'POST' })
assert((await api('/v1/unread', { token: userToken })).unreadCount === 0, 'user badge clears after read')

await api(`/v1/admin/conversations/${conv.id}/status`, { token: agentToken, method: 'POST', body: { status: 'done' } })
const reopen = await api(`/v1/conversations/${conv.id}/messages`, { token: userToken, method: 'POST', body: { body: 'still broken' } })
assert(reopen.conversation.status === 'open', 'a user message reopens a done conversation')

const list = await api(`/v1/conversations/${conv.id}/messages`, { token: userToken })
assert(list.messages.length === 4 && list.messages[0].id === started.message.id, 'messages are oldest first')

await api(`/v1/messages/${reopen.message.id}`, { token: userToken, method: 'DELETE' })
const afterDelete = await api(`/v1/conversations/${conv.id}/messages`, { token: userToken })
assert(afterDelete.messages.length === 3 && afterDelete.conversation.lastMessagePreview === 'Looking into it!', 'unsend recomputes the summary')

const forbidden = await fetch(`${BASE}/v1/messages/${reply.message.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${userToken}` } })
assert(forbidden.status === 404, 'user cannot unsend an agent message')

const newChat = await api('/v1/admin/conversations', { token: agentToken, method: 'POST', body: { projectId: project.id, externalId: 'never-seen-99', name: 'Grace', body: 'Hello Grace', notifyByEmail: false } })
assert(newChat.endUser.externalId === 'never-seen-99' && newChat.message.sender === 'agent', 'agent can start a chat with an unseen host user')

await new Promise(r => setTimeout(r, 500))
controller.abort()
await sse
const sawReply = events.some(e => e.type === 'message.created' && e.message?.id === reply.message.id)
if (process.env.SKIP_SSE) console.log('skip SSE check')
else assert(sawReply, `end user SSE stream received the agent reply (${events.length} events seen)`)

// --- feedback board ---
const noBoard = await fetch(`${BASE}/v1/feedback?pk=${project.publicKey}`)
assert(noBoard.status === 404, 'a project has no feedback board until it is enabled')
const enabled = await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { feedback: { enabled: true, platforms: [{ key: 'web', label: 'Web' }, { key: 'app', label: 'App' }], postUrlTemplate: 'https://example.test/feedback?post={id}' }, changelog: { enabled: true } } })
assert(enabled.project.feedback.enabled && enabled.project.feedback.statuses.length === 5, 'board enabled with default statuses')
const badConfig = await fetch(`${BASE}/v1/admin/projects/${project.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback: { statuses: [{ key: 'x', category: 'nope' }] } }) })
assert(badConfig.status === 400, 'an invalid status category is rejected')

const fbEvents = []
const fbController = new AbortController()
const fbStream = fetch(`${BASE}/v1/feedback/events?pk=${project.publicKey}`, { signal: fbController.signal }).then(async (res) => {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const data = buffer.slice(0, idx).split('\n').find(l => l.startsWith('data:'))
      buffer = buffer.slice(idx + 2)
      if (data) { try { fbEvents.push(JSON.parse(data.slice(5))) } catch {} }
    }
  }
}).catch(() => {})
await new Promise(r => setTimeout(r, 300))

const config = await api(`/v1/feedback/config?pk=${project.publicKey}`)
assert(config.config.types.some(t => t.key === 'feature') && config.viewer.signedIn === false, 'public board config')

const grace = mint(created.secret, { iss: project.publicKey, sub: 'host-user-7', name: 'Grace', email: 'grace@example.test' })
const staff = mint(created.secret, { iss: project.publicKey, sub: 'host-staff-1', name: 'Elías', role: 'admin' })

const anonPost = await fetch(`${BASE}/v1/feedback?pk=${project.publicKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })
assert(anonPost.status === 401, 'anonymous visitors cannot post')
const badType = await fetch(`${BASE}/v1/feedback`, { method: 'POST', headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x', type: 'nope' }) })
assert(badType.status === 400, 'an unknown type is rejected')

const { post } = await api('/v1/feedback', { token: userToken, method: 'POST', body: { title: 'Export as CSV', body: 'Please **add** CSV.', type: 'feature', platform: 'web', status: 'done', featured: true } })
assert(post.voteCount === 1 && post.hasVoted && post.isMine && post.canEdit, 'a new post starts with its author’s vote')
assert(post.status === 'open' && post.featured === false, 'admin-only fields are ignored for users')

const anonList = await api(`/v1/feedback?pk=${project.publicKey}`)
assert(anonList.total === 1 && anonList.posts[0].author?.name === '' && anonList.posts[0].hasVoted === false, 'anonymous list hides author names')

const voted = await api(`/v1/feedback/${post.id}/vote`, { token: grace, method: 'POST', body: { voted: true } })
const again = await api(`/v1/feedback/${post.id}/vote`, { token: grace, method: 'POST', body: { voted: true } })
assert(voted.post.voteCount === 2 && again.post.voteCount === 2 && again.voted, 'setting a vote twice counts once')
const toggled = await api(`/v1/feedback/${post.id}/vote`, { token: grace, method: 'POST' })
assert(!toggled.voted && toggled.post.voteCount === 1, 'an empty vote body toggles')
await api(`/v1/feedback/${post.id}/vote`, { token: grace, method: 'POST', body: { voted: true } })

const notMine = await fetch(`${BASE}/v1/feedback/${post.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${grace}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'hijack' }) })
assert(notMine.status === 403, 'users cannot edit other people’s posts')
const edited = await api(`/v1/feedback/${post.id}`, { token: userToken, method: 'PATCH', body: { title: 'Export bookmarks as CSV' } })
assert(edited.post.title === 'Export bookmarks as CSV', 'authors can edit their own post')

const c1 = await api(`/v1/feedback/${post.id}/comments`, { token: grace, method: 'POST', body: { body: 'Yes please' } })
const c2 = await api(`/v1/feedback/${post.id}/comments`, { token: staff, method: 'POST', body: { body: 'On it' } })
assert(c1.post.commentCount === 1 && c2.comment.author.isTeam && c2.comment.author.name === 'Elías', 'admin tokens comment as the team')
const cannot = await fetch(`${BASE}/v1/feedback/${post.id}/comments/${c1.comment.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${userToken}` } })
assert(cannot.status === 403, 'users cannot delete other people’s comments')

const moved = await api(`/v1/feedback/${post.id}`, { token: staff, method: 'PATCH', body: { status: 'done', showOnChangelog: true, changelogTitle: 'CSV export' } })
assert(moved.post.statusCategory === 'done' && moved.post.completedAt, 'admin moves a post to done and it is stamped')
const closedVote = await fetch(`${BASE}/v1/feedback/${post.id}/vote`, { method: 'POST', headers: { Authorization: `Bearer ${grace}`, 'Content-Type': 'application/json' }, body: '{}' })
assert(closedVote.status === 409, 'voting closes on done posts')

const changelog = await api(`/v1/feedback?pk=${project.publicKey}&view=changelog`)
assert(changelog.posts.length === 1 && changelog.posts[0].changelogTitle === 'CSV export', 'changelog view')
assert((await fetch(`${BASE}/v1/projects/${project.publicKey}/changelog.rss`)).status === 200, 'changelog RSS answers')

const { post: secret } = await api('/v1/feedback', { token: grace, method: 'POST', body: { title: 'Spam spam' } })
await api(`/v1/feedback/${secret.id}`, { token: agentToken, method: 'PATCH', body: { hidden: true } })
const hiddenForAuthor = await fetch(`${BASE}/v1/feedback/${secret.id}`, { headers: { Authorization: `Bearer ${grace}` } })
assert(hiddenForAuthor.status === 404, 'hidden posts are invisible, even to their author')
const adminList = await api(`/v1/feedback?project=${project.id}&includeHidden=1`, { token: agentToken })
assert(adminList.total === 2 && adminList.posts.some(p => p.hidden && p.author.email === 'grace@example.test'), 'operators see hidden posts and author emails')

const imported = await api('/v1/feedback/import', { token: created.secret, method: 'POST', body: { posts: [{ externalId: 'legacy:1', title: 'Old idea', type: 'improvement', status: 'planned', createdAt: '2024-01-02T00:00:00.000Z', author: { externalId: 'old-user', name: 'Old', email: 'old@example.test' }, votes: ['a', 'b', 'c', 'a'], comments: [{ externalId: 'lc1', body: '<p>Agreed</p>', author: { externalId: 'a' }, createdAt: '2024-01-03T00:00:00.000Z' }] }] } })
const reimported = await api('/v1/feedback/import', { token: created.secret, method: 'POST', body: { posts: [{ externalId: 'legacy:1', title: 'Old idea', type: 'improvement', status: 'planned', votes: ['a', 'b'], comments: [{ externalId: 'lc1', body: '<p>Agreed!</p>', author: { externalId: 'a' } }] }] } })
const legacy = await api(`/v1/feedback/legacy:1?pk=${project.publicKey}`)
assert(imported.results[0].created && !reimported.results[0].created && legacy.post.voteCount === 2 && legacy.comments.length === 1 && legacy.comments[0].body === '<p>Agreed!</p>', 'import upserts by externalId and syncs votes and comments')
assert(legacy.post.createdAt.startsWith('2024-01-02'), 'import keeps the original date')

const erased = await api('/v1/end-users/host-user-7', { token: created.secret, method: 'DELETE' })
const afterErase = await api(`/v1/feedback/${post.id}?pk=${project.publicKey}`)
assert(erased.erased.posts === 1 && erased.erased.votes === 1 && afterErase.post.voteCount === 1 && afterErase.comments.length === 1, 'erasing a user removes their posts, votes and comments')

const removed = await api(`/v1/feedback/${post.id}`, { token: userToken, method: 'DELETE' })
assert(removed.deleted, 'authors can delete their own post')

await new Promise(r => setTimeout(r, 500))
fbController.abort()
await fbStream
assert(fbEvents.some(e => e.type === 'feedback.post.created' && e.postId === post.id) && fbEvents.some(e => e.type === 'feedback.comment.created') && !fbEvents.some(e => e.post?.title === 'Spam spam' && e.type !== 'feedback.post.created'), `public feedback stream saw the board change (${fbEvents.length} events)`)
assert(fbEvents.some(e => e.type === 'feedback.post.deleted' && e.postId === secret.id), 'hiding a post reads as a delete on the public stream')

// --- project board & public roadmap ---
const noRoadmap = await fetch(`${BASE}/v1/feedback/roadmap?pk=${project.publicKey}`)
assert(noRoadmap.status === 404, 'no public roadmap until the project board is on')
const boardOn = await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { board: { enabled: true, labels: [{ key: 'theme', label: 'Theme', color: 'info' }] } } })
assert(boardOn.project.board.enabled && boardOn.project.board.statuses.length === 5 && !boardOn.project.board.syncFeedback, 'board enabled with default statuses, sync off')
assert(!('board' in await api(`/v1/projects/${project.publicKey}/public`)), 'the public project config never carries the board')
assert((await api(`/v1/feedback/config?pk=${project.publicKey}`)).roadmapSource === 'board', 'the feedback config says the board drives the roadmap')

const lin = mint(created.secret, { iss: project.publicKey, sub: 'host-user-9', name: 'Lin' })
const { post: idea } = await api('/v1/feedback', { token: lin, method: 'POST', body: { title: 'Dark mode' } })
await api(`/v1/feedback/${idea.id}/vote`, { token: userToken, method: 'POST', body: { voted: true } })
const { item } = await api(`/v1/admin/board-items?project=${project.id}`, { token: agentToken, method: 'POST', body: { title: 'Dark theme', description: 'SECRET internal plan', publicDescription: 'A dark theme for the whole app', labels: ['theme'], priority: 'high', feedbackPostIds: [`#${idea.number}`], conversationIds: [conv.id] } })
assert(item.number === 1 && !item.public && item.status === 'backlog' && item.voteCount === 2 && item.posts[0]?.id === idea.id && item.conversations[0]?.id === conv.id, 'an item links a post (by #N) and a conversation on creation')

let roadmap = await api(`/v1/feedback/roadmap?pk=${project.publicKey}`)
assert(roadmap.items.length === 0 && roadmap.statuses.every(s => ['planned', 'active', 'done'].includes(s.category)), 'a private item stays off the roadmap, and only roadmap statuses go out')
await api(`/v1/admin/board-items/${item.id}`, { token: agentToken, method: 'PATCH', body: { public: true } })
roadmap = await api(`/v1/feedback/roadmap?pk=${project.publicKey}`)
assert(roadmap.items.length === 0, 'a public item in the backlog stays off the roadmap')
await api(`/v1/admin/board-items/${item.id}`, { token: agentToken, method: 'PATCH', body: { status: 'planned' } })
roadmap = await api(`/v1/feedback/roadmap?pk=${project.publicKey}`)
const shown = roadmap.items[0]
assert(roadmap.items.length === 1 && shown?.voteCount === 2 && shown.description === 'A dark theme for the whole app' && shown.posts[0].id === idea.id, 'a public, planned item shows with its posts’ votes')
const rawRoadmap = JSON.stringify(roadmap)
assert(!rawRoadmap.includes('SECRET') && !rawRoadmap.includes(conv.id) && ['number', 'priority', 'assigneeId', 'rank', 'conversationIds', 'feedbackPostIds', 'labels', 'targetDate'].every(key => !(key in shown)) && !('labels' in roadmap), 'the roadmap carries no internal fields (and no labels until they are turned on)')
assert((await api('/v1/feedback/roadmap', { token: userToken })).items[0].posts[0].hasVoted === true, 'signed-in viewers see their own votes on the roadmap')

const { post: idea2 } = await api('/v1/feedback', { token: lin, method: 'POST', body: { title: 'An even darker mode' } })
await api(`/v1/admin/board-items/${item.id}/links`, { token: agentToken, method: 'POST', body: { kind: 'feedback', id: idea2.id } })
assert((await api(`/v1/feedback/roadmap?pk=${project.publicKey}`)).items[0].voteCount === 3, 'linking another post adds its votes')
await api(`/v1/feedback/${idea2.id}`, { token: agentToken, method: 'PATCH', body: { hidden: true } })
roadmap = await api(`/v1/feedback/roadmap?pk=${project.publicKey}`)
assert(roadmap.items[0].voteCount === 2 && roadmap.items[0].posts.length === 1, 'hiding a linked post drops it and its votes from the roadmap')

const agentTimeline = await api(`/v1/admin/conversations/${conv.id}/messages`, { token: agentToken })
assert(agentTimeline.messages.some(m => m.kind === 'event' && m.event?.type === 'board.linked' && m.event.itemId === item.id), 'the conversation’s timeline notes the board link')
assert(!(await api(`/v1/conversations/${conv.id}/messages`, { token: userToken })).messages.some(m => m.event?.type === 'board.linked'), 'customers never see board events')

const other = await api('/v1/admin/projects', { token: agentToken, method: 'POST', body: { name: `Smoke other ${Date.now()}`, siteUrl: 'https://other.test' } })
await api(`/v1/admin/projects/${other.project.id}`, { token: agentToken, method: 'PATCH', body: { feedback: { enabled: true } } })
const { post: foreign } = await api(`/v1/feedback?project=${other.project.id}`, { token: agentToken, method: 'POST', body: { title: 'Somewhere else' } })
const foreignChat = await api('/v1/admin/conversations', { token: agentToken, method: 'POST', body: { projectId: other.project.id, externalId: 'other-1', name: 'Mo', body: 'Hi', notifyByEmail: false } })
const linkTo = (kind, id) => fetch(`${BASE}/v1/admin/board-items/${item.id}/links`, { method: 'POST', headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id }) })
assert((await linkTo('feedback', foreign.id)).status === 404 && (await linkTo('conversation', foreignChat.conversation.id)).status === 404, 'posts and conversations from another project cannot be linked')

await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { board: { syncFeedback: true } } })
const shipped = await api(`/v1/admin/board-items/${item.id}`, { token: agentToken, method: 'PATCH', body: { status: 'done' } })
assert(shipped.item.statusCategory === 'done' && shipped.item.completedAt, 'moving an item to done stamps it')
assert((await api(`/v1/feedback/${idea.id}?pk=${project.publicKey}`)).post.statusCategory === 'done', 'with sync on, linked posts follow the item to done')

const { item: second } = await api(`/v1/admin/board-items?project=${project.id}`, { token: agentToken, method: 'POST', body: { title: 'Keyboard shortcuts', status: 'planned' } })
await api(`/v1/admin/board-items/${second.id}`, { token: agentToken, method: 'PATCH', body: { status: 'in-progress', rank: 0.5 } })
const board = await api(`/v1/admin/board-items?project=${project.id}`, { token: agentToken })
const reread = board.items.find(i => i.id === second.id)
assert(second.number === 2 && reread.status === 'in-progress' && reread.rank === 0.5 && board.items[0].id === second.id, 'rank and status PATCHes persist, and items list in rank order')
const byConversation = await api(`/v1/admin/board-items?project=${project.id}&conversation=${conv.id}`, { token: agentToken })
assert(byConversation.items.length === 1 && byConversation.items[0].id === item.id, 'items filter by linked conversation')
const unlinked = await api(`/v1/admin/board-items/${item.id}/links`, { token: agentToken, method: 'POST', body: { kind: 'conversation', id: conv.id, linked: false } })
assert(unlinked.item.conversationIds.length === 0, 'unlinking a conversation removes it')

const standalone = await fetch(`${BASE}/roadmap/${project.publicKey}?layout=timeline&theme=dark`, { redirect: 'manual' })
const location = standalone.headers.get('location') || ''
assert(standalone.status === 302 && location.includes(`pk=${project.publicKey}`) && location.includes('only=roadmap') && location.includes('layout=timeline') && location.includes('theme=dark'), 'the standalone roadmap URL opens the roadmap-only embed')
assert((await api(`/v1/admin/board-items/${second.id}`, { token: agentToken, method: 'DELETE' })).deleted, 'items can be deleted')

// --- changelog ---
const emptyChangelog = await api(`/v1/changelog?pk=${project.publicKey}`)
assert(emptyChangelog.releases.length === 0 && emptyChangelog.entries.length === 0, 'the public changelog starts empty')
const { release } = await api(`/v1/admin/changelog/releases?project=${project.id}`, { token: agentToken, method: 'POST', body: { version: '2.4', title: 'Autumn' } })
assert(release.status === 'draft' && !release.publishedAt, 'a release starts as a draft')
const { entry } = await api(`/v1/admin/changelog/entries?project=${project.id}`, { token: agentToken, method: 'POST', body: { title: 'Dark mode', body: 'The whole app has a **dark** theme.', tag: 'new', status: 'published', releaseId: release.id, feedbackPostIds: [`#${idea.number}`], boardItemIds: [`#${item.number}`], conversationIds: [conv.id] } })
assert(entry.number === 1 && entry.status === 'published' && entry.publishedAt && entry.releaseId === release.id && entry.sources.length === 3, 'an entry links a post, a board item and a conversation on creation')
const sourceKinds = entry.sources.map(s => s.kind).sort().join()
assert(sourceKinds === 'board,conversation,feedback' && entry.sources.find(s => s.kind === 'feedback').done && entry.sources.find(s => s.kind === 'board').done, 'its sources come back resolved, with whether each is done')
const hidden = await api(`/v1/changelog?pk=${project.publicKey}`)
assert(hidden.releases.length === 0 && hidden.entries.length === 0, 'a published entry in a draft release is not public')
assert(!(await (await fetch(`${BASE}/v1/projects/${project.publicKey}/changelog.rss`)).text()).includes('<title>Dark mode</title>'), 'nor is it in the RSS feed')

await api(`/v1/admin/changelog/releases/${release.id}/publish`, { token: agentToken, method: 'POST' })
const live = await api(`/v1/changelog?pk=${project.publicKey}`)
assert(live.releases.length === 1 && live.releases[0].version === '2.4' && live.releases[0].entries[0].title === 'Dark mode' && live.releases[0].entries[0].tag === 'new', 'publishing the release makes its entries public')
const rawLive = JSON.stringify(live)
assert(![idea.id, item.id, conv.id, 'sources', 'conversationIds', 'feedbackPostIds', 'boardItemIds'].some(leak => rawLive.includes(leak)), 'the public changelog says nothing about where an entry came from')
const feed = await (await fetch(`${BASE}/v1/projects/${project.publicKey}/changelog.rss`)).text()
assert(feed.includes('<title>Dark mode</title>') && feed.includes('<category>2.4</category>') && feed.includes(`/changelog/${project.publicKey}#entry-1`), 'the RSS feed lists the entry under its release')

const linkedTimeline = await api(`/v1/admin/conversations/${conv.id}/messages`, { token: agentToken })
assert(linkedTimeline.messages.some(m => m.kind === 'event' && m.event?.type === 'changelog.linked' && m.event.entryId === entry.id), 'the conversation’s timeline notes the changelog link')
assert(!(await api(`/v1/conversations/${conv.id}/messages`, { token: userToken })).messages.some(m => m.event?.type === 'changelog.linked'), 'customers never see changelog events')
const byPost = await api(`/v1/admin/changelog/entries?project=${project.id}&feedbackPost=${idea.id}`, { token: agentToken })
assert(byPost.entries.length === 1 && byPost.entries[0].id === entry.id, 'entries filter by linked post')

const { entry: loose } = await api(`/v1/admin/changelog/entries?project=${project.id}`, { token: agentToken, method: 'POST', body: { title: 'Keyboard shortcuts' } })
assert(loose.status === 'draft' && loose.number === 2 && !loose.publishedAt, 'a new entry is a draft with the next number')
assert((await api(`/v1/changelog?pk=${project.publicKey}`)).entries.length === 0, 'a draft is not public')
await api(`/v1/admin/changelog/entries/${loose.id}`, { token: agentToken, method: 'PATCH', body: { status: 'published' } })
const afterLoose = await api(`/v1/changelog?pk=${project.publicKey}`)
assert(afterLoose.entries.length === 1 && afterLoose.entries[0].title === 'Keyboard shortcuts', 'a published entry of no release is public on its own')
await api(`/v1/admin/changelog/entries/${loose.id}`, { token: agentToken, method: 'PATCH', body: { status: 'draft' } })
assert((await api(`/v1/changelog?pk=${project.publicKey}`)).entries.length === 0, 'unpublishing takes it back out')

const { entry: foreignEntry } = await api(`/v1/admin/changelog/entries?project=${other.project.id}`, { token: agentToken, method: 'POST', body: { title: 'Elsewhere' } })
const linkEntryTo = (id, kind, target) => fetch(`${BASE}/v1/admin/changelog/entries/${id}/links`, { method: 'POST', headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id: target }) })
assert((await linkEntryTo(entry.id, 'feedback', foreign.id)).status === 404 && (await linkEntryTo(entry.id, 'conversation', foreignChat.conversation.id)).status === 404 && (await linkEntryTo(foreignEntry.id, 'board', item.id)).status === 404, 'sources from another project cannot be linked')
const unlinkedEntry = await api(`/v1/admin/changelog/entries/${entry.id}/links`, { token: agentToken, method: 'POST', body: { kind: 'conversation', id: conv.id, linked: false } })
assert(unlinkedEntry.entry.conversationIds.length === 0 && unlinkedEntry.entry.sources.length === 2, 'unlinking a source removes it')

const { release: spare } = await api(`/v1/admin/changelog/releases?project=${project.id}`, { token: agentToken, method: 'POST', body: { version: '2.5' } })
await api(`/v1/admin/changelog/entries/${loose.id}`, { token: agentToken, method: 'PATCH', body: { releaseId: spare.id } })
await api(`/v1/admin/changelog/releases/${spare.id}`, { token: agentToken, method: 'DELETE' })
assert((await api(`/v1/admin/changelog/entries?project=${project.id}&release=none`, { token: agentToken })).entries.some(e => e.id === loose.id && !e.releaseId), 'deleting a release leaves its entries, with no release')

// Auto-draft is off until asked for: the post and item that shipped above drafted nothing (the one entry linking the post is the one we wrote).
assert(byPost.entries.length === 1, 'nothing drafts itself while auto-draft is off')
const draftsOn = await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { changelog: { autoDraft: true } } })
assert(draftsOn.project.changelog.autoDraft === true, 'auto-draft can be turned on')
const { post: shipping } = await api('/v1/feedback', { token: lin, method: 'POST', body: { title: 'Offline mode', type: 'feature' } })
await api(`/v1/feedback/${shipping.id}`, { token: staff, method: 'PATCH', body: { status: 'done' } })
const drafted = await api(`/v1/admin/changelog/entries?project=${project.id}&feedbackPost=${shipping.id}`, { token: agentToken })
assert(drafted.entries.length === 1 && drafted.entries[0].status === 'draft' && drafted.entries[0].title === 'Offline mode' && drafted.entries[0].tag === 'new', 'a post reaching done drafts an entry, never a published one')
await api(`/v1/feedback/${shipping.id}`, { token: staff, method: 'PATCH', body: { status: 'planned' } })
await api(`/v1/feedback/${shipping.id}`, { token: staff, method: 'PATCH', body: { status: 'done' } })
assert((await api(`/v1/admin/changelog/entries?project=${project.id}&feedbackPost=${shipping.id}`, { token: agentToken })).entries.length === 1, 'shipping it a second time drafts nothing more')
assert(!JSON.stringify(await api(`/v1/changelog?pk=${project.publicKey}`)).includes('Offline mode'), 'and the draft is not public')

const { post: viaItem } = await api('/v1/feedback', { token: lin, method: 'POST', body: { title: 'Pinned tabs' } })
const { item: tabs } = await api(`/v1/admin/board-items?project=${project.id}`, { token: agentToken, method: 'POST', body: { title: 'Tabs', publicDescription: 'Pin your tabs', feedbackPostIds: [viaItem.id] } })
await api(`/v1/admin/board-items/${tabs.id}`, { token: agentToken, method: 'PATCH', body: { status: 'done' } })
const viaPost = await api(`/v1/admin/changelog/entries?project=${project.id}&feedbackPost=${viaItem.id}`, { token: agentToken })
assert(viaPost.entries.length === 1 && viaPost.entries[0].boardItemIds.includes(tabs.id) && viaPost.entries[0].body === 'Pin your tabs', 'a board item reaching done drafts one entry for itself and its posts, not one per post')
assert((await api(`/v1/feedback/${viaItem.id}?pk=${project.publicKey}`)).post.statusCategory === 'done', 'and the sync still moves the post')
await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { changelog: { autoDraft: false } } })

// Publishing a release tells its posts which version shipped them.
const { release: shippedRelease } = await api(`/v1/admin/changelog/releases?project=${project.id}`, { token: agentToken, method: 'POST', body: { version: '3.0' } })
await api(`/v1/admin/changelog/entries/${viaPost.entries[0].id}`, { token: agentToken, method: 'PATCH', body: { releaseId: shippedRelease.id } })
await api(`/v1/admin/changelog/releases/${shippedRelease.id}/publish`, { token: agentToken, method: 'POST' })
assert((await api(`/v1/feedback/${viaItem.id}?pk=${project.publicKey}`)).post.shippedIn === '3.0' && (await api(`/v1/changelog?pk=${project.publicKey}`)).releases[0].entries[0].title === 'Tabs', 'publishing a release stamps its posts’ shippedIn, and publishes its drafts')

const standaloneChangelog = await fetch(`${BASE}/changelog/${project.publicKey}?theme=dark`, { redirect: 'manual' })
const changelogLocation = standaloneChangelog.headers.get('location') || ''
assert(standaloneChangelog.status === 302 && changelogLocation.includes(`pk=${project.publicKey}`) && changelogLocation.includes('/embed/changelog') && changelogLocation.includes('theme=dark'), 'the standalone changelog URL opens the changelog embed')
assert((await api(`/v1/admin/changelog/entries/${loose.id}`, { token: agentToken, method: 'DELETE' })).deleted, 'entries can be deleted')

// --- changelog for a host's own site: slugs, sanitised bodies, who may write, review, import, merge ---
const secretKey = created.secret
const asSecret = (path, init = {}) => api(path, { ...init, token: secretKey })
const rawWith = (path, token, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers }, body: init.body ? JSON.stringify(init.body) : undefined })
const sha = digit => (Date.now().toString(16) + digit).padStart(40, '0')

const written = await api('/v1/admin/changelog/entries', { token: staff, method: 'POST', body: { title: 'Slug Probe!', summary: 'Short', body: 'Hello <script>alert(1)</script> **bold**', area: 'editor', status: 'published', releaseVersion: '2026.10', pinned: true, accentColor: '#3366ff', links: [{ label: 'Docs', url: 'https://example.test/docs' }] } })
assert(written.entry.slug === 'slug-probe' && written.entry.version === '2026.10' && written.entry.source === 'admin' && written.entry.authorName === 'Elías' && written.entry.pinned, 'an admin token writes an entry: slug from the title, its release found or created by version, authored by them')
assert(written.entry.bodyHtml.includes('<strong>bold</strong>') && !written.entry.bodyHtml.includes('script') && written.entry.excerpt.startsWith('Hello'), 'its body is rendered and sanitised once, on write')
assert((await rawWith('/v1/admin/changelog/entries', userToken, { method: 'POST', body: { title: 'x' } })).status === 403, 'a signed-in user without the admin role cannot write')
assert((await rawWith('/v1/admin/changelog/entries', null, { method: 'POST', body: { title: 'x' } })).status === 401, 'nor can an anonymous caller')
assert((await rawWith(`/v1/admin/changelog/entries?project=${other.project.id}`, secretKey, { method: 'POST', body: { title: 'x' } })).status === 404, 'the project secret only reaches its own project')
const byRobot = await asSecret('/v1/admin/changelog/entries', { method: 'POST', body: { title: 'Slug Probe!', status: 'published' } })
assert(byRobot.entry.slug === 'slug-probe-2' && byRobot.entry.source === 'internal' && byRobot.entry.authorName === 'automated', 'the project secret writes too, as the automated caller; a taken slug gets a suffix')
assert((await rawWith('/v1/admin/changelog/entries', staff, { method: 'POST', body: { title: 'Subscribe', status: 'published' } }).then(r => r.json())).entry.slug === 'subscribe-2', 'a slug a route of the API owns is skipped')

const publicOne = await api(`/v1/changelog/slug-probe?pk=${project.publicKey}`)
assert(publicOne.entry.bodyHtml === written.entry.bodyHtml && publicOne.entry.version === '2026.10' && publicOne.entry.links[0].label === 'Docs', 'an entry is read by its slug')
assert(!/commitShas|externalId|reviewStatus|"source"|feedbackPostIds|sources/.test(JSON.stringify(publicOne)), 'and says nothing internal')
assert((await api(`/v1/changelog/${written.entry.number}?pk=${project.publicKey}`)).entry.id === written.entry.id, 'also by its number')
const flat = await api(`/v1/changelog?pk=${project.publicKey}&flat=1&limit=2`)
assert(flat.entries.length === 2 && flat.total >= 3 && flat.hasMore === true && flat.entries.every(e => typeof e.version === 'string'), 'the flat list pages and counts')
const flatVersion = await api(`/v1/changelog?pk=${project.publicKey}&version=2026.10`)
assert(flatVersion.entries.length === 1 && flatVersion.entries[0].slug === 'slug-probe' && flatVersion.total === 1, 'and filters by release version')
assert((await api(`/v1/changelog?pk=${project.publicKey}&tag=breaking`)).total === 0, 'and by tag')
assert((await rawWith(`/v1/changelog?pk=${project.publicKey}&tag=huge`, null)).status === 400, 'a bad filter is a 400')

// Review: drafts wait, approving publishes, rejecting keeps the draft.
const { entry: draft } = await api('/v1/admin/changelog/entries', { token: staff, method: 'POST', body: { title: 'Review me', body: 'A draft' } })
assert(draft.status === 'draft' && draft.reviewStatus === 'pending', 'a draft waits for review')
assert((await rawWith(`/v1/changelog/${draft.slug}?pk=${project.publicKey}`, null)).status === 404, 'a draft is not public')
assert((await api(`/v1/changelog/${draft.slug}?preview=1`, { token: staff })).entry.reviewStatus === 'pending', 'but a writer can preview it')
const rejected = await api(`/v1/admin/changelog/entries/${draft.id}/review`, { token: staff, method: 'POST', body: { action: 'reject', notes: 'Too vague' } })
assert(rejected.entry.status === 'draft' && rejected.entry.reviewStatus === 'rejected' && rejected.entry.reviewNotes === 'Too vague' && rejected.entry.reviewedBy === 'Elías', 'rejecting keeps it a draft, with the notes and who')
const approved = await api(`/v1/admin/changelog/entries/${draft.slug}/review?project=${project.id}`, { token: agentToken, method: 'POST', body: { action: 'approve' } })
assert(approved.entry.status === 'published' && approved.entry.reviewStatus === 'approved' && approved.entry.publishedAt, 'approving publishes it (by slug, too)')
assert((await rawWith(`/v1/admin/changelog/entries/${draft.id}/review`, staff, { method: 'POST', body: { action: 'approve' } })).status === 400, 'only drafts are reviewed')

// Archive: gone for readers, but it keeps its slug and its commits.
const archivedSha = sha('1')
const { created: [withSha] } = await api('/v1/admin/changelog/entries/batch', { token: staff, method: 'POST', body: { entries: [{ title: 'Has a commit', status: 'published', commitShas: [archivedSha] }] } })
await api(`/v1/admin/changelog/entries/${withSha.id}`, { token: staff, method: 'PATCH', body: { status: 'archived' } })
assert((await rawWith(`/v1/changelog/${withSha.slug}?pk=${project.publicKey}`, null)).status === 404 && !JSON.stringify(await api(`/v1/changelog?pk=${project.publicKey}`)).includes('Has a commit'), 'an archived entry is not public')
assert(!(await api('/v1/admin/changelog/entries', { token: staff })).entries.some(e => e.id === withSha.id) && (await api('/v1/admin/changelog/entries?status=archived', { token: staff })).entries.some(e => e.id === withSha.id), 'and only shows when archived entries are asked for')
const recommit = await api('/v1/admin/changelog/entries/batch', { token: staff, method: 'POST', body: { entries: [{ title: 'Has a commit (again)', commitShas: [archivedSha] }] } })
assert(recommit.created.length === 0 && recommit.skipped[0]?.entryId === withSha.id, 'an archived entry still claims its commit, so it is never written up twice')
assert((await api('/v1/admin/changelog/entries', { token: staff, method: 'POST', body: { title: 'Has a commit', status: 'published' } })).entry.slug === 'has-a-commit-2', 'and its slug')

// Import: by externalId, so running it twice is one entry; never for an admin token.
const importItem = { externalId: 'parse:probe1', title: 'Imported entry', slug: 'imported-entry', body: 'From **elsewhere**', status: 'published', publishedAt: '2025-01-02T10:00:00.000Z', releaseVersion: '2025.01', tag: 'new', area: 'site', reviewStatus: 'approved', reviewedBy: 'Elías', authorName: 'Elías', source: 'internal' }
const imp1 = await asSecret('/v1/admin/changelog/entries/import', { method: 'POST', body: { entries: [importItem, { title: 'No key' }] } })
assert(imp1.results.length === 1 && imp1.results[0].created === true && imp1.results[0].slug === 'imported-entry' && imp1.failed.length === 1 && imp1.failed[0].index === 1, 'an import creates, and reports what could not be imported by index')
const imp2 = await asSecret('/v1/admin/changelog/entries/import', { method: 'POST', body: { entries: [{ ...importItem, title: 'Imported entry (edited)' }] } })
assert(imp2.results[0].created === false && imp2.results[0].id === imp1.results[0].id, 'importing it again updates the same entry')
const importedPublic = (await api(`/v1/changelog/imported-entry?pk=${project.publicKey}`)).entry
assert(importedPublic.publishedAt === '2025-01-02T10:00:00.000Z' && importedPublic.title === 'Imported entry (edited)' && importedPublic.version === '2025.01' && importedPublic.authorName === 'Elías', 'it keeps the date and slug it was given')
const importedAdmin = (await api('/v1/admin/changelog/entries', { token: staff })).entries.find(e => e.id === imp1.results[0].id)
assert(importedAdmin.externalId === 'parse:probe1' && importedAdmin.reviewStatus === 'approved' && importedAdmin.source === 'internal', 'and its review trail and source')
assert((await rawWith('/v1/admin/changelog/entries/import', staff, { method: 'POST', body: { entries: [importItem] } })).status === 403, 'an admin token cannot import')

// Merge: one new entry, the sources archived, their commits kept.
const shaA = sha('a'); const shaB = sha('b')
const { created: [mergeA, mergeB] } = await api('/v1/admin/changelog/entries/batch', { token: staff, method: 'POST', body: { entries: [{ title: 'Merge A', status: 'published', commitShas: [shaA] }, { title: 'Merge B', status: 'published', commitShas: [shaB] }] } })
const merged = await api('/v1/admin/changelog/entries/merge', { token: staff, method: 'POST', body: { refs: [mergeA.slug, `#${mergeB.number}`], entry: { title: 'Merged', body: 'Both', status: 'published' } } })
assert(merged.entry.status === 'published' && merged.entry.commitShas.includes(shaA) && merged.entry.commitShas.includes(shaB) && merged.archived.length === 2, 'a merge creates the merged entry and archives its sources')
assert((await rawWith(`/v1/changelog/${mergeA.slug}?pk=${project.publicKey}`, null)).status === 404 && (await api(`/v1/changelog/${merged.entry.slug}?pk=${project.publicKey}`)).entry.title === 'Merged', 'the sources are gone, the merged entry is public')
assert((await rawWith('/v1/admin/changelog/entries/merge', staff, { method: 'POST', body: { refs: [mergeA.slug, mergeB.slug], entry: { title: 'Again' } } })).status === 400, 'an archived source cannot be merged again')

// The changelog is public on its own, whatever the feedback board does.
await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { feedback: { changelog: false }, changelog: { enabled: true, areas: ['site', 'editor'] } } })
assert((await api(`/v1/changelog?pk=${project.publicKey}&flat=1&limit=1`)).entries.length === 1, 'with changelog.enabled it is public without the board’s Changelog option')
assert((await rawWith('/v1/admin/changelog/entries', staff, { method: 'POST', body: { title: 'Odd area', area: 'billing' } })).status === 400, 'an area outside the project’s list is refused')
await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { changelog: { areas: [] }, feedback: { changelog: true } } })

// --- changelog comments: signed-in readers, moderation, counts, import, erasure ---
const { entry: talk } = await api('/v1/admin/changelog/entries', { token: staff, method: 'POST', body: { title: 'Commentable', status: 'published' } })
const thread = `/v1/changelog/${talk.slug}/comments`
const say = (token, body) => rawWith(thread, token, { method: 'POST', body: { body } })
const threadOf = async (token, query = '') => (await rawWith(`${thread}?${token ? '' : `pk=${project.publicKey}&`}${query}`, token)).json()
assert((await say(userToken, 'Hello there')).status === 403, 'comments are off until the project turns them on')
await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { changelog: { comments: true, commentNotify: ['owner@example.test'] } } })
assert((await rawWith(`${thread}?pk=${project.publicKey}`, null, { method: 'POST', body: { body: 'Hello there' } })).status === 401, 'an anonymous caller cannot comment')
assert((await say(secretKey, 'Hello there')).status === 401, 'nor can the project secret: a comment has an author')
const posted = await (await say(userToken, 'Love **this**')).json()
assert(posted.comment.authorId === 'host-user-42' && posted.comment.authorName === 'Ada' && posted.comment.bodyHtml.includes('<strong>this</strong>') && posted.comment.viewerIsAuthor && posted.commentCount === 1, 'a signed-in user comments: authored by their id, rendered, counted')
assert((await say(userToken, 'Love **this**')).status === 409, 'the same text twice in a row is a double-submit')
assert((await say(userToken, '.')).status === 400, 'a comment needs something to say')
const sneaky = await (await say(userToken, 'x <script>alert(1)</script> <img src=x onerror=alert(1)>')).json()
assert(!sneaky.comment.bodyHtml.includes('<script') && !sneaky.comment.bodyHtml.includes('<img') && sneaky.commentCount === 2, 'raw HTML in a comment is escaped, not parsed')
const asReader = await threadOf(null)
assert(asReader.comments.length === 2 && asReader.total === 2 && asReader.comments.every(c => c.viewerIsAuthor === false && c.status === 'visible') && asReader.comments[0].id === posted.comment.id, 'anyone can read a thread, oldest first')
assert((await threadOf(userToken)).comments.every(c => c.viewerIsAuthor === true), 'a signed-in reader learns which comments are theirs')
assert((await api(`/v1/changelog?pk=${project.publicKey}&flat=1&limit=50`)).entries.find(e => e.slug === talk.slug).commentCount === 2, 'the entry carries its comment count')
assert((await rawWith(`/v1/changelog/comments/${posted.comment.id}`, grace, { method: 'PATCH', body: { body: 'hijacked' } })).status === 403, 'only the author edits a comment')
assert((await rawWith(`/v1/changelog/comments/${posted.comment.id}`, staff, { method: 'PATCH', body: { body: 'rewritten by admin' } })).status === 403, 'not even an admin: moderation hides, it never rewrites')
const editedComment = await api(`/v1/changelog/comments/${posted.comment.id}`, { token: userToken, method: 'PATCH', body: { body: 'Love it' } })
assert(editedComment.comment.body === 'Love it' && editedComment.comment.editedAt, 'an author edits their words, and it shows as edited')
assert((await rawWith(`/v1/changelog/comments/${posted.comment.id}`, userToken, { method: 'PATCH', body: { status: 'hidden' } })).status === 403, 'an author cannot moderate their own comment')
const hid = await api(`/v1/changelog/comments/${posted.comment.id}`, { token: staff, method: 'PATCH', body: { status: 'hidden' } })
assert(hid.comment.status === 'hidden' && hid.commentCount === 1, 'an admin hides it, and the count follows')
assert((await threadOf(null)).comments.length === 1 && (await threadOf(staff)).comments.some(c => c.status === 'hidden'), 'readers no longer see it, the team does')
await api(`/v1/changelog/comments/${posted.comment.id}`, { token: staff, method: 'PATCH', body: { status: 'visible' } })
assert((await threadOf(null)).comments.length === 2, 'unhiding brings it back')
const ofStaff = await (await say(staff, 'Thanks, shipping soon')).json()
assert(ofStaff.comment.authorIsStaff === true, 'a team comment carries the staff mark')
assert((await rawWith(`/v1/changelog/comments/${sneaky.comment.id}`, grace, { method: 'DELETE' })).status === 403, 'only the author or an admin deletes')
const gone = await api(`/v1/changelog/comments/${sneaky.comment.id}`, { token: userToken, method: 'DELETE' })
assert(gone.deleted && gone.commentCount === 2 && !(await threadOf(null)).comments.some(c => c.id === sneaky.comment.id), 'an author deletes theirs; it disappears and the count drops')
await say(userToken, 'one more'); await say(userToken, 'and another')
assert((await say(userToken, 'a flood')).status === 429, 'five comments in ten minutes is the limit')
const { entry: wip } = await api('/v1/admin/changelog/entries', { token: staff, method: 'POST', body: { title: 'Work in progress' } })
assert((await rawWith(`/v1/changelog/${wip.slug}/comments`, grace, { method: 'POST', body: { body: 'Is this ready?' } })).status === 404, 'a draft cannot be commented on')
assert((await rawWith(`/v1/changelog/${wip.slug}/comments`, staff)).status === 200, 'though the team can open its thread')
assert((await rawWith(`/v1/changelog/${talk.slug}/comments?pk=${other.project.publicKey}`, null)).status === 404, 'a thread is only reachable through its own project')

// Importing history: keeps the author and the date, safe to repeat, counts follow.
const historic = { externalId: 'parse:c-old', entry: talk.slug, body: 'From the old site', authorId: 'host-user-7', authorName: 'Grace', authorIsStaff: false, postedAt: '2025-03-04T09:00:00.000Z', status: 'visible' }
const ci1 = await asSecret('/v1/admin/changelog/comments/import', { method: 'POST', body: { comments: [historic, { externalId: 'parse:c-lost', entry: 'no-such-entry', body: 'x' }] } })
assert(ci1.results.length === 1 && ci1.results[0].created === true && ci1.failed.length === 1 && ci1.failed[0].index === 1, 'a comment import creates, and reports what could not land')
const ci2 = await asSecret('/v1/admin/changelog/comments/import', { method: 'POST', body: { comments: [{ ...historic, body: 'From the old site (edited)' }] } })
assert(ci2.results[0].created === false && ci2.results[0].id === ci1.results[0].id, 'importing it again updates the same comment')
const oldest = (await threadOf(null)).comments[0]
assert(oldest.createdAt === '2025-03-04T09:00:00.000Z' && oldest.authorId === 'host-user-7' && oldest.body.endsWith('(edited)') && (await threadOf(grace)).comments[0].viewerIsAuthor === true, 'it keeps its date, sorts first, and is still Grace’s')
assert((await api(`/v1/changelog?pk=${project.publicKey}&flat=1&limit=50`)).entries.find(e => e.slug === talk.slug).commentCount === 5, 'and the entry’s count includes it')
assert((await rawWith('/v1/admin/changelog/comments/import', staff, { method: 'POST', body: { comments: [historic] } })).status === 403, 'an admin token cannot import')

// Erasing a person takes their changelog comments with them.
await asSecret(`/v1/end-users/host-user-7`, { method: 'DELETE' })
assert(!(await threadOf(null)).comments.some(c => c.authorId === 'host-user-7') && (await api(`/v1/changelog?pk=${project.publicKey}&flat=1&limit=50`)).entries.find(e => e.slug === talk.slug).commentCount === 4, 'erasing a user removes their comments and fixes the count')
await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { changelog: { comments: false, commentNotify: [] } } })

// --- changelog notifications: double opt-in, instant and weekly mail, one-click unsubscribe ---
// Needs the server to send mail somewhere harmless: MAIL_STUB is a Mailgun stand-in that keeps what it is sent
// (GET /__log, DELETE /__log), CHANGELOG_LINK_SECRET the same secret the server signs its links with.
const MAIL_STUB = (process.env.MAIL_STUB || '').replace(/\/+$/, '')
const LINK_SECRET = process.env.CHANGELOG_LINK_SECRET || ''
if (!MAIL_STUB || !LINK_SECRET) console.log('skip changelog notifications (set MAIL_STUB and CHANGELOG_LINK_SECRET)')
else {
  const mailLog = async () => (await fetch(`${MAIL_STUB}/__log`)).json()
  const linkToken = (purpose, id, seconds = Math.floor(Date.now() / 1000)) => {
    const payload = `${purpose}:${id}:${seconds}`
    return `${Buffer.from(payload).toString('base64url')}.${createHmac('sha256', LINK_SECRET).update(payload).digest('hex')}`
  }
  // Each run is its own visitor, or the per-IP limit on subscribing (10 an hour) would trip on repeated local runs.
  const visitorIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  const subscribe = (token, body, query = '') => rawWith(`/v1/changelog/subscribe?${token ? '' : `pk=${project.publicKey}&`}${query}`, token, { method: 'POST', body, headers: { 'X-Forwarded-For': visitorIp } })
  const tokenIn = text => decodeURIComponent((text.match(/token=([^"'\s<>&]+)/) || [])[1] || '')
  const notifyRun = (job, extra = {}) => api(`/v1/admin/changelog/notify/run`, { token: secretKey, method: 'POST', body: { job, ...extra } })
  const summary = () => api(`/v1/admin/changelog/subscriptions/summary`, { token: secretKey })

  await fetch(`${MAIL_STUB}/__log`, { method: 'DELETE' })
  const hook = (key, subject, html, vars) => ({ key, folder: 'Smoke', subject, html, variables: vars.map(v => ({ key: v, defaultValue: v })) })
  await api('/v1/admin/emails/import', { token: agentToken, method: 'POST', body: { project: project.id, templates: [
    hook('changelog', '{{subjectLine}}', '<p>Hi {{firstName}},</p><p>{{intro}}</p><div>{{{entriesHtml}}}</div><p>{{footerNote}}</p><a href="{{unsubscribeUrl}}">Unsubscribe</a>', ['subjectLine', 'preheader', 'firstName', 'intro', 'entriesHtml', 'changelogUrl', 'footerNote', 'unsubscribeUrl', 'oneClickUnsubscribeUrl']),
    hook('changelog-confirm', 'Confirm your subscription', '<p>You asked for {{cadence}}.</p><a href="{{confirmUrl}}">Confirm</a>', ['cadence', 'confirmUrl'])
  ] } })

  assert((await subscribe(null, { email: 'reader@example.test', frequency: 'instant' })).status === 404, 'nothing to subscribe to until the project turns notifications on')
  await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { changelog: { notify: true, siteName: 'Smoke', digest: { timezone: 'Europe/Madrid', weeklyHour: 8, quietMinutes: 1, maxWaitMinutes: 5 } } } })
  // Whatever the earlier steps published is old news to nobody yet: drain it so the first mail is about the new entry.
  await notifyRun('instant', { now: new Date(Date.now() + 3600_000).toISOString() })

  // Anonymous: double opt-in.
  const asked = await (await subscribe(null, { email: 'Reader@Example.test', frequency: 'instant' })).json()
  assert(asked.ok === true, 'an anonymous subscribe answers the same whatever the address')
  let mails = await mailLog()
  assert(mails.length === 1 && mails[0].to === 'reader@example.test' && mails[0].subject === 'Confirm your subscription' && mails[0].html.includes('an email whenever something new ships'), 'it sends a confirm mail, and nothing else yet')
  assert((await summary()).pending === 1 && (await summary()).instant === 0, 'and the subscription waits as pending')
  await subscribe(null, { email: 'reader@example.test', frequency: 'instant' })
  assert((await mailLog()).length === 1, 'asking again the same day sends no second mail')
  assert((await subscribe(null, { frequency: 'instant' })).status === 400 && (await subscribe(null, { email: 'reader@example.test', frequency: 'off' })).status === 400, 'an anonymous caller needs an address, and cannot say off')
  const confirmed = await (await rawWith('/v1/changelog/subscribe/confirm', null, { method: 'POST', body: { token: tokenIn(mails[0].html) } })).json()
  assert(confirmed.frequency === 'instant' && (await summary()).instant === 1 && (await summary()).pending === 0, 'the confirm link activates it at the cadence asked for')
  assert((await rawWith('/v1/changelog/subscribe/confirm', null, { method: 'POST', body: { token: linkToken('confirm', 'x', 1) } })).status === 400, 'a stale or foreign confirm link is refused')
  await subscribe(null, { email: 'weekly@example.test', frequency: 'weekly' })
  mails = await mailLog()
  await rawWith('/v1/changelog/subscribe/confirm', null, { method: 'POST', body: { token: tokenIn(mails.at(-1).html) } })
  assert((await summary()).weekly === 1, 'a weekly subscriber, too')

  // Signed in: no confirm needed, the account is the proof.
  const adaOn = await (await subscribe(userToken, { frequency: 'weekly' })).json()
  assert(adaOn.state === 'active' && adaOn.frequency === 'weekly' && (await (await rawWith('/v1/changelog/subscription', userToken)).json()).frequency === 'weekly' && (await summary()).weekly === 2, 'a signed-in user is subscribed at once, and can see it')
  const adaOff = await (await subscribe(userToken, { frequency: 'off' })).json()
  assert(adaOff.state === 'unsubscribed' && (await (await rawWith('/v1/changelog/subscription', userToken)).json()).frequency === null && (await summary()).weekly === 1, 'and turn it off')
  await subscribe(userToken, { frequency: 'weekly' })

  // Instant: once the burst goes quiet.
  await fetch(`${MAIL_STUB}/__log`, { method: 'DELETE' })
  const { entry: shipped } = await api('/v1/admin/changelog/entries', { token: staff, method: 'POST', body: { title: 'Notify <me>', summary: 'Shipped & ready', status: 'published', tag: 'new' } })
  const t0 = Date.now()
  const early = await notifyRun('instant', { dryRun: true, now: new Date(t0 + 10_000).toISOString() })
  assert(early.flushed === false && early.entries >= 1 && (await mailLog()).length === 0, 'a fresh publish waits out the quiet period')
  const dry = await notifyRun('instant', { dryRun: true, now: new Date(t0 + 120_000).toISOString() })
  assert(dry.flushed === true && dry.recipients === 1 && (await mailLog()).length === 0, 'a dry run says what it would do, and does it not')
  const sent = await notifyRun('instant', { now: new Date(t0 + 120_000).toISOString() })
  mails = await mailLog()
  assert(sent.flushed === true && sent.recipients === 1 && mails.length === 1 && mails[0].to === 'reader@example.test', 'once quiet, the instant mail goes to its subscribers only')
  assert(mails[0].subject === 'Notify <me>' && mails[0].html.includes('Notify &lt;me&gt;') && mails[0].html.includes(`https://example.test/changelog/${shipped.slug}`) && mails[0].html.includes('Shipped &amp; ready'), 'about the entry, escaped, linking its page')
  const oneClick = (mails[0].headers['List-Unsubscribe'] || '').replace(/^<|>$/g, '')
  assert(oneClick.includes('/v1/changelog/subscribe/unsubscribe?token=') && mails[0].headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click' && mails[0].html.includes('/changelog/unsubscribe?token='), 'with a one-click header and a page link to unsubscribe')
  assert((await notifyRun('instant', { now: new Date(t0 + 240_000).toISOString() })).flushed === false && (await mailLog()).length === 1, 'and never twice')

  // Weekly: the Monday-to-Monday week, once.
  await asSecret('/v1/admin/changelog/entries/import', { method: 'POST', body: { entries: [{ externalId: 'parse:week1', title: 'Last week', status: 'published', publishedAt: '2026-09-02T10:00:00.000Z', notifiedAt: '2026-09-02T10:30:00.000Z' }] } })
  await fetch(`${MAIL_STUB}/__log`, { method: 'DELETE' })
  const monday = '2026-09-07T08:30:00.000Z'
  const early2 = await notifyRun('weekly', { now: '2026-09-07T05:00:00.000Z' })
  assert(early2.due === false, 'the weekly digest waits for Monday morning')
  const weekDry = await notifyRun('weekly', { dryRun: true, now: monday })
  assert(weekDry.due && weekDry.sent && weekDry.entries === 1 && weekDry.recipients === 2, 'it covers last week’s entries and goes to the weekly subscribers')
  await notifyRun('weekly', { now: monday })
  mails = await mailLog()
  assert(mails.length === 2 && mails.every(m => m.subject.startsWith('This week on Smoke (31 Aug – 6 Sep') && m.html.includes('Last week')) && mails.map(m => m.to).sort().join() === 'ada@example.test,weekly@example.test', 'the digest names the week')
  assert((await notifyRun('weekly', { now: '2026-09-09T12:00:00.000Z' })).sent === false && (await mailLog()).length === 2, 'and goes once, however often the beat runs')

  // Unsubscribe: the one-click POST a mail provider makes, and links sent by the old system.
  const clicked = await rawWith(oneClick.replace(/^https?:\/\/[^/]+/, ''), null, { method: 'POST', body: undefined, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  assert(clicked.status === 200 && (await summary()).instant === 0 && (await summary()).unsubscribed >= 1, 'a one-click unsubscribe works with no page, no script and no JSON')
  assert((await rawWith(`/v1/changelog/subscribe/unsubscribe?token=${encodeURIComponent(oneClick.split('token=')[1])}`, null, { method: 'POST' })).status === 200, 'and again is still a success')
  assert((await rawWith('/v1/changelog/subscribe/unsubscribe?token=garbage', null, { method: 'POST' })).status === 400, 'a garbage link is refused')
  // A token names only a subscription id, so ids from the old system must be unique across projects: one per run here.
  const legacyId = `Legacy${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  await asSecret('/v1/admin/changelog/subscriptions/import', { method: 'POST', body: { subscriptions: [{ externalId: `parse:${legacyId}`, email: 'legacy@example.test', frequency: 'instant', status: 'active', source: 'anonymous', confirmedAt: '2026-08-01T00:00:00.000Z' }, { externalId: 'parse:Gone456', email: 'gone@example.test', frequency: 'weekly', status: 'unsubscribed', unsubscribedAt: '2026-09-01T00:00:00.000Z' }, { email: 'bad' }], runs: [{ kind: 'weekly', windowStart: '2026-09-06T22:00:00.000Z', windowEnd: '2026-09-13T22:00:00.000Z', finishedAt: '2026-09-14T06:00:00.000Z' }] } })
  assert((await summary()).instant === 1 && (await summary()).unsubscribed >= 2, 'subscribers import with their status, the unsubscribed ones as the suppression record')
  assert((await rawWith('/v1/changelog/subscribe/unsubscribe', null, { method: 'POST', body: { token: linkToken('unsub', legacyId) } })).status === 200 && (await summary()).instant === 0, 'a link the old system mailed (it names the old id) still unsubscribes the imported row')
  assert((await notifyRun('weekly', { now: '2026-09-14T10:00:00.000Z' })).sent === false, 'an imported past send stops that week being mailed again')
  assert((await rawWith('/v1/admin/changelog/subscriptions/import', staff, { method: 'POST', body: { subscriptions: [{ externalId: 'x', email: 'x@y.co' }] } })).status === 403, 'an admin token cannot import')
  // Re-importing a stale copy must not undo an unsubscribe.
  const staleCopy = { externalId: `parse:${legacyId}`, email: 'legacy@example.test', frequency: 'instant', status: 'active', source: 'anonymous', confirmedAt: '2026-08-01T00:00:00.000Z' }
  await asSecret('/v1/admin/changelog/subscriptions/import', { method: 'POST', body: { subscriptions: [staleCopy] } })
  assert((await summary()).instant === 0, 'importing a stale copy again does not re-subscribe someone who unsubscribed')
  const before = (await summary()).weekly
  await asSecret('/v1/end-users/host-user-42', { method: 'DELETE' })
  assert((await summary()).weekly === before - 1, 'erasing a user drops their subscription')
  await api(`/v1/admin/projects/${project.id}`, { token: agentToken, method: 'PATCH', body: { changelog: { notify: false } } })
}

// --- email ---
const emailImport = { project: project.id, templates: [{ key: 'smoke-welcome', folder: 'Smoke', subject: 'Hi {{name}}', html: '<span style="display:none">Preview</span><p>Hi {{name}}</p><div>{{{extra}}}</div>', variables: [{ key: 'name', defaultValue: 'there' }] }] }
const dryImport = await api('/v1/admin/emails/import', { token: agentToken, method: 'POST', body: { ...emailImport, dryRun: true } })
const emailImported = await api('/v1/admin/emails/import', { token: agentToken, method: 'POST', body: emailImport })
assert(dryImport.created === 1 && emailImported.created === 1 && (await api('/v1/admin/emails/import', { token: agentToken, method: 'POST', body: { ...emailImport, mode: 'upsert' } })).unchanged === 1, 'email templates import by send key (dry run, create, unchanged upsert)')
const preview = await api('/v1/emails/render', { token: created.secret, method: 'POST', body: { template: 'smoke-welcome', to: 'ada@example.test', variables: { name: '<Ada>', extra: '<b>raw</b>' } } })
assert(preview.subject === 'Hi <Ada>' && preview.html.includes('<p>Hi &lt;Ada&gt;</p>') && preview.html.includes('<b>raw</b>') && preview.html.includes('Preview</div>'), 'render escapes {{key}}, keeps {{{key}}} raw and lifts the preheader')
// The component library: a project's own component, used in a document; the copy renders without the library.
const badge = (await api('/v1/admin/email-components', { token: agentToken, method: 'POST', body: { name: 'Smoke badge', description: 'A badge', html: '<table role="presentation"><tr><td style="background:{{@tint}}"><a href="{{@link}}">{{@label}}</a></td></tr></table>', fields: [{ key: 'label', default: 'Hi' }, { key: 'tint', default: '#111111' }], project: project.id } })).component
assert(badge.fields.map(f => `${f.key}:${f.type}`).join() === 'tint:color,link:url,label:text' && badge.projectId === project.id, 'components keep their fields, typed from where they sit')
assert((await api(`/v1/admin/email-components?project=${project.id}`, { token: agentToken })).components.some(c => c.id === badge.id) && !(await api('/v1/admin/email-components', { token: agentToken })).components.some(c => c.id === badge.id), 'a project component shows in its project only')
const withBadge = await api('/v1/emails/render', { token: created.secret, method: 'POST', body: { subject: 'Badge', document: { settings: { title: 'Badge' }, blocks: [{ type: 'component', componentId: badge.id, html: badge.html, fields: badge.fields, values: { label: 'Hello {{name}}', link: 'https://example.test' } }] }, variables: { name: '<Ada>' } } })
await api(`/v1/admin/email-components/${badge.id}`, { token: agentToken, method: 'DELETE' })
assert(withBadge.html.includes('background:#111111') && withBadge.html.includes('>Hello &lt;Ada&gt;</a>'), 'a component renders from its copy, values escaped once')
await api('/v1/email-suppressions', { token: created.secret, method: 'POST', body: { emails: ['bounced@example.test'], reason: 'manual' } })
// Mailgun's test mode: accepted and logged, never delivered.
const sendRes = await fetch(`${BASE}/v1/emails/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.secret}` }, body: JSON.stringify({ template: 'smoke-welcome', to: ['ada@example.test', 'bounced@example.test'], variables: { name: 'Ada' }, testMode: true }) })
if (sendRes.status === 503) {
  console.log('skip email send (Mailgun is not configured)')
} else {
  const sendBody = await sendRes.json()
  assert(sendRes.ok && sendBody.suppressed[0] === 'bounced@example.test' && sendBody.results.length === 2, 'a send answers per recipient and skips suppressed addresses')
  const sentLogs = await api('/v1/email-logs?template=smoke-welcome', { token: created.secret })
  assert(sentLogs.logs.length === 2 && sentLogs.logs.some(l => l.status === 'suppressed') && sentLogs.logs.every(l => l.batchId === sendBody.id), 'both recipients are in the email log')
}

console.log('\nsmoke passed')
