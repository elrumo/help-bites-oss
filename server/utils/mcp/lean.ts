// The lean toolset (`/mcp?tools=lean`). Listing every tool puts all of their definitions (~90k tokens) into the assistant's
// context before it has done anything, on every conversation. The lean list is three tools instead: one looks a tool up
// (and returns its definition), two run one. Reads and writes are separate tools so a client that auto-approves read-only
// tools still does, and still asks before a write.

import { describeTool, MCP_TOOLS, type McpTool } from './tools'

export const LEAN_INSTRUCTIONS = 'Tools are looked up, not listed: call find_tools with a few words (for example "board item" or "reply conversation") to get matching tools with their arguments, then run one with call_read_tool (reads) or call_write_tool (changes anything). find_tools with no query lists every tool name.'

const nameArgument = { type: 'string', description: 'The tool\'s name, from find_tools.' }
const argumentsArgument = { type: 'object', description: 'The tool\'s arguments, as find_tools described them.' }

const LEAN = [
  {
    name: 'find_tools', title: 'Find a tool', readOnly: true,
    description: 'Looks up tools by what they do and returns their definitions (name, what it does, arguments). With no query, lists every tool name.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'A few words, or a tool name. Left out: every name.' }, limit: { type: 'integer', maximum: 20, description: 'How many to return. Default 6.' } }, additionalProperties: false }
  },
  {
    name: 'call_read_tool', title: 'Run a read-only tool', readOnly: true,
    description: 'Runs a tool found with find_tools that only reads (its definition says readOnly). Refuses any that changes something.',
    inputSchema: { type: 'object', properties: { name: nameArgument, arguments: argumentsArgument }, required: ['name'], additionalProperties: false }
  },
  {
    name: 'call_write_tool', title: 'Run a tool that changes something', readOnly: false,
    description: 'Runs a tool found with find_tools that creates, changes, sends, publishes or deletes. Confirm wording with the user before anything reaches customers.',
    inputSchema: { type: 'object', properties: { name: nameArgument, arguments: argumentsArgument }, required: ['name'], additionalProperties: false }
  }
] as const

export const LEAN_NAMES: ReadonlySet<string> = new Set(LEAN.map(tool => tool.name))

/** `readOnly`: a read-only connection is offered the tools that read and no others. */
export function leanTools(readOnly: boolean) {
  return LEAN.filter(tool => !readOnly || tool.readOnly).map(tool => ({
    ...tool,
    annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly, openWorldHint: false }
  }))
}

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** How well a tool answers a query: its name counts most, then its title, then its description. */
function score(tool: McpTool, query: string, terms: string[]): number {
  if (tool.name === query) return 1000
  const name = words(tool.name), title = words(tool.title), description = words(tool.description)
  let total = 0
  for (const term of terms) {
    if (name.some(word => word === term || word.startsWith(term))) total += 4
    if (title.some(word => word.startsWith(term))) total += 2
    if (description.includes(term)) total += 1
  }
  return total
}

/** The answer to find_tools: a list of names, or the best matches with their full definitions. */
export function findTools(args: Record<string, unknown>, readOnly: boolean): string {
  const pool = readOnly ? MCP_TOOLS.filter(tool => tool.readOnly) : MCP_TOOLS
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
  if (!query) return JSON.stringify({ tools: pool.map(tool => tool.name).join(' ') })
  const terms = words(query)
  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 20)
  const ranked = pool.map(tool => ({ tool, points: score(tool, query, terms) })).filter(match => match.points > 0).sort((a, b) => b.points - a.points || a.tool.name.localeCompare(b.tool.name))
  if (!ranked.length) return `No tool matches "${query}". Call find_tools with no query for every name.`
  const shown = ranked.slice(0, limit).map(({ tool }) => {
    const { inputSchema } = describeTool(tool)
    return { name: tool.name, ...(tool.readOnly ? { readOnly: true } : {}), description: tool.description, inputSchema }
  })
  return JSON.stringify({ tools: shown, ...(ranked.length > limit ? { more: `${ranked.length - limit} more match: raise limit or narrow the query` } : {}) })
}

/** The tool a call_read_tool / call_write_tool call names, or a sentence saying why not. */
export function resolveLeanCall(wrapper: string, params: Record<string, unknown>): { tool: McpTool, arguments: unknown } | { error: string } {
  const tool = MCP_TOOLS.find(candidate => candidate.name === params.name)
  if (!tool) return { error: `Unknown tool: ${String(params.name)}. Use find_tools to look it up.` }
  if (wrapper === 'call_read_tool' && !tool.readOnly) return { error: `${tool.name} changes something: run it with call_write_tool.` }
  return { tool, arguments: params.arguments }
}
