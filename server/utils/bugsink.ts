import { createError } from 'h3'
import { bugsinkActionsFor, bugsinkIssueRow, bugsinkIssueStatus, type BugsinkIssue } from '#shared/errors'
import type { ErrorProvider, TrackerCredentials } from './errorTracking'

type Page<T> = { next?: string | null, results: T[] }

async function bs<T>(creds: TrackerCredentials, path: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await (creds.tenant ? safeFetch : fetch)(`${creds.api}/api/canonical/0${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${creds.token}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    })
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
    return await response.json() as T
  } catch (error) {
    console.error('[bugsink]', (error as Error).message)
    throw createError({ statusCode: 502, statusMessage: 'Bugsink is unavailable or rejected the request' })
  }
}

const cursorOf = (next?: string | null) => (next ? new URL(next).searchParams.get('cursor') || '' : '')

async function ensureTeam(creds: TrackerCredentials): Promise<string> {
  const { results } = await bs<Page<{ id: string, name: string }>>(creds, '/teams/')
  const found = results.find(row => row.name === creds.team)
  if (found) return found.id
  return (await bs<{ id: string }>(creds, '/teams/', { method: 'POST', body: JSON.stringify({ name: creds.team }) })).id
}

async function findProject(creds: TrackerCredentials, teamId: string, name: string) {
  const { results } = await bs<Page<{ id: number, name: string, dsn: string }>>(creds, `/projects/?team=${encodeURIComponent(teamId)}`)
  return results.find(row => row.name === name)
}

export const bugsink: ErrorProvider = {
  id: 'bugsink',
  name: 'Bugsink',
  manualAlerts: true,
  required: ['url', 'token'],
  envPrefix: 'BUGSINK',
  defaultTeam: 'HelpBites',

  issuesUrl({ url }, errors) {
    return errors.projectId && url ? `${url}/issues/${errors.projectId}/` : ''
  },

  // Bugsink's API cannot add alert destinations, so the webhook is shown to the
  // operator to paste into the project's alert settings instead.
  async listTeams(creds) {
    return (await bs<Page<{ name: string }>>(creds, '/teams/')).results.map(row => row.name)
  },

  async connect(creds, _project, _existing, _webhookUrl, name) {
    const teamId = await ensureTeam(creds)
    let row = await findProject(creds, teamId, name)
    if (!row) {
      await bs(creds, '/projects/', { method: 'POST', body: JSON.stringify({ team: teamId, name, alert_on_new_issue: true, alert_on_regression: true, alert_on_unmute: true }) })
      row = await findProject(creds, teamId, name)
    }
    if (!row?.dsn) throw createError({ statusCode: 502, statusMessage: 'Bugsink project has no DSN' })
    return { projectId: String(row.id), dsn: row.dsn }
  },

  async listIssues(creds, errors, input) {
    // Bugsink cannot search by Sentry user id, so a customer's own errors stay
    // empty. Status and text filters apply per page of 250 (its fixed size).
    if (!errors.projectId || input.userId) return { issues: [], next: '' }
    const params = new URLSearchParams({ project: errors.projectId, sort: 'last_seen', order: 'desc' })
    if (input.cursor) params.set('cursor', input.cursor)
    const page = await bs<Page<BugsinkIssue>>(creds, `/issues/?${params}`)
    const status = String(input.status || '')
    const search = String(input.search || '').trim().toLowerCase()
    const issues = page.results
      .filter(issue => !status || bugsinkIssueStatus(issue) === status)
      .map(issue => bugsinkIssueRow(issue, creds.url))
      .filter(issue => !search || `${issue.title} ${issue.culprit} ${issue.shortId}`.toLowerCase().includes(search))
    return { issues, next: cursorOf(page.next) }
  },

  async setIssueStatus(creds, issueId, statusKey) {
    const issue = await bs<BugsinkIssue>(creds, `/issues/${encodeURIComponent(issueId)}/`)
    for (const action of bugsinkActionsFor(issue, statusKey)) await bs(creds, `/issues/${encodeURIComponent(issueId)}/${action}/`, { method: 'POST' })
  },

  async latestEvent(creds, issueId) {
    const { results } = await bs<Page<{ id: string }>>(creds, `/events/?issue=${encodeURIComponent(issueId)}&order=desc`)
    if (!results[0]) return null
    return (await bs<{ data?: unknown }>(creds, `/events/${encodeURIComponent(results[0].id)}/`)).data || null
  },

  async issue(creds, issueId) {
    return bs(creds, `/issues/${encodeURIComponent(issueId)}/`)
  }
}
