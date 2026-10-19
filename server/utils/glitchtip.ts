import { createError } from 'h3'
import { glitchtipStatusFor, issueQuery } from '#shared/errors'
import type { ErrorConfig, ErrorProvider, TrackerCredentials } from './errorTracking'

async function gt<T>(creds: TrackerCredentials, path: string, options: RequestInit = {}): Promise<{ data: T, headers: Headers }> {
  try {
    const response = await (creds.tenant ? safeFetch : fetch)(`${creds.api}/api/0${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${creds.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    })
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
    return { data: await response.json() as T, headers: response.headers }
  } catch (error) {
    console.error('[glitchtip]', (error as Error).message)
    throw createError({ statusCode: 502, statusMessage: 'GlitchTip is unavailable or rejected the request' })
  }
}

async function ensureTeam(creds: TrackerCredentials): Promise<void> {
  const { org, team } = creds
  const { data: teams } = await gt<Array<{ slug?: string }>>(creds, `/organizations/${encodeURIComponent(org)}/teams/`)
  if (teams.some(row => row.slug === team)) return
  await gt(creds, `/organizations/${encodeURIComponent(org)}/teams/`, { method: 'POST', body: JSON.stringify({ slug: team, name: team }) })
}

export const glitchtip: ErrorProvider = {
  id: 'glitchtip',
  name: 'GlitchTip',
  required: ['url', 'token', 'org'],
  envPrefix: 'GLITCHTIP',
  defaultTeam: 'helpbites',

  issuesUrl({ url, org }, errors) {
    return errors.slug && url ? `${url}/${org}/issues` : ''
  },

  async connect(creds, project, existing, webhookUrl) {
    const { org, team } = creds
    await ensureTeam(creds)
    // GlitchTip derives the slug from the name and ignores one sent on create,
    // so reuse the team's project with this name or take the slug it returns.
    const name = String(project.get('name') || `hb-${project.id}`)
    const path = `/teams/${encodeURIComponent(org)}/${encodeURIComponent(team)}/projects/`
    const { data: projects } = await gt<Array<{ slug: string, name: string }>>(creds, path)
    const slug = projects.find(row => row.name === name)?.slug || (await gt<{ slug: string }>(creds, path, { method: 'POST', body: JSON.stringify({ name }) })).data.slug
    const { data: keys } = await gt<Array<{ dsn?: { public?: string } }>>(creds, `/projects/${encodeURIComponent(org)}/${encodeURIComponent(slug)}/keys/`)
    const dsn = keys[0]?.dsn?.public || ''
    if (!dsn) throw createError({ statusCode: 502, statusMessage: 'GlitchTip project has no public DSN' })
    let alertId = existing.alertId || ''
    if (!alertId && webhookUrl) {
      const { data: rule } = await gt<{ id?: string }>(creds, `/projects/${encodeURIComponent(org)}/${encodeURIComponent(slug)}/alerts/`, {
        method: 'POST', body: JSON.stringify({ name: 'HelpBites inbox', timespanMinutes: 1, quantity: 1, alertRecipients: [{ recipientType: 'webhook', url: webhookUrl }] })
      })
      alertId = String(rule.id || '')
    }
    return { slug, dsn, alertId } satisfies ErrorConfig
  },

  async listIssues(creds, errors, input) {
    if (!errors.slug) return { issues: [], next: '' }
    const { org, url } = creds
    const params = new URLSearchParams({ query: issueQuery(input), limit: String(Math.min(Math.max(Number(input.limit) || 50, 1), 100)) })
    if (input.cursor) params.set('cursor', input.cursor)
    const result = await gt<any[]>(creds, `/projects/${encodeURIComponent(org)}/${encodeURIComponent(errors.slug)}/issues/?${params}`)
    const link = result.headers.get('link') || ''
    const next = link.match(/[?&]cursor=([^&>";]+)/)?.[1] || ''
    return { issues: result.data.map(issue => ({ ...issue, id: String(issue.id), url: `${url}/${org}/issues/${issue.id}` })), next: decodeURIComponent(next) }
  },

  async setIssueStatus(creds, issueId, statusKey) {
    await gt(creds, `/issues/${encodeURIComponent(issueId)}/`, { method: 'PUT', body: JSON.stringify({ status: glitchtipStatusFor(statusKey) }) })
  },

  async latestEvent(creds, issueId) {
    return (await gt(creds, `/issues/${encodeURIComponent(issueId)}/events/latest/`)).data
  }
}
