// The Model Context Protocol over Streamable HTTP, the stateless part of it:
// every POST carries one JSON-RPC message (or a batch), the answer is plain
// JSON, and nothing is remembered between calls. That is all an assistant needs
// to list the tools and call them, and it runs on any number of servers with no
// session store. This file only speaks the protocol; `call` does the work and
// is the route's, so everything here tests without a server.

import { buildRequest, describeTool, MCP_TOOLS, type McpRequest } from './tools'
import { redactSecrets } from './redact'

/** Newest first. A client asking for one of these gets it; any other gets the newest. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = [
  'HelpBites is a toolkit for an app\'s support inbox, feedback board, planning board and roadmap, changelog, knowledge base, email and campaigns, onboarding, forms, pricing, legal documents, pages, blog and error tracking.',
  'Call list_projects first: most tools need a project id.',
  'Replies to customers, sent email, campaigns and anything published (changelog entries, pages, blog posts, legal documents, pricing tables) reach real people, so confirm the wording before sending or publishing.',
  'If no tool does what you need, the API reference is at /_docs/scalar on this host and its OpenAPI spec at /_docs/openapi.json.'
].join(' ')

/** What a tool call produced: the HTTP status and body of the /v1 route behind it. */
export type McpCall = (request: McpRequest) => Promise<{ status: number, data: unknown }>

/** `readOnly`: the connection's key only reads, so it is offered the tools that read and no others. */
export type McpOptions = { readOnly?: boolean, timeoutMs?: number }
const READ_ONLY_NOTE = 'This connection is read-only: tools that change anything are not offered.'

type JsonRpcId = string | number | null
export type JsonRpcResponse = { jsonrpc: '2.0', id: JsonRpcId } & ({ result: unknown } | { error: { code: number, message: string } })

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

// A tool result goes into the assistant's context, so a runaway list is cut off with a hint rather than sent whole.
const MAX_RESULT_CHARS = 60_000
// One POST may batch messages, and each tools/call is a request into the app: a few at a time is plenty for an assistant.
export const MAX_BATCH = 20
// A route that does not answer must not hold the connection (and the work behind it) open for ever.
export const CALL_TIMEOUT_MS = 30_000

const reply = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })
const fail = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })

/**
 * The answer to one parsed request body: a response, an array of them for a
 * batch, or null when there is nothing to say (notifications and responses
 * from the client get an HTTP 202 and no body).
 */
export async function handleMcpBody(body: unknown, call: McpCall, options: McpOptions = {}): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (!body.length) return fail(null, INVALID_REQUEST, 'An empty batch')
    if (body.length > MAX_BATCH) return fail(null, INVALID_REQUEST, `A batch holds at most ${MAX_BATCH} messages`)
    const answers = (await Promise.all(body.map(message => handleMcpMessage(message, call, options)))).filter((answer): answer is JsonRpcResponse => answer !== null)
    return answers.length ? answers : null
  }
  return handleMcpMessage(body, call, options)
}

export function mcpParseError(): JsonRpcResponse {
  return fail(null, PARSE_ERROR, 'The body is not valid JSON')
}

async function handleMcpMessage(message: unknown, call: McpCall, options: McpOptions): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return fail(null, INVALID_REQUEST, 'Not a JSON-RPC message')
  const { id, method, params } = message as { id?: JsonRpcId, method?: unknown, params?: unknown }
  const hasId = id !== undefined && id !== null
  // A response to something the server asked (it asks nothing) is acknowledged, never answered.
  if (typeof method !== 'string') return 'result' in message || 'error' in message ? null : fail(hasId ? id : null, INVALID_REQUEST, 'Missing method')
  // A notification: nothing to answer.
  if (!hasId) return null
  const input = (params && typeof params === 'object' && !Array.isArray(params) ? params : {}) as Record<string, unknown>

  switch (method) {
    case 'initialize': {
      const asked = String(input.protocolVersion || '')
      return reply(id, {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'helpbites', title: 'HelpBites', version: '1.0.0' },
        instructions: options.readOnly ? `${INSTRUCTIONS} ${READ_ONLY_NOTE}` : INSTRUCTIONS
      })
    }
    case 'ping': return reply(id, {})
    case 'tools/list': return reply(id, { tools: (options.readOnly ? MCP_TOOLS.filter(tool => tool.readOnly) : MCP_TOOLS).map(describeTool) })
    case 'tools/call': return callTool(id, input, call, options)
    default: return fail(id, METHOD_NOT_FOUND, `Unsupported method: ${method}`)
  }
}

async function callTool(id: JsonRpcId, params: Record<string, unknown>, call: McpCall, options: McpOptions): Promise<JsonRpcResponse> {
  const tool = MCP_TOOLS.find(candidate => candidate.name === params.name)
  if (!tool) return fail(id, INVALID_PARAMS, `Unknown tool: ${String(params.name)}`)
  // Not offered, so not callable either: the key would refuse the route anyway, this says why.
  if (options.readOnly && !tool.readOnly) return reply(id, toolText('This connection is read-only: it can look at things but not change them. Ask the user for a connection that may write.', true))
  const request = buildRequest(tool, params.arguments)
  if ('error' in request) return reply(id, toolText(request.error, true))
  try {
    const { status, data } = await withTimeout(call(request), options.timeoutMs ?? CALL_TIMEOUT_MS)
    return reply(id, status >= 200 && status < 300 ? toolText(JSON.stringify(redactSecrets(data ?? null), null, 2), false) : toolText(describeFailure(status, data), true))
  } catch (error) {
    return reply(id, toolText(`The request could not be made: ${(error as Error).message}`, true))
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`the route did not answer within ${Math.round(ms / 1000)} seconds`)), ms) })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

function toolText(text: string, isError: boolean) {
  const cut = text.length > MAX_RESULT_CHARS
  return { content: [{ type: 'text', text: cut ? `${text.slice(0, MAX_RESULT_CHARS)}\n…cut off: ask for less, with a filter or a smaller limit.` : text }], isError }
}

/** The route's own message (h3 puts it in `statusMessage`, or `message`), prefixed with the status so the assistant can tell a typo from a permission. */
export function describeFailure(status: number, data: unknown): string {
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const detail = String(body.statusMessage || body.message || (typeof data === 'string' ? data : '') || '').trim()
  const hint = status === 401 ? ' The connection\'s credentials were refused: reconnect it.'
    : status === 402 ? ' The workspace\'s plan does not include this.'
      : status === 403 ? ' The signed-in account (or the API key\'s project limit) does not allow this.'
        : status === 429 ? ' Too many requests: wait a minute.'
          : ''
  return `HTTP ${status}${detail ? `: ${detail}` : ''}.${hint}`
}
