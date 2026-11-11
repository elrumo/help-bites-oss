import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { handleMcpBody, describeFailure, MCP_PROTOCOL_VERSIONS, type McpCall } from '../server/utils/mcp/protocol'
import { MCP_TOOLS, RESERVED_PATH_WORDS, buildRequest, describeTool, paramLocation } from '../server/utils/mcp/tools'
import { OAUTH_KEY_DAYS, OAUTH_REFRESH_DAYS, REFRESH_REUSE_GRACE_MS, cleanClientName, knownRedirect, pkceMatches, readClient, readRefreshEntry, redirectWith, registerClient, requireClient, validChallenge, validRedirectUri } from '../server/utils/mcp/oauth'

const root = join(import.meta.dir, '..')
const tool = (name: string) => MCP_TOOLS.find(t => t.name === name)!

// A tool is an internal call to a /v1 route, so a renamed or removed route must fail here.
function routeFile(method: string, path: string): string {
  const parts = path.replace(/^\//, '').split('/').map(part => part.replace(/^\{(.+)\}$/, '[$1]'))
  const last = parts.pop()!
  const verb = method.toLowerCase()
  const dir = join(root, 'server/routes', ...parts)
  return [join(dir, `${last}.${verb}.ts`), join(dir, last, `index.${verb}.ts`)].find(existsSync) || ''
}

describe('MCP tools', () => {
  test('names are unique, snake_case and described', () => {
    const names = MCP_TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of MCP_TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z_]*$/)
      expect(t.description.length).toBeGreaterThan(20)
      for (const [name, param] of Object.entries(t.params)) expect(`${t.name}.${name}: ${param.description}`).toMatch(/: .{4,}/)
    }
  })

  test('every tool calls a route that exists', () => {
    expect(MCP_TOOLS.filter(t => !routeFile(t.method, t.path)).map(t => `${t.name}: ${t.method} ${t.path}`)).toEqual([])
  })

  test('every path parameter is declared and required', () => {
    for (const t of MCP_TOOLS) {
      for (const [, name] of t.path.matchAll(/\{(\w+)\}/g)) expect(t.params[name!]?.required).toBe(true)
    }
  })

  test('only reads are marked read-only, and they are GETs', () => {
    for (const t of MCP_TOOLS) expect(Boolean(t.readOnly)).toBe(t.method === 'GET')
  })

  test('every tool is documented', () => {
    const doc = readFileSync(join(root, 'docs/MCP.md'), 'utf8')
    expect(MCP_TOOLS.filter(t => !doc.includes(`\`${t.name}\``)).map(t => t.name)).toEqual([])
  })

  test('descriptors are valid JSON Schema objects', () => {
    for (const t of MCP_TOOLS) {
      const { inputSchema } = describeTool(t)
      expect(inputSchema.type).toBe('object')
      expect(inputSchema.additionalProperties).toBe(false)
      expect(JSON.stringify(inputSchema)).not.toContain('"in"')
      expect(JSON.stringify(inputSchema)).not.toContain('"as"')
      for (const required of inputSchema.required || []) expect(required in inputSchema.properties).toBe(true)
    }
  })
})

describe('buildRequest', () => {
  test('GET arguments become the query string', () => {
    expect(buildRequest(tool('list_conversations'), { project: 'p1', unread: true, limit: 20 })).toEqual({ method: 'GET', url: '/v1/admin/conversations?project=p1&unread=true&limit=20' })
    expect(buildRequest(tool('get_conversation'), { id: 'aB3_x-9' })).toEqual({ method: 'GET', url: '/v1/admin/conversations/aB3_x-9' })
  })

  test('a path argument is an id, never a way to another route', () => {
    const get = tool('get_conversation')
    for (const id of ['a/b', 'a?b', 'a#b', '..', '.', 'a%2fb', 'a b', 'a\nb', '', 'x'.repeat(129)]) expect(buildRequest(get, { id })).toHaveProperty('error')
    // A word that names a sibling route (/conversations/export, /conversations/bulk) is refused in any case.
    for (const id of ['export', 'Bulk', 'config', 'import', 'stats']) expect((buildRequest(get, { id }) as { error: string }).error).toContain('reserved')
    expect(buildRequest(get, { id: 'x'.repeat(128) })).toHaveProperty('url')
  })

  test('every route name that sits beside an {id} route is a reserved path word', () => {
    // A new /export or /bulk next to a /[id] route fails here until it is added to RESERVED_PATH_WORDS.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? [join(dir, name), ...walk(join(dir, name))] : [])
    const stripped = (name: string) => name.replace(/\.(get|post|put|patch|delete)\.ts$/, '').replace(/\.ts$/, '')
    const siblings = new Set<string>()
    for (const dir of [join(root, 'server/routes/v1'), ...walk(join(root, 'server/routes/v1'))].filter(d => statSync(d).isDirectory())) {
      const names = readdirSync(dir).map(stripped)
      if (!names.some(name => name.startsWith('['))) continue
      for (const name of names) if (!name.startsWith('[') && name !== 'index') siblings.add(name)
    }
    expect([...siblings].filter(name => !RESERVED_PATH_WORDS.has(name))).toEqual([])
  })

  test('writes put arguments in the body, except where the route reads the query', () => {
    expect(buildRequest(tool('reply_to_conversation'), { id: 'c1', body: 'Hi' })).toEqual({ method: 'POST', url: '/v1/admin/conversations/c1/messages', body: { body: 'Hi' } })
    expect(buildRequest(tool('create_board_item'), { project: 'p1', title: 'CSV export', priority: 'high' })).toEqual({ method: 'POST', url: '/v1/admin/board-items?project=p1', body: { title: 'CSV export', priority: 'high' } })
    expect(paramLocation(tool('update_feedback_post'), 'project')).toBe('query')
  })

  test('lists in the query are comma-joined', () => {
    expect(buildRequest(tool('list_feedback'), { project: 'p1', status: 'planned,open' })).toMatchObject({ url: '/v1/feedback?project=p1&status=planned%2Copen' })
  })

  test('says what is wrong so the assistant can retry', () => {
    expect(buildRequest(tool('get_conversation'), {})).toEqual({ error: 'Missing required argument "id".' })
    expect(buildRequest(tool('get_conversation'), { id: 'c1', idd: 'x' })).toMatchObject({ error: expect.stringContaining('Unknown argument "idd"') })
    expect(buildRequest(tool('list_conversations'), { limit: 500 })).toEqual({ error: 'Argument "limit" must be at most 200.' })
    expect(buildRequest(tool('list_conversations'), { limit: '5' })).toEqual({ error: 'Argument "limit" must be a whole number.' })
    expect(buildRequest(tool('update_conversation'), { id: 'c1', priority: 'asap' })).toMatchObject({ error: expect.stringContaining('must be one of low, normal, high, urgent') })
    expect(buildRequest(tool('update_conversation'), { id: 'c1', tags: 'vip' })).toEqual({ error: 'Argument "tags" must be a list of strings.' })
    expect(buildRequest(tool('add_internal_note'), { id: 'c1', body: '  ' })).toEqual({ error: 'Argument "body" must not be empty.' })
  })

  test('an argument can go out under the route\'s own name, and a number may be a fraction', () => {
    // The route reads the linked thing as `id` in the body, next to the item's `id` in the path.
    expect(buildRequest(tool('link_board_item'), { id: 'b1', kind: 'feedback', linkedId: '#12' })).toEqual({ method: 'POST', url: '/v1/admin/board-items/b1/links', body: { kind: 'feedback', id: '#12' } })
    expect(buildRequest(tool('merge_board_item'), { id: 'b1', into: '#12' })).toEqual({ method: 'POST', url: '/v1/admin/board-items/b1/merge', body: { into: '#12' } })
    expect(buildRequest(tool('create_attachment_upload'), { project: 'p1', filename: 'icon.png' })).toEqual({ method: 'POST', url: '/v1/feedback/attachments/ticket?project=p1', body: { filename: 'icon.png' } })
    expect(buildRequest(tool('update_board_item'), { id: 'b1', project: 'p1', rank: 1759312345678.5, labels: ['ios'] })).toEqual({ method: 'PATCH', url: '/v1/admin/board-items/b1?project=p1', body: { rank: 1759312345678.5, labels: ['ios'] } })
    expect(buildRequest(tool('update_board_item'), { id: 'b1', project: 'p1', rank: '3' })).toEqual({ error: 'Argument "rank" must be a number.' })
  })

  test('planning tools carry what the web board edits', () => {
    expect(Object.keys(tool('create_board_item').params)).toEqual(expect.arrayContaining(['assigneeId', 'labels', 'targetDate', 'attachments', 'rank']))
    expect(Object.keys(tool('update_board_item').params)).toEqual(expect.arrayContaining(['assigneeId', 'labels', 'targetDate', 'attachments', 'rank']))
    expect(buildRequest(tool('list_board_items'), { project: 'p1', feedbackPost: '#12' })).toMatchObject({ url: '/v1/admin/board-items?project=p1&feedbackPost=%2312&limit=50' })
    expect(buildRequest(tool('list_board_item_history'), { id: 'b1', project: 'p1', limit: 20 })).toEqual({ method: 'GET', url: '/v1/admin/board-items/b1/history?project=p1&limit=20' })
    expect(buildRequest(tool('suggest_board_item_title'), { project: 'p1', description: 'Export contacts' })).toEqual({ method: 'POST', url: '/v1/admin/board-items/suggest-title?project=p1', body: { description: 'Export contacts' } })
    expect(buildRequest(tool('suggest_board_item_public_description'), { project: 'p1', title: 'Virtual copies', description: 'Like Lightroom' })).toEqual({ method: 'POST', url: '/v1/admin/board-items/suggest-public-description?project=p1', body: { title: 'Virtual copies', description: 'Like Lightroom' } })
    expect(tool('delete_board_item').destructive).toBe(true)
  })

  test('PUT carries its arguments in the body', () => {
    const put = MCP_TOOLS.find(t => t.method === 'PUT')
    if (!put) return
    const args = Object.fromEntries(Object.entries(put.params).filter(([, p]) => p.required).map(([name, p]) => [name, p.type === 'string' ? 'x' : p.type === 'boolean' ? true : p.type === 'integer' || p.type === 'number' ? 1 : p.type === 'array' ? [] : {}]))
    expect(buildRequest(put, args)).toMatchObject({ method: 'PUT', body: expect.any(Object) })
  })

  test('null and absent optional arguments are left out', () => {
    expect(buildRequest(tool('list_conversations'), { status: null })).toEqual({ method: 'GET', url: '/v1/admin/conversations' })
    expect(buildRequest(tool('list_projects'), undefined)).toEqual({ method: 'GET', url: '/v1/admin/projects' })
  })
})

describe('MCP protocol', () => {
  const ok: McpCall = async request => ({ status: 200, data: { seen: request.url } })
  const send = (message: unknown, call: McpCall = ok) => handleMcpBody(message, call) as Promise<any>

  test('initialize negotiates the protocol version and offers tools', async () => {
    const answer = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    expect(answer.result.protocolVersion).toBe('2025-03-26')
    expect(answer.result.capabilities).toEqual({ tools: { listChanged: false } })
    expect(answer.result.serverInfo.name).toBe('helpbites')
    expect((await send({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).result.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0])
  })

  test('tools/list returns every tool', async () => {
    const answer = await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(answer.result.tools.map((t: { name: string }) => t.name)).toEqual(MCP_TOOLS.map(t => t.name))
    expect(answer.result.tools.find((t: { name: string }) => t.name === 'list_projects').annotations.readOnlyHint).toBe(true)
  })

  test('tools/call runs the route and returns its JSON as text', async () => {
    const answer = await send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_conversation', arguments: { id: 'c1' } } })
    expect(answer.id).toBe(7)
    expect(answer.result.isError).toBe(false)
    expect(JSON.parse(answer.result.content[0].text)).toEqual({ seen: '/v1/admin/conversations/c1' })
  })

  test('a route failure is a tool error carrying its message, not a protocol error', async () => {
    const answer = await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_conversation', arguments: { id: 'x' } } }, async () => ({ status: 404, data: { statusMessage: 'Not found' } }))
    expect(answer.error).toBeUndefined()
    expect(answer.result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'HTTP 404: Not found.' }] })
    expect(describeFailure(403, { statusMessage: 'Your role in this workspace cannot do that' })).toContain('HTTP 403: Your role')
    expect(describeFailure(500, 'boom')).toBe('HTTP 500: boom.')
  })

  test('bad arguments never reach the route', async () => {
    let called = false
    const answer = await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_conversation', arguments: {} } }, async () => { called = true; return { status: 200, data: {} } })
    expect(called).toBe(false)
    expect(answer.result.isError).toBe(true)
    expect(answer.result.content[0].text).toContain('Missing required argument "id"')
  })

  test('an unknown tool or method is a protocol error', async () => {
    expect((await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'drop_database' } })).error.code).toBe(-32602)
    expect((await send({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).error.code).toBe(-32601)
  })

  test('a thrown call is reported to the assistant', async () => {
    const answer = await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects' } }, async () => { throw new Error('socket closed') })
    expect(answer.result.isError).toBe(true)
    expect(answer.result.content[0].text).toContain('socket closed')
  })

  test('notifications and client responses get no answer', async () => {
    expect(await send({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect(await send({ jsonrpc: '2.0', id: 3, result: {} })).toBeNull()
  })

  test('batches answer each request and skip notifications', async () => {
    const answer = await send([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'ping' }])
    expect(answer.map((a: { id: number }) => a.id)).toEqual([1, 2])
    expect((await send([])).error.code).toBe(-32600)
  })

  test('a batch is capped, and a route that never answers is given up on', async () => {
    const ping = (id: number) => ({ jsonrpc: '2.0', id, method: 'ping' })
    expect((await send(Array.from({ length: 21 }, (_, i) => ping(i + 1)))).error.message).toContain('at most 20')
    expect(await send(Array.from({ length: 20 }, (_, i) => ping(i + 1)))).toHaveLength(20)
    const never: McpCall = () => new Promise(() => {})
    const answer = await handleMcpBody({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects' } }, never, { timeoutMs: 20 }) as any
    expect(answer.result.isError).toBe(true)
    expect(answer.result.content[0].text).toContain('did not answer')
  })

  test('malformed input is an invalid request', async () => {
    expect((await send('hello')).error.code).toBe(-32600)
    expect((await send({ id: 1 })).error.code).toBe(-32600)
  })

  test('a huge result is cut off with a hint', async () => {
    const answer = await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects' } }, async () => ({ status: 200, data: { text: 'x'.repeat(200_000) } }))
    expect(answer.result.content[0].text.length).toBeLessThan(61_000)
    expect(answer.result.content[0].text).toContain('cut off')
  })
})

describe('MCP sign-in', () => {
  process.env.HELPBITES_SECRET = 'test-secret-for-the-mcp-client-registration-0123456789'
  const redirect = 'https://claude.ai/api/mcp/auth_callback'

  test('redirect addresses: https, loopback http and app schemes only', () => {
    for (const ok of [redirect, 'http://localhost:6274/callback', 'http://127.0.0.1:8080/cb', 'cursor://anysphere.cursor-mcp/oauth/callback', 'vscode://x/y']) expect(validRedirectUri(ok)).toBe(true)
    // Schemes that open a local handler with a link someone else wrote are not an app's own.
    for (const bad of ['search-ms:query=x', 'ms-msdt:/id', 'intent://x#Intent;end', 'ws://localhost/x', 'ftp://a.example/x', 'slack://open', 'https://user:pass@a.example/cb']) expect(validRedirectUri(bad)).toBe(false)
    for (const ok of ['com.example.app://cb', 'claude://auth/cb', 'windsurf://x/y']) expect(validRedirectUri(ok)).toBe(true)
    for (const bad of ['http://evil.example/cb', 'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'https://a.example/cb#frag', 'not a url', '', 42, `https://a.example/${'x'.repeat(600)}`]) expect(validRedirectUri(bad)).toBe(false)
  })

  test('the consent page knows which addresses are an assistant it can name', () => {
    for (const known of ['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect', 'https://platform.openai.com/x', 'http://localhost:6274/cb', 'cursor://anysphere.cursor-mcp/oauth/callback']) expect(knownRedirect(known)).toBe(true)
    for (const unknown of ['https://evil.example/cb', 'https://claude.ai.evil.example/cb', 'https://notclaude.ai/cb', 'com.example.app://cb', 'nonsense']) expect(knownRedirect(unknown)).toBe(false)
  })

  test('a client names itself in plain text only', () => {
    // Bidi overrides, zero-width and control characters would let a name read as something else, or as several lines.
    expect(cleanClientName('Cla\u202eude\u200b \u0007AI\nTeam')).toBe('Claude AI Team')
    expect(cleanClientName('  \u202e\u200b ')).toBe('')
    expect(registerClient({ client_name: '\u202e\u200b', redirect_uris: [redirect] }).client.name).toBe('AI assistant')
    expect(cleanClientName('x'.repeat(100))).toHaveLength(60)
  })

  test('a client id is the signed registration: readable, not forgeable', () => {
    const { clientId, client } = registerClient({ client_name: ' Claude ', redirect_uris: [redirect, redirect] })
    expect(client).toEqual({ name: 'Claude', redirectUris: [redirect] })
    expect(readClient(clientId)).toEqual(client)
    expect(requireClient(clientId, redirect).name).toBe('Claude')
    const [body, mac] = clientId.split('.')
    const forged = Buffer.from(JSON.stringify({ n: 'Claude', r: ['https://evil.example/cb'] })).toString('base64url')
    expect(readClient(`${forged}.${mac}`)).toBeNull()
    expect(readClient(`${body}.${'A'.repeat(32)}`)).toBeNull()
    expect(readClient('garbage')).toBeNull()
  })

  test('a client may only return to an address it registered', () => {
    const { clientId } = registerClient({ redirect_uris: [redirect] })
    expect(() => requireClient(clientId, 'https://evil.example/cb')).toThrow()
    expect(() => requireClient('nope', redirect)).toThrow()
    expect(readClient(clientId)?.name).toBe('AI assistant')
  })

  test('registration refuses missing, unsafe or too many redirect addresses', () => {
    expect(() => registerClient({})).toThrow()
    expect(() => registerClient({ redirect_uris: ['javascript:alert(1)'] })).toThrow()
    expect(() => registerClient({ redirect_uris: Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`) })).toThrow()
  })

  test('PKCE S256', () => {
    const verifier = 'a'.repeat(43)
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    expect(validChallenge(challenge)).toBe(true)
    expect(pkceMatches(verifier, challenge)).toBe(true)
    expect(pkceMatches('b'.repeat(43), challenge)).toBe(false)
    expect(pkceMatches('short', challenge)).toBe(false)
    expect(pkceMatches(undefined, challenge)).toBe(false)
    expect(validChallenge('plain')).toBe(false)
  })

  test('the redirect carries the code and the state, and keeps existing parameters', () => {
    expect(redirectWith('https://x.example/cb?a=1', { code: 'abc', state: 's t' })).toBe('https://x.example/cb?a=1&code=abc&state=s+t')
    expect(redirectWith('https://x.example/cb', { error: 'access_denied', state: '' })).toBe('https://x.example/cb?error=access_denied')
  })
})

describe('MCP refresh tokens', () => {
  const grant = { agentId: 'a1', workspaceId: 'w1', clientId: 'c1', apiKeyId: 'k1' }

  test('a stored entry is a live grant, a spent token, or nothing', () => {
    expect(readRefreshEntry(JSON.stringify(grant))).toEqual({ grant })
    expect(readRefreshEntry(null)).toBeNull()
    expect(readRefreshEntry('not json')).toBeNull()
    expect(readRefreshEntry(JSON.stringify({ agentId: 'a1' }))).toBeNull()
    expect(readRefreshEntry('used:')).toBeNull()
  })

  test('a spent token presented again at once is a retry; later, a copy someone kept', () => {
    const at = 1_000_000
    expect(readRefreshEntry(`used:k1:${at}`, at + 5_000)).toEqual({ reusedKeyId: 'k1', revoke: false })
    expect(readRefreshEntry(`used:k1:${at}`, at + REFRESH_REUSE_GRACE_MS + 1)).toEqual({ reusedKeyId: 'k1', revoke: true })
    // A note with no time is old enough.
    expect(readRefreshEntry('used:k1', at)).toEqual({ reusedKeyId: 'k1', revoke: true })
  })

  test('a connection lasts as long as it is used, and not for years unused', () => {
    expect(OAUTH_KEY_DAYS).toBeLessThanOrEqual(30)
    expect(OAUTH_REFRESH_DAYS).toBeLessThanOrEqual(90)
  })
})
