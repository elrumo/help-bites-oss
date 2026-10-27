import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { handleMcpBody, describeFailure, MCP_PROTOCOL_VERSIONS, type McpCall } from '../server/utils/mcp/protocol'
import { MCP_TOOLS, buildRequest, describeTool, paramLocation } from '../server/utils/mcp/tools'
import { pkceMatches, readClient, redirectWith, registerClient, requireClient, validChallenge, validRedirectUri } from '../server/utils/mcp/oauth'

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
  test('GET arguments become the query string, path arguments are encoded', () => {
    expect(buildRequest(tool('list_conversations'), { project: 'p1', unread: true, limit: 20 })).toEqual({ method: 'GET', url: '/v1/admin/conversations?project=p1&unread=true&limit=20' })
    expect(buildRequest(tool('get_conversation'), { id: 'a/b?c' })).toEqual({ method: 'GET', url: '/v1/admin/conversations/a%2Fb%3Fc' })
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
    expect(buildRequest(tool('update_board_item'), { id: 'b1', project: 'p1', rank: 1759312345678.5, labels: ['ios'] })).toEqual({ method: 'PATCH', url: '/v1/admin/board-items/b1?project=p1', body: { rank: 1759312345678.5, labels: ['ios'] } })
    expect(buildRequest(tool('update_board_item'), { id: 'b1', project: 'p1', rank: '3' })).toEqual({ error: 'Argument "rank" must be a number.' })
  })

  test('planning tools carry what the web board edits', () => {
    expect(Object.keys(tool('create_board_item').params)).toEqual(expect.arrayContaining(['assigneeId', 'labels', 'targetDate', 'attachments', 'rank']))
    expect(Object.keys(tool('update_board_item').params)).toEqual(expect.arrayContaining(['assigneeId', 'labels', 'targetDate', 'attachments', 'rank']))
    expect(buildRequest(tool('list_board_items'), { project: 'p1', feedbackPost: '#12' })).toMatchObject({ url: '/v1/admin/board-items?project=p1&feedbackPost=%2312&limit=50' })
    expect(buildRequest(tool('list_board_item_history'), { id: 'b1', project: 'p1', limit: 20 })).toEqual({ method: 'GET', url: '/v1/admin/board-items/b1/history?project=p1&limit=20' })
    expect(buildRequest(tool('suggest_board_item_title'), { project: 'p1', description: 'Export contacts' })).toEqual({ method: 'POST', url: '/v1/admin/board-items/suggest-title?project=p1', body: { description: 'Export contacts' } })
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
    for (const bad of ['http://evil.example/cb', 'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'https://a.example/cb#frag', 'not a url', '', 42, `https://a.example/${'x'.repeat(600)}`]) expect(validRedirectUri(bad)).toBe(false)
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
