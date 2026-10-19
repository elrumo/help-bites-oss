import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createError, getQuery, type H3Event } from 'h3'
import { applyTrackerSettings, pickTrackerSettings, type TrackerSettings, type TrackerSettingsKey } from '#shared/errors'
import { bugsink } from './bugsink'
import { glitchtip } from './glitchtip'

export type ErrorProviderId = 'glitchtip' | 'bugsink'
/** Stored on the Project as `errors`, which is its first tracker project; further ones are in `more`. Rows from before Bugsink
 * support have no `provider` and are GlitchTip; rows from before in-app settings have no `issuesUrl` and build it from the env.
 * `label` is the project's name in the tracker, shown as a pill; `linkId` is set on `more` entries (the first one is `main`). */
export type ErrorConfig = { provider?: ErrorProviderId, slug?: string, projectId?: string, dsn?: string, alertId?: string, webhookToken?: string, issuesUrl?: string, serverId?: string, label?: string, linkId?: string, more?: ErrorConfig[] }
export type ErrorLinkView = { id: string, label: string, provider: ErrorProviderId, providerName: string, dsn: string, url: string, alertWebhookUrl: string }
export const MAIN_LINK = 'main'
export type IssueListInput = { status?: string, userId?: string, search?: string, cursor?: string, limit?: number }
/** What a provider talks to: requests go to `api`, people open `url`. */
export type TrackerCredentials = { url: string, api: string, token: string, org: string, team: string, /** Typed in by a workspace (not the server's env): fetched through the outbound guard. */ tenant?: boolean }
type SettingsByProvider = Partial<Record<ErrorProviderId, TrackerSettings>>
/** A tracker a workspace has connected: shared by all its projects, each of which picks one. `env-*` ids are the server's own env, read-only. */
export type ErrorServer = TrackerSettings & { id: string, provider: ErrorProviderId, name: string }

export interface ErrorProvider {
  id: ErrorProviderId
  name: string
  /** True when alerts must be pointed at HelpBites by hand in the tracker. */
  manualAlerts?: boolean
  /** Settings it can't run without. Each also reads from the env as `${envPrefix}_${KEY}`. */
  required: TrackerSettingsKey[]
  envPrefix: string
  defaultTeam: string
  issuesUrl(creds: TrackerCredentials, errors: ErrorConfig): string
  /** Teams a new project can be created under, when the tracker has them to choose from. */
  listTeams?(creds: TrackerCredentials): Promise<string[]>
  /** `name` is the tracker project to create or reuse. */
  connect(creds: TrackerCredentials, project: ParseObject, existing: ErrorConfig, webhookUrl: string, name: string): Promise<ErrorConfig>
  listIssues(creds: TrackerCredentials, errors: ErrorConfig, input: IssueListInput): Promise<{ issues: Array<Record<string, any> & { id: string }>, next: string }>
  setIssueStatus(creds: TrackerCredentials, issueId: string, statusKey: string): Promise<void>
  latestEvent(creds: TrackerCredentials, issueId: string): Promise<unknown>
}

const providers: Record<ErrorProviderId, ErrorProvider> = { glitchtip, bugsink }
/** A workspace's servers live in its `settings`. Before servers were a list it held one tracker per provider under `errorTrackers`. */
const SERVERS_KEY = 'errorServers'
const LEGACY_KEY = 'errorTrackers'

export function isErrorProvider(value: unknown): value is ErrorProviderId {
  return typeof value === 'string' && value in providers
}

export function errorProvider(id: ErrorProviderId): ErrorProvider {
  return providers[id]
}

export function errorConfigOf(project: ParseObject): ErrorConfig {
  return (project.get('errors') || {}) as ErrorConfig
}

export function providerOf(errors: ErrorConfig): ErrorProvider {
  return providers[errors.provider || 'glitchtip']
}

/** Every tracker project this HelpBites project reports to, the first as `main`. */
export function errorLinksOf(project: ParseObject): ErrorConfig[] {
  const { more = [], ...main } = errorConfigOf(project)
  const name = String(project.get('name') || '')
  return [...(main.dsn ? [{ ...main, linkId: MAIN_LINK, label: main.label || name }] : []), ...more.filter(link => link.dsn).map(link => ({ ...link, label: link.label || name }))]
}

/** One link by id; without (or with an unknown) id, the first. */
export function errorLinkOf(project: ParseObject, linkId = ''): ErrorConfig | undefined {
  const links = errorLinksOf(project)
  return links.find(link => link.linkId === linkId) || links[0]
}

export function errorLinkView(project: ParseObject, link: ErrorConfig): ErrorLinkView {
  const provider = providerOf(link)
  return { id: link.linkId || MAIN_LINK, label: link.label || '', provider: provider.id, providerName: provider.name, dsn: String(link.dsn || ''), url: issuesUrlOf(link), alertWebhookUrl: provider.manualAlerts ? errorWebhookUrl(project, link) : '' }
}

const isComplete = (provider: ErrorProvider, settings?: TrackerSettings) => Boolean(pickTrackerSettings(provider.required, [['project', settings]]))
const isEnvServer = (server: ErrorServer) => server.id.startsWith('env-')

async function workspaceServers(workspaceId: string): Promise<ErrorServer[]> {
  const settings = ((await getWorkspace(workspaceId))?.get('settings') || {}) as Record<string, any>
  if (Array.isArray(settings[SERVERS_KEY])) return settings[SERVERS_KEY]
  return Object.values(providers).flatMap(provider => isComplete(provider, settings[LEGACY_KEY]?.[provider.id]) ? [{ ...settings[LEGACY_KEY][provider.id], id: `legacy-${provider.id}`, provider: provider.id, name: provider.name }] : [])
}

function envSettings(provider: ErrorProvider): TrackerSettings {
  const env = (key: string) => String(process.env[`${provider.envPrefix}_${key}`] || '').trim()
  return { url: env('URL'), apiUrl: env('API_URL'), token: env('TOKEN'), org: env('ORG') }
}

/** The server's own GLITCHTIP_* / BUGSINK_* env, offered to every workspace where the edition shares one tracker. */
function envServers(): ErrorServer[] {
  if (!edition().policy.trackerEnvFallback) return []
  return Object.values(providers).flatMap(provider => isComplete(provider, envSettings(provider)) ? [{ ...envSettings(provider), id: `env-${provider.id}`, provider: provider.id, name: `${provider.name} (this server)` }] : [])
}

function credentialsFrom(provider: ErrorProvider, settings: TrackerSettings): TrackerCredentials {
  const url = String(settings.url || '').trim().replace(/\/+$/, '')
  return { url, api: String(settings.apiUrl || url).trim().replace(/\/+$/, ''), token: String(settings.token || '').trim(), org: String(settings.org || '').trim(), team: String(process.env[`${provider.envPrefix}_TEAM`] || provider.defaultTeam).trim() }
}

// A URL a workspace typed in is reached through the outbound guard; the server's own (env) is trusted.
const serverCredentials = (server: ErrorServer): TrackerCredentials => ({ ...credentialsFrom(providers[server.provider], server), tenant: !isEnvServer(server) })

async function trackerCredentials(provider: ErrorProvider, project: ParseObject, errors: ErrorConfig): Promise<TrackerCredentials> {
  const servers = [...await workspaceServers(pointerId(project.get('workspace'))), ...envServers()]
  if (errors.serverId) {
    const server = servers.find(item => item.id === errors.serverId)
    if (!server) throw createError({ statusCode: 501, statusMessage: 'The error tracking server this project uses was removed.' })
    return serverCredentials(server)
  }
  // Connected before servers were a list: its own settings, then the workspace's tracker, then the env.
  const own = projectSettings(project)[provider.id]
  const server = isComplete(provider, own) ? { ...own, id: 'project', provider: provider.id, name: provider.name } : servers.find(item => item.id === `legacy-${provider.id}`) || servers.find(item => item.id === `env-${provider.id}`)
  if (!server) throw createError({ statusCode: 501, statusMessage: `${provider.name} isn't set up. Add a server in Connect error tracking.` })
  return serverCredentials(server as ErrorServer)
}

function projectSettings(project?: ParseObject | null): SettingsByProvider {
  return (project?.get(LEGACY_KEY) || {}) as SettingsByProvider
}

/** Non-secret view of every server a project in this workspace can report to; tokens only report whether one is saved. */
export async function listErrorServers(workspaceId: string) {
  const view = (server: ErrorServer) => ({ id: server.id, provider: server.provider, providerName: providers[server.provider].name, name: server.name, url: server.url || '', apiUrl: server.apiUrl || '', org: server.org || '', hasToken: Boolean(server.token), builtIn: isEnvServer(server) })
  return [...await workspaceServers(workspaceId), ...envServers()].map(view)
}

export function errorProviderInfo() {
  return Object.values(providers).map(({ id, name, required, manualAlerts }) => ({ id, name, required, manualAlerts: Boolean(manualAlerts) }))
}

/** Which trackers have a server (older clients pick a tracker, not a server). */
export async function listErrorProviders(workspaceId: string) {
  const servers = await listErrorServers(workspaceId)
  return Object.values(providers).map(provider => ({
    id: provider.id, name: provider.name, manualAlerts: Boolean(provider.manualAlerts), required: provider.required,
    configured: servers.some(server => server.provider === provider.id), missing: [] as string[]
  }))
}

/** Adds a server, or with `id` changes one (a blank token keeps the saved one while the URLs are unchanged). */
export async function saveErrorServer(workspace: ParseObject, input: Record<string, unknown>, id = ''): Promise<string> {
  const servers = await workspaceServers(workspace.id || '')
  const existing = id ? servers.find(server => server.id === id) : undefined
  if (id && !existing) throw createError({ statusCode: 404, statusMessage: 'Error tracking server not found' })
  const providerId = existing?.provider || input.provider
  if (!isErrorProvider(providerId)) throw createError({ statusCode: 400, statusMessage: 'Unknown error tracker' })
  const { settings, error } = applyTrackerSettings(existing, input, providers[providerId].required)
  if (error || !settings) throw createError({ statusCode: 400, statusMessage: error || 'Enter the tracker URL' })
  const server: ErrorServer = { ...settings, id: existing?.id || randomBytes(6).toString('hex'), provider: providerId, name: String(input.name || '').trim().slice(0, 60) || new URL(settings.url!).host }
  workspace.set('settings', { ...(workspace.get('settings') as Record<string, unknown> || {}), [SERVERS_KEY]: existing ? servers.map(item => item.id === id ? server : item) : [...servers, server] })
  await workspace.save(null, MASTER)
  await invalidate('workspace', workspace.id || '')
  return server.id
}

export async function deleteErrorServer(workspace: ParseObject, id: string): Promise<void> {
  const servers = await workspaceServers(workspace.id || '')
  const server = servers.find(item => item.id === id)
  if (!server) throw createError({ statusCode: 404, statusMessage: 'Error tracking server not found' })
  const projects = await new (useParse()).Query('Project').equalTo('workspace', workspace).exists('errors').limit(1000).find(MASTER)
  const using = projects.filter(project => errorLinksOf(project).some(errors => errors.serverId ? errors.serverId === id : id === `legacy-${server.provider}` && providerOf(errors).id === server.provider))
  if (using.length) throw createError({ statusCode: 409, statusMessage: `${using.length} project${using.length === 1 ? ' reports' : 's report'} to this server. Remove ${using.length === 1 ? 'its' : 'their'} error tracking first.` })
  workspace.set('settings', { ...(workspace.get('settings') as Record<string, unknown> || {}), [SERVERS_KEY]: servers.filter(item => item.id !== id) })
  await workspace.save(null, MASTER)
  await invalidate('workspace', workspace.id || '')
}

export function issuesUrlOf(errors: ErrorConfig): string {
  if (errors.issuesUrl || !errors.dsn) return errors.issuesUrl || ''
  const provider = providerOf(errors)
  return provider.issuesUrl(credentialsFrom(provider, envSettings(provider)), errors)
}

export function errorWebhookUrl(project: ParseObject, errors: ErrorConfig): string {
  const base = String(process.env.ERRORS_WEBHOOK_BASE || process.env.GLITCHTIP_WEBHOOK_BASE || process.env.APP_URL || '').trim().replace(/\/+$/, '')
  return base && errors.webhookToken ? `${base}/v1/webhooks/${errors.provider || 'glitchtip'}/${project.id}?token=${errors.webhookToken}` : ''
}

/** Teams a project can be created under on a server, and the one used when none is picked. */
export async function listErrorTeams(workspaceId: string, serverId: string) {
  const server = [...await workspaceServers(workspaceId), ...envServers()].find(item => item.id === serverId)
  if (!server) throw createError({ statusCode: 404, statusMessage: 'Error tracking server not found' })
  const creds = serverCredentials(server)
  const teams = await providers[server.provider].listTeams?.(creds) || []
  return { default: creds.team, teams: teams.includes(creds.team) ? teams : [creds.team, ...teams] }
}

/** Connects a project to one of its workspace's servers; more than once adds another tracker project (`name`) next to the first.
 * Older clients name only a tracker: its first server is used. `team` overrides the tracker's default team. */
export async function connectErrorTracking(project: ParseObject, target: { serverId?: string, providerId?: ErrorProviderId, team?: string, name?: string }): Promise<ErrorConfig> {
  const servers = [...await workspaceServers(pointerId(project.get('workspace'))), ...envServers()]
  const server = servers.find(item => target.serverId ? item.id === target.serverId : item.provider === target.providerId)
  if (!server) throw createError({ statusCode: target.serverId ? 404 : 501, statusMessage: target.serverId ? 'Error tracking server not found' : 'That tracker is not set up. Add a server first.' })
  const provider = providers[server.provider]
  const name = target.name?.trim().slice(0, 100) || String(project.get('name') || `hb-${project.id}`)
  const links = errorLinksOf(project)
  const same = links.find(link => providerOf(link).id === provider.id && (!link.serverId || link.serverId === server.id) && link.label === name)
  if (same) return same
  const creds = { ...serverCredentials(server), team: target.team?.trim().slice(0, 100) || serverCredentials(server).team }
  const draft: ErrorConfig = { provider: provider.id, serverId: server.id, webhookToken: randomBytes(32).toString('hex') }
  const connected = await provider.connect(creds, project, {}, errorWebhookUrl(project, draft), name)
  const link: ErrorConfig = { ...draft, ...connected, label: name, issuesUrl: provider.issuesUrl(creds, connected) }
  const main = errorConfigOf(project)
  if (!links.length) project.set('errors', { ...link, more: main.more || [] })
  else project.set('errors', { ...main, more: [...(main.more || []), { ...link, linkId: randomBytes(4).toString('hex') }] })
  await project.save(null, MASTER)
  return errorLinksOf(project).find(item => item.webhookToken === link.webhookToken)!
}

export type ErrorIssue = Record<string, any> & { id: string, provider: ErrorProviderId, providerName: string, linkId: string, linkLabel: string }

/** One link's issues, or with no `linkId` every link's first page merged newest first. ponytail: no cursor across links, so "all" shows each one's first page; pick a link to page further. */
export async function listIssues(project: ParseObject, input: IssueListInput, linkId = ''): Promise<{ issues: ErrorIssue[], next: string }> {
  const one = linkId ? errorLinkOf(project, linkId) : undefined
  const links = one ? [one] : errorLinksOf(project)
  const pages = await Promise.all(links.map(async (link) => {
    const provider = providerOf(link)
    const page = await provider.listIssues(await trackerCredentials(provider, project, link), link, input)
    return { next: page.next, issues: page.issues.map((issue): ErrorIssue => ({ ...issue, provider: provider.id, providerName: provider.name, linkId: link.linkId || MAIN_LINK, linkLabel: link.label || '' })) }
  }))
  const issues = pages.flatMap(page => page.issues)
  return { issues: links.length > 1 ? issues.sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || ''))) : issues, next: links.length === 1 ? pages[0]?.next || '' : '' }
}

/** Conversations created from alerts are keyed by provider so two trackers never collide. */
export function errorConversationKey(providerId: ErrorProviderId, issueId: string): string {
  return `${providerId}:${issueId}`
}

/** Checks the per-link token embedded in the alert webhook URL and returns the link it belongs to. An unknown project gets the same 401, so the URL tells nobody which project ids exist. */
export function verifyErrorWebhook(event: H3Event, project: ParseObject | null, providerId: ErrorProviderId): { project: ParseObject, link: ErrorConfig } {
  const supplied = Buffer.from(String(getQuery(event).token || ''))
  const link = project && errorLinksOf(project).find((item) => {
    const expected = Buffer.from(String(item.webhookToken || ''))
    return expected.length > 0 && providerOf(item).id === providerId && expected.length === supplied.length && timingSafeEqual(expected, supplied)
  })
  if (!project || !link) throw createError({ statusCode: 401, statusMessage: 'Invalid webhook token' })
  return { project, link }
}

async function linkCredentials(project: ParseObject, providerId: ErrorProviderId, linkId: string) {
  const provider = providers[providerId]
  const link = errorLinkOf(project, linkId)
  if (!link) throw createError({ statusCode: 404, statusMessage: 'Error tracking is not connected' })
  return { provider, creds: await trackerCredentials(provider, project, link) }
}

export async function setErrorIssueStatus(project: ParseObject, providerId: ErrorProviderId, issueId: string, statusKey: string, linkId = ''): Promise<void> {
  const { provider, creds } = await linkCredentials(project, providerId, linkId)
  await provider.setIssueStatus(creds, issueId, statusKey)
}

export async function latestErrorEvent(project: ParseObject, providerId: ErrorProviderId, issueId: string, linkId = ''): Promise<unknown> {
  const { provider, creds } = await linkCredentials(project, providerId, linkId)
  return provider.latestEvent(creds, issueId)
}
