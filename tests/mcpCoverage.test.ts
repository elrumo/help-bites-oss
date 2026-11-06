import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MCP_TOOLS } from '../server/utils/mcp/tools'

// The MCP server should do what the panel does. A route an operator uses either has a tool in
// server/utils/mcp/tools.ts (and a row in docs/MCP.md), or is listed here with the reason it stays out.
// Adding a /v1 route fails this test until one of the two is done, so the tools do not drift from the API.

const routesDir = join(import.meta.dir, '../server/routes/v1')

/** `GET /v1/admin/board-items/{}`: every route file, with its parameters unnamed. */
function allRoutes(): string[] {
  const routes: string[] = []
  for (const file of readdirSync(routesDir, { recursive: true }) as string[]) {
    const match = file.replace(/\\/g, '/').match(/^(.*?)\.(get|post|put|patch|delete)\.ts$/)
    if (!match) continue
    const parts = match[1]!.split('/')
    if (parts[parts.length - 1] === 'index') parts.pop()
    routes.push(`${match[2]!.toUpperCase()} /v1/${parts.map(part => (part.startsWith('[') ? '{}' : part)).join('/')}`)
  }
  return routes.sort()
}

const covered = new Set(MCP_TOOLS.map(tool => `${tool.method} ${tool.path.replace(/\{\w+\}/g, '{}')}`))

/** What stays out of the MCP on purpose. Each entry: the routes (`METHOD /path`, `{}` for a parameter) and why. */
const EXCLUDED: { routes: RegExp, why: string }[] = [
  // ---- access and credentials: a signed-in person does these in the panel ----
  { routes: /^(GET|POST) \/v1\/admin\/(login|logout|setup|forgot-password|reset-password)$/, why: 'Signing in, out and first-run setup.' },
  { routes: /^(GET|PATCH) \/v1\/admin\/me$/, why: 'Your own profile (email, password); get_me reads who the connection acts as.' },
  { routes: /^\w+ \/v1\/admin\/api-keys(\/\{\})?$/, why: 'API keys: a tool that mints a key would outlive the connection you can revoke.' },
  { routes: /^((GET|POST) \/v1\/admin\/oauth\/authorize|POST \/v1\/oauth\/(register|token))$/, why: 'The OAuth sign-in an assistant itself goes through.' },
  { routes: /^(POST|PATCH|DELETE) \/v1\/admin\/agents(\/\{\})?$/, why: 'Adding, re-roling and removing teammates is access control.' },
  { routes: /^(\w+ \/v1\/admin\/invitations(\/\{\})?|(GET|POST) \/v1\/invitations\/\{\}(\/accept)?)$/, why: 'Invitations give someone access to the workspace.' },
  { routes: /^(GET \/v1\/admin\/projects\/\{\}\/secret|POST \/v1\/admin\/projects\/\{\}\/rotate-secret|POST \/v1\/admin\/projects)$/, why: 'The project secret (sk_...) is shown by these, and a new project returns it.' },
  { routes: /^((GET|POST) \/v1\/admin\/workspaces|DELETE \/v1\/admin\/workspace)$/, why: 'Creating, listing and deleting workspaces: a connection is bound to one.' },
  { routes: /^((GET|PUT) \/v1\/admin\/workspace\/ai|POST \/v1\/admin\/workspace\/ai\/test)$/, why: 'AI provider keys.' },
  { routes: /^((GET|POST) \/v1\/admin\/workspace\/export|\w+ \/v1\/admin\/transfers(\/\w+)?)$/, why: 'Moving a workspace between servers.' },
  { routes: /^(POST \/v1\/admin\/devices|DELETE \/v1\/admin\/devices\/\{\})$/, why: 'Push notification tokens of a phone.' },
  { routes: /^\w+ \/v1\/admin\/telegram(\/connect)?$/, why: 'Connecting Telegram: a bot token.' },
  { routes: /^(POST \/v1\/admin\/(revenue|stripe)\/connect|DELETE \/v1\/admin\/(revenue|stripe))$/, why: 'Connecting and disconnecting revenue sources and Stripe: credentials.' },
  { routes: /^(POST \/v1\/admin\/github\/install|DELETE \/v1\/admin\/github\/installations\/\{\})$/, why: 'Connecting and disconnecting GitHub: access.' },
  { routes: /^(POST \/v1\/admin\/errors\/(connect|servers)|(PUT|DELETE) \/v1\/admin\/errors\/servers\/\{\}|GET \/v1\/admin\/errors\/servers\/\{\}\/teams)$/, why: 'Error tracker servers and connections: tokens.' },
  { routes: /^\w+ \/v1\/admin\/contact-sources(\/test|\/\{\}(\/run)?)?$/, why: 'Database connection strings.' },
  { routes: /^GET \/v1\/admin\/revenue\/sources$/, why: 'Returns the RevenueCat webhook token.' },
  { routes: /^POST \/v1\/admin\/revenue\/payments$/, why: 'Writes made-up payments into the revenue numbers.' },
  { routes: /^(GET \/v1\/admin\/stripe\/report|POST \/v1\/admin\/stripe\/sync)$/, why: 'Same as get_revenue_report and sync_revenue_source (source stripe).' },
  { routes: /^(POST \/v1\/admin\/projects\/\{\}\/(webhooks|domains|inbound-addresses)|PATCH \/v1\/admin\/projects\/\{\}\/(webhooks|domains)\/\{\}|DELETE \/v1\/admin\/projects\/\{\}\/(domains|inbound-addresses)\/\{\}|POST \/v1\/admin\/projects\/\{\}\/(domains|inbound-addresses)\/\{\}\/verify|PUT \/v1\/admin\/projects\/\{\}\/repos)$/, why: 'Where events, mail and pages go: a webhook address, a custom domain, an inbound address and which repos the AI reads are set by a person.' },
  // ---- files and streams a JSON tool cannot carry ----
  { routes: /^POST \/v1\/(admin\/(attachments|blog\/images|brand\/assets|emails\/\{\}\/image|knowledge\/imports\/upload|knowledge\/documents\/\{\}\/replace|onboarding\/images|projects\/\{\}\/logo)|attachments)$/, why: 'Multipart file uploads.' },
  { routes: /^GET \/v1\/admin\/(knowledge\/documents\/\{\}|lead-files\/\{\})\/download$/, why: 'Binary downloads.' },
  { routes: /^(GET \/v1\/(admin\/(events|emails\/\{\}\/events|emails\/\{\}\/chat\/stream|cms\/chat\/stream)|events|feedback\/events|share\/emails\/\{\}\/events)|DELETE \/v1\/admin\/cms\/chat\/stream)$/, why: 'Live event streams (SSE).' },
  { routes: /^(GET|POST|DELETE) \/v1\/admin\/cms\/chat$|^POST \/v1\/admin\/emails\/\{\}\/chat$/, why: 'The streaming AI chats of Pages and the email designer.' },
  { routes: /^POST \/v1\/admin\/(blog|brand)\/preview$/, why: 'Returns rendered HTML for the panel\'s live preview.' },
  { routes: /^(GET \/v1\/admin\/emails\/export|POST \/v1\/admin\/emails\/import)$/, why: 'Template file transfer.' },
  // ---- one-off bulk imports from other systems ----
  { routes: /^POST \/v1\/(admin\/(blog\/import|changelog\/(entries|comments|subscriptions)\/import)|feedback\/import)$/, why: 'Bulk imports from other systems.' },
  // ---- what customers and host apps use, not operators ----
  { routes: /^\w+ \/v1\/(anonymous|conversations|subscribe|tickets|track|unsubscribe|forms|onboarding|pricing)(\/.*)?$/, why: 'The chat widget, sign-ups, tickets, tracking, forms, onboarding and checkout customers use.' },
  { routes: /^(GET \/v1\/(blog|blog\/\{\}|blog\/\{\}\/comments|brand\/\{\}|changelog|changelog\/\{\}|changelog\/subscription|cms\/\{\}\/entries|cms\/\{\}\/entries\/\{\}|hub\/\{\}|hub\/\{\}\/loader|legal\/\{\}|legal\/\{\}\/\{\}|projects\/\{\}\/(blog|changelog)\.rss|projects\/\{\}\/public)|POST \/v1\/(blog\/\{\}\/reactions|changelog\/(subscribe|subscribe\/confirm|subscribe\/unsubscribe|\{\}\/comments)))$/, why: 'The public site: blog, changelog, pages, hub, legal documents, feeds and reader actions.' },
  { routes: /^(GET|PUT) \/v1\/feedback\/(preferences|\{\}\/subscription)$|^POST \/v1\/feedback\/(\{\}\/(vote|reactions)|\{\}\/comments\/\{\}\/reactions)$/, why: 'Votes, reactions and subscriptions made as a customer.' },
  { routes: /^(DELETE \/v1\/(end-users|messages)\/\{\}|POST \/v1\/messages\/\{\}\/reactions|(GET|PATCH) \/v1\/share\/emails\/\{\})$/, why: 'Server-to-server erasure, a customer unsending or reacting to a message, and the public email share link.' },
  { routes: /^(POST \/v1\/webhooks\/(github|mailgun|mailgun-inbound|bugsink\/\{\}|glitchtip\/\{\}|revenuecat\/\{\})|GET \/v1\/(health|health\/live|meta|internal\/domain-check|github\/callback|exports\/\{\}|flags|unread)|POST \/v1\/internal\/embeddings)$/, why: 'Webhook receivers, health, deployment info and internal routes.' },
  { routes: /^(GET \/v1\/(email-logs|email-logs\/\{\}|email-suppressions|emails)|POST \/v1\/email-suppressions|DELETE \/v1\/email-suppressions\/\{\})$/, why: 'Project-key twins of /v1/admin routes that have a tool.' }
]

describe('MCP coverage', () => {
  const routes = allRoutes()
  const excluded = (route: string) => EXCLUDED.find(entry => entry.routes.test(route))

  test('every route is a tool or is left out on purpose', () => {
    const missing = routes.filter(route => !covered.has(route) && !excluded(route))
    expect(missing, `Give these routes an MCP tool in server/utils/mcp/tools.ts (and a row in docs/MCP.md), or list them in EXCLUDED in tests/mcpCoverage.test.ts with the reason:\n${missing.join('\n')}`).toEqual([])
  })

  test('the exclusions are current', () => {
    // An entry that matches nothing, or only routes that have a tool, is a leftover.
    const stale = EXCLUDED.filter(entry => !routes.some(route => entry.routes.test(route) && !covered.has(route))).map(entry => String(entry.routes))
    expect(stale, 'These exclusions match no route without a tool: remove them').toEqual([])
  })
})
