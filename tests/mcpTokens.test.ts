import { describe, expect, test } from 'bun:test'
import { handleMcpBody, type McpCall } from '../server/utils/mcp/protocol'
import { MCP_TOOLS, buildRequest, describeTool } from '../server/utils/mcp/tools'
import { prune, shapeResult } from '../server/utils/mcp/shape'
import { findTools, leanTools } from '../server/utils/mcp/lean'

const rpc = (method: string, params: unknown, call: McpCall, options = {}) => handleMcpBody({ jsonrpc: '2.0', id: 1, method, params }, call, options) as Promise<any>
const text = (answer: any) => answer.result.content[0].text as string

describe('answers an assistant pays for', () => {
  test('empty fields are dropped, false and 0 stay', () => {
    expect(prune({ a: null, b: '', c: [], d: {}, e: false, f: 0, g: { h: null, i: 'x' }, j: [{ k: null }] })).toEqual({ e: false, f: 0, g: { i: 'x' }, j: [{}] })
  })

  test('answers are compact JSON, not pretty-printed', async () => {
    const answer = await rpc('tools/call', { name: 'get_overview' }, async () => ({ status: 200, data: { a: 1, b: null } }))
    expect(text(answer)).toBe('{"a":1}')
  })

  test('a board search is brief by default and full on request', async () => {
    const item = { id: 'I1', number: 54, title: 'T', kind: 'task', description: 'd'.repeat(500), status: 'done', statusCategory: 'done', rank: 1, projectId: 'P', attachments: [{ url: 'u' }, { url: 'v' }], labels: [], lastModifiedBy: 'x', posts: [], conversations: [] }
    const call: McpCall = async () => ({ status: 200, data: { total: 1, items: [item] } })
    const brief = JSON.parse(text(await rpc('tools/call', { name: 'list_board_items', arguments: { project: 'P' } }, call))).items[0]
    expect(brief).toMatchObject({ id: 'I1', number: 54, title: 'T', status: 'done', attachments: 2 })
    expect(brief.description.length).toBeLessThan(300)
    expect(brief.rank).toBeUndefined()
    const full = JSON.parse(text(await rpc('tools/call', { name: 'list_board_items', arguments: { project: 'P', detail: 'full' } }, call))).items[0]
    expect(full.description.length).toBe(500)
    expect(full.attachments).toHaveLength(2)
  })

  test('detail never reaches the route and must be brief or full', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'list_board_items')!
    expect(buildRequest(tool, { project: 'P', detail: 'full' })).toEqual({ method: 'GET', url: '/v1/admin/board-items?project=P&limit=50' })
    expect(buildRequest(tool, { project: 'P', detail: 'huge' })).toHaveProperty('error')
    expect(describeTool(tool).inputSchema.properties).toHaveProperty('detail')
    expect(buildRequest(MCP_TOOLS.find(t => t.name === 'get_overview')!, { detail: 'full' })).toHaveProperty('error')
  })

  test('list_projects keeps ids and board and feedback keys, not the look', () => {
    const data = { projects: [{ id: 'P', name: 'N', look: { big: 'x'.repeat(1000) }, hub: { a: 1 }, board: { enabled: true, statuses: [{ key: 'done', label: 'Done', color: 'success', category: 'done' }], labels: [{ key: 'bug', label: 'Bug', color: 'error' }], views: [{ id: 'v' }] }, feedback: { enabled: true, statuses: [{ key: 'open', label: 'Open', notify: true }] } }] }
    const out = shapeResult('list_projects', data) as any
    expect(out.projects[0]).toEqual({ id: 'P', name: 'N', board: { enabled: true, statuses: [{ key: 'done', label: 'Done', category: 'done' }], labels: [{ key: 'bug', label: 'Bug' }] }, feedback: { enabled: true, statuses: [{ key: 'open', label: 'Open' }] } })
    expect(JSON.stringify(shapeResult('list_projects', data, 'full')).length).toBeGreaterThan(1000)
  })

  test('conversations carry their customer inline', () => {
    const data = { conversations: [{ id: 'C', endUserId: 'U', status: 'open', lastMessagePreview: 'hi', context: null }], endUsers: { U: { id: 'U', name: 'Ann', email: 'a@x.co', externalId: 'e' } }, hasMore: true, counts: { status: { open: 1 } } }
    expect(shapeResult('list_conversations', data)).toEqual({ conversations: [{ id: 'C', status: 'open', customer: { id: 'U', name: 'Ann', email: 'a@x.co' }, preview: 'hi' }], hasMore: true, counts: { status: { open: 1 } } })
  })
})

describe('the lean toolset', () => {
  const none: McpCall = async () => ({ status: 200, data: { ok: 1 } })
  const lean = { lean: true }

  test('lists three small tools instead of every definition', async () => {
    const tools = (await rpc('tools/list', {}, none, lean)).result.tools
    expect(tools.map((t: any) => t.name)).toEqual(['find_tools', 'call_read_tool', 'call_write_tool'])
    expect(JSON.stringify(tools).length).toBeLessThan(3_000)
    expect(tools.find((t: any) => t.name === 'call_write_tool').annotations.readOnlyHint).toBe(false)
    expect(leanTools(true).map(t => t.name)).toEqual(['find_tools', 'call_read_tool'])
  })

  test('find_tools finds the planning tools by words and returns their arguments', () => {
    const found = JSON.parse(findTools({ query: 'board item' }, false)).tools
    expect(found.map((t: any) => t.name)).toContain('list_board_items')
    expect(found[0].inputSchema.type).toBe('object')
    expect(JSON.parse(findTools({ query: 'update_board_item' }, false)).tools[0].name).toBe('update_board_item')
    expect(JSON.parse(findTools({}, false)).tools.split(' ')).toHaveLength(MCP_TOOLS.length)
    expect(findTools({ query: 'zzzzqq' }, false)).toContain('No tool matches')
    expect(JSON.parse(findTools({ query: 'board item' }, true)).tools.every((t: any) => t.readOnly)).toBe(true)
  })

  test('call_read_tool runs a read and refuses a write; call_write_tool runs a write', async () => {
    const seen: string[] = []
    const call: McpCall = async (request) => { seen.push(`${request.method} ${request.url}`); return { status: 200, data: { ok: 1 } } }
    expect(text(await rpc('tools/call', { name: 'call_read_tool', arguments: { name: 'list_projects' } }, call, lean))).toBe('{}')
    const refused = await rpc('tools/call', { name: 'call_read_tool', arguments: { name: 'delete_board_item', arguments: { id: 'x' } } }, call, lean)
    expect(refused.result.isError).toBe(true)
    expect(text(refused)).toContain('call_write_tool')
    await rpc('tools/call', { name: 'call_write_tool', arguments: { name: 'archive_conversation', arguments: { id: 'C1' } } }, call, lean)
    expect(seen).toEqual(['GET /v1/admin/projects', 'POST /v1/admin/conversations/C1/archive'])
  })

  test('a read-only connection cannot write through it, and the full list is not callable', async () => {
    const answer = await rpc('tools/call', { name: 'call_write_tool', arguments: { name: 'archive_conversation', arguments: { id: 'C1' } } }, none, { lean: true, readOnly: true })
    expect(answer.result.isError).toBe(true)
    expect((await rpc('tools/call', { name: 'list_projects' }, none, lean)).error.code).toBe(-32602)
  })
})

describe('more short views', () => {
  test('a changelog entry keeps one clipped copy of its body, not three', () => {
    const body = 'b'.repeat(900)
    const out = shapeResult('list_changelog_entries', { entries: [{ id: 'E', number: 3, title: 'T', status: 'draft', body, bodyHtml: `<p>${body}</p>`, excerpt: body.slice(0, 200), images: [], sources: [{ id: 'x' }], bodyFormat: 'markdown' }] }) as any
    expect(out.entries[0]).toMatchObject({ id: 'E', number: 3, title: 'T', status: 'draft' })
    expect(out.entries[0].body.length).toBeLessThan(300)
    expect(JSON.stringify(out)).not.toContain('<p>')
    expect((shapeResult('list_changelog_entries', { entries: [{ id: 'E', body, bodyHtml: 'h' }] }, 'full') as any).entries[0].bodyHtml).toBe('h')
  })

  test('a feedback post keeps its words, votes and state, and drops the viewer flags', () => {
    const post = { id: 'F', number: 12, slug: 's', title: 'Dark mode', body: 'x'.repeat(600), status: 'planned', voteCount: 5, commentCount: 2, tags: ['ui'], author: { name: 'Ann', isTeam: false, handle: 'ann', avatarUrl: 'u', email: 'a@x.co' }, reactions: [{ emoji: '+' }], hasVoted: true, canEdit: true, subscribed: false, refs: [1], changelogBody: 'c', duplicateOf: null, attachments: [{ url: 'u' }] }
    const out = shapeResult('list_feedback', { posts: [post], total: 1, viewer: { signedIn: true } }) as any
    expect(out.total).toBe(1)
    expect(out.viewer).toBeUndefined()
    expect(out.posts[0]).toMatchObject({ id: 'F', number: 12, title: 'Dark mode', status: 'planned', voteCount: 5, tags: ['ui'], author: { name: 'Ann', email: 'a@x.co' }, attachments: 1 })
    expect(out.posts[0].body.length).toBeLessThan(400)
    for (const gone of ['reactions', 'hasVoted', 'canEdit', 'subscribed', 'refs', 'changelogBody', 'slug']) expect(out.posts[0][gone]).toBeUndefined()
  })

  test('an error issue keeps what every tracker has, and the page cursor', () => {
    const out = shapeResult('list_errors', { issues: [{ id: '1', shortId: 'APP-1', title: 'TypeError', level: 'error', count: 4, lastSeen: 't', status: 'unresolved', project: { id: 9, name: 'big' }, metadata: { a: 'b' }, stats: { '24h': [[1, 2]] } }], next: 'c2' }) as any
    expect(out).toEqual({ next: 'c2', issues: [{ id: '1', shortId: 'APP-1', title: 'TypeError', level: 'error', count: 4, lastSeen: 't', status: 'unresolved' }] })
  })
})
