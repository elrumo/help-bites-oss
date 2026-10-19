import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createError, getQuery, type H3Event } from 'h3'
import { applyTrackerSettings, pickTrackerSettings, type TrackerSettings, type TrackerSettingsKey } from '#shared/errors'
import { bugsink } from './bugsink'
import { glitchtip } from './glitchtip'

export type ErrorProviderId = 'glitchtip' | 'bugsink'
/** Stored on the Project as `errors`. Rows from before Bugsink support have no `provider` and are GlitchTip;
 * rows from before in-app settings have no `issuesUrl` and build it from the env. */
export type ErrorConfig = { provider?: ErrorProviderId, slug?: string, projectId?: string, dsn?: string, alertId?: string, webhookToken?: string, issuesUrl?: string, serverId?: string }
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
  connect(creds: TrackerCredentials, project: ParseObject, existing: ErrorConfig, webhookUrl: string): Promise<ErrorConfig>
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

async function trackerCredentials(provider: ErrorProvider, project: ParseObject): Promise<TrackerCredentials> {
  const errors = errorConfigOf(project)
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
  const using = projects.filter((project) => {
    const errors = errorConfigOf(project)
    return errors.dsn && (errors.serverId ? errors.serverId === id : id === `legacy-${server.provider}` && providerOf(errors).id === server.provider)
  })
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

/** Connects a project to one of its workspace's servers. Older clients name only a tracker: its first server is used. */
export async function connectErrorTracking(project: ParseObject, target: { serverId?: string, providerId?: ErrorProviderId }): Promise<ErrorConfig> {
  const servers = [...await workspaceServers(pointerId(project.get('workspace'))), ...envServers()]
  const server = servers.find(item => target.serverId ? item.id === target.serverId : item.provider === target.providerId)
  if (!server) throw createError({ statusCode: target.serverId ? 404 : 501, statusMessage: target.serverId ? 'Error tracking server not found' : 'That tracker is not set up. Add a server first.' })
  const provider = providers[server.provider]
  const existing = errorConfigOf(project)
  if (existing.dsn) {
    if (providerOf(existing).id === provider.id && (!existing.serverId || existing.serverId === server.id)) return existing
    throw createError({ statusCode: 409, statusMessage: `This project is already connected to ${providerOf(existing).name}` })
  }
  const creds = serverCredentials(server)
  const draft: ErrorConfig = { provider: provider.id, serverId: server.id, webhookToken: existing.webhookToken || randomBytes(32).toString('hex') }
  const connected = await provider.connect(creds, project, existing, errorWebhookUrl(project, draft))
  const errors = { ...draft, ...connected, issuesUrl: provider.issuesUrl(creds, connected) }
  project.set('errors', errors)
  await project.save(null, MASTER)
  return errors
}

export async function listIssues(project: ParseObject, input: IssueListInput) {
  const errors = errorConfigOf(project)
  if (!errors.dsn) return { issues: [], next: '' }
  const provider = providerOf(errors)
  return provider.listIssues(await trackerCredentials(provider, project), errors, input)
}

/** Conversations created from alerts are keyed by provider so two trackers never collide. */
export function errorConversationKey(providerId: ErrorProviderId, issueId: string): string {
  return `${providerId}:${issueId}`
}

/** Checks the per-project token embedded in the alert webhook URL. An unknown project gets the same 401, so the URL tells nobody which project ids exist. */
export function verifyErrorWebhook(event: H3Event, project: ParseObject | null, providerId: ErrorProviderId): ParseObject {
  const errors: ErrorConfig = project ? errorConfigOf(project) : {}
  const expected = String(errors.webhookToken || '')
  const supplied = String(getQuery(event).token || '')
  if (!project || !expected || (errors.provider || 'glitchtip') !== providerId || expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw createError({ statusCode: 401, statusMessage: 'Invalid webhook token' })
  return project
}

export async function setErrorIssueStatus(project: ParseObject, providerId: ErrorProviderId, issueId: string, statusKey: string): Promise<void> {
  const provider = providers[providerId]
  await provider.setIssueStatus(await trackerCredentials(provider, project), issueId, statusKey)
}

export async function latestErrorEvent(project: ParseObject, providerId: ErrorProviderId, issueId: string): Promise<unknown> {
  const provider = providers[providerId]
  return provider.latestEvent(await trackerCredentials(provider, project), issueId)
}
