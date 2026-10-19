import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createError, getQuery, type H3Event } from 'h3'
import { applyTrackerSettings, pickTrackerSettings, type TrackerSettings, type TrackerSettingsKey, type TrackerSource } from '#shared/errors'
import { bugsink } from './bugsink'
import { glitchtip } from './glitchtip'

export type ErrorProviderId = 'glitchtip' | 'bugsink'
/** Stored on the Project as `errors`. Rows from before Bugsink support have no `provider` and are GlitchTip;
 * rows from before in-app settings have no `issuesUrl` and build it from the env. */
export type ErrorConfig = { provider?: ErrorProviderId, slug?: string, projectId?: string, dsn?: string, alertId?: string, webhookToken?: string, issuesUrl?: string }
export type IssueListInput = { status?: string, userId?: string, search?: string, cursor?: string, limit?: number }
/** What a provider talks to: requests go to `api`, people open `url`. */
export type TrackerCredentials = { url: string, api: string, token: string, org: string, team: string, /** Typed in by a workspace (not the server's env): fetched through the outbound guard. */ tenant?: boolean }
type SettingsByProvider = Partial<Record<ErrorProviderId, TrackerSettings>>

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
/** Settings for every project of a workspace live in its `settings`; a project's own override on the Project. */
const CONFIG_KEY = 'errorTrackers'

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

/** The "every project" layer: the workspace's own settings (API scope `global`). */
async function workspaceSettings(workspaceId: string): Promise<SettingsByProvider> {
  const workspace = await getWorkspace(workspaceId)
  return ((workspace?.get('settings') as Record<string, unknown> | undefined)?.[CONFIG_KEY] || {}) as SettingsByProvider
}

function projectSettings(project?: ParseObject | null): SettingsByProvider {
  return (project?.get(CONFIG_KEY) || {}) as SettingsByProvider
}

function envSettings(provider: ErrorProvider): TrackerSettings {
  const env = (key: string) => String(process.env[`${provider.envPrefix}_${key}`] || '').trim()
  return { url: env('URL'), apiUrl: env('API_URL'), token: env('TOKEN'), org: env('ORG') }
}

/** Project, then workspace, then (where the edition shares one tracker with everyone) the server's env. */
function layers(provider: ErrorProvider, project: ParseObject | null | undefined, global: SettingsByProvider): Array<[TrackerSource, TrackerSettings | undefined]> {
  const out: Array<[TrackerSource, TrackerSettings | undefined]> = [['project', projectSettings(project)[provider.id]], ['global', global[provider.id]]]
  if (edition().policy.trackerEnvFallback) out.push(['env', envSettings(provider)])
  return out
}

function credentialsFrom(provider: ErrorProvider, settings: TrackerSettings): TrackerCredentials {
  const url = String(settings.url || '').trim().replace(/\/+$/, '')
  return { url, api: String(settings.apiUrl || url).trim().replace(/\/+$/, ''), token: String(settings.token || '').trim(), org: String(settings.org || '').trim(), team: String(process.env[`${provider.envPrefix}_TEAM`] || provider.defaultTeam).trim() }
}

async function trackerCredentials(provider: ErrorProvider, project: ParseObject): Promise<TrackerCredentials> {
  const hit = pickTrackerSettings(provider.required, layers(provider, project, await workspaceSettings(pointerId(project.get('workspace')))))
  if (!hit) throw createError({ statusCode: 501, statusMessage: `${provider.name} isn't set up. Add its URL and API token in Connect error tracking.` })
  // A URL a workspace typed in is reached through the outbound guard; the server's own (env) is trusted.
  return { ...credentialsFrom(provider, hit.settings), tenant: hit.source !== 'env' }
}

/** Non-secret view of each scope's settings; tokens only report whether one is saved. */
export async function listErrorProviders(workspaceId: string, project?: ParseObject | null) {
  const global = await workspaceSettings(workspaceId)
  const view = (settings?: TrackerSettings) => settings?.url ? { url: settings.url, apiUrl: settings.apiUrl || '', org: settings.org || '', hasToken: Boolean(settings.token) } : null
  return Object.values(providers).map((provider) => {
    const hit = pickTrackerSettings(provider.required, layers(provider, project, global))
    return {
      id: provider.id, name: provider.name, manualAlerts: Boolean(provider.manualAlerts), required: provider.required,
      configured: Boolean(hit), source: hit?.source || '',
      missing: hit ? [] : provider.required.map(key => `${provider.envPrefix}_${key.toUpperCase()}`),
      settings: { project: view(projectSettings(project)[provider.id]), global: view(global[provider.id]) }
    }
  })
}

/** Saves the settings form for one project, or for every project of the workspace when `project` is null. */
export async function saveTrackerSettings(providerId: ErrorProviderId, workspace: ParseObject, project: ParseObject | null, input: Record<string, unknown>): Promise<void> {
  const all = project ? projectSettings(project) : await workspaceSettings(workspace.id || '')
  const { settings, error } = applyTrackerSettings(all[providerId], input, providers[providerId].required)
  if (error) throw createError({ statusCode: 400, statusMessage: error })
  const next: SettingsByProvider = { ...all, [providerId]: settings || undefined }
  if (!settings) delete next[providerId]
  if (project) {
    project.set(CONFIG_KEY, next)
    await project.save(null, MASTER)
  } else {
    workspace.set('settings', { ...(workspace.get('settings') as Record<string, unknown> || {}), [CONFIG_KEY]: next })
    await workspace.save(null, MASTER)
    await invalidate('workspace', workspace.id || '')
  }
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

export async function connectErrorTracking(project: ParseObject, providerId: ErrorProviderId): Promise<ErrorConfig> {
  const provider = providers[providerId]
  const existing = errorConfigOf(project)
  if (existing.dsn && (existing.provider || 'glitchtip') === providerId) return existing
  if (existing.dsn) throw createError({ statusCode: 409, statusMessage: `This project is already connected to ${providerOf(existing).name}` })
  const creds = await trackerCredentials(provider, project)
  const draft: ErrorConfig = { provider: providerId, webhookToken: existing.webhookToken || randomBytes(32).toString('hex') }
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

/** Checks the per-project token embedded in the alert webhook URL. */
export function verifyErrorWebhook(event: H3Event, project: ParseObject, providerId: ErrorProviderId): void {
  const errors = errorConfigOf(project)
  const expected = String(errors.webhookToken || '')
  const supplied = String(getQuery(event).token || '')
  if (!expected || (errors.provider || 'glitchtip') !== providerId || expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw createError({ statusCode: 401, statusMessage: 'Invalid webhook token' })
}

export async function setErrorIssueStatus(project: ParseObject, providerId: ErrorProviderId, issueId: string, statusKey: string): Promise<void> {
  const provider = providers[providerId]
  await provider.setIssueStatus(await trackerCredentials(provider, project), issueId, statusKey)
}

export async function latestErrorEvent(project: ParseObject, providerId: ErrorProviderId, issueId: string): Promise<unknown> {
  const provider = providers[providerId]
  return provider.latestEvent(await trackerCredentials(provider, project), issueId)
}
