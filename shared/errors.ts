import { safeHttpUrl } from './support'

export type ErrorAlert = { issueId: string, title: string, url: string, culprit: string }

/** How HelpBites reaches a tracker. `apiUrl` is only for when the server reaches it at another address. */
export type TrackerSettings = { url?: string, apiUrl?: string, token?: string, org?: string }
export type TrackerSettingsKey = keyof TrackerSettings
export type TrackerSource = 'project' | 'global' | 'env'

/** The first complete layer wins whole, so a project's URL is never sent another layer's token. */
export function pickTrackerSettings(required: TrackerSettingsKey[], layers: Array<[TrackerSource, TrackerSettings | undefined]>): { source: TrackerSource, settings: TrackerSettings } | null {
  for (const [source, settings] of layers) if (settings && required.every(key => String(settings[key] || '').trim())) return { source, settings }
  return null
}

/** Applies the settings form to one scope: a blank URL clears it. A blank token keeps the saved one
 * only while the URLs are unchanged, so a new host is never sent the old token. */
export function applyTrackerSettings(current: TrackerSettings | undefined, input: Record<string, unknown>, required: TrackerSettingsKey[]): { settings: TrackerSettings | null, error: string } {
  const raw = String(input.url || '').trim()
  if (!raw) return { settings: null, error: '' }
  const url = safeHttpUrl(raw).replace(/\/+$/, '')
  const apiUrl = safeHttpUrl(input.apiUrl).replace(/\/+$/, '')
  if (!url || (String(input.apiUrl || '').trim() && !apiUrl)) return { settings: null, error: 'URLs must start with http:// or https://' }
  const sameHost = current?.url === url && (current.apiUrl || '') === apiUrl
  const settings: TrackerSettings = { url, ...(apiUrl ? { apiUrl } : {}), token: String(input.token || '').trim().slice(0, 500) || (sameHost ? current?.token : '') || '', org: String(input.org || '').trim().slice(0, 100) }
  const missing = required.filter(key => !settings[key])
  return missing.length ? { settings: null, error: `Missing ${missing.join(', ')}` } : { settings, error: '' }
}

/** GlitchTip sends Slack-style attachments; ignore anything that cannot name an issue. */
export function parseAlertWebhook(body: unknown): ErrorAlert[] {
  const attachments = (body as { attachments?: unknown })?.attachments
  if (!Array.isArray(attachments)) return []
  return attachments.flatMap((item) => {
    const attachment = item as Record<string, unknown>
    const url = String(attachment.title_link || '')
    const issueId = url.match(/\/issues\/(\d+)(?:\/|$|[?#])/)?.[1] || ''
    if (!issueId) return []
    return [{
      issueId,
      title: String(attachment.title || attachment.fallback || 'Error').slice(0, 500),
      url,
      culprit: String(attachment.text || attachment.pretext || '').replace(/<[^>]*>/g, '').trim().slice(0, 500)
    }]
  })
}

export function issueQuery({ status, userId, search }: { status?: unknown, userId?: unknown, search?: unknown }): string {
  const parts: string[] = []
  const state = String(status || '').trim()
  if (state) parts.push(`is:${state === 'unresolved' ? 'unresolved' : state}`)
  const user = String(userId || '').trim()
  if (user) parts.push(`user.id:"${user.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  const text = String(search || '').trim()
  if (text) parts.push(text)
  return parts.join(' ')
}

export function levelToPriority(level: unknown): 'urgent' | 'high' | 'normal' {
  return level === 'fatal' ? 'urgent' : level === 'error' ? 'high' : 'normal'
}

export function glitchtipStatusFor(statusKey: unknown): 'resolved' | 'ignored' | 'unresolved' {
  return statusKey === 'resolved' ? 'resolved' : statusKey === 'closed' ? 'ignored' : 'unresolved'
}

/** Keep the useful diagnostic context while never feeding an unbounded event to the model. */
export function buildErrorPrompt(event: unknown): string {
  const data = (event || {}) as Record<string, any>
  const values = data.exception?.values || data.exception?.value || []
  const exception = Array.isArray(values) ? values[values.length - 1] || {} : values
  const frames = Array.isArray(exception?.stacktrace?.frames) ? exception.stacktrace.frames.filter((f: any) => f?.in_app).slice(-12) : []
  const breadcrumbs = Array.isArray(data.breadcrumbs?.values) ? data.breadcrumbs.values.slice(-15) : []
  const tags = Array.isArray(data.tags) ? Object.fromEntries(data.tags.filter((tag: any) => Array.isArray(tag) && tag.length > 1)) : data.tags || {}
  const text = [
    `Exception: ${String(exception?.type || data.title || 'Error')}: ${String(exception?.value || data.message || '')}`,
    `Release: ${tags.release || data.release || ''}`,
    `Environment: ${tags.environment || data.environment || ''}`,
    `Browser: ${tags.browser?.name || tags.browser || ''}`,
    `OS: ${tags.os?.name || tags.os || ''}`,
    'Frames:',
    ...frames.map((frame: any) => `${frame.filename || frame.abs_path || '?'}:${frame.lineNo || frame.lineno || '?'} ${frame.function || '?' }\n${frame.context_line || frame.contextLine || ''}`),
    'Breadcrumbs:',
    ...breadcrumbs.map((crumb: any) => `${crumb.timestamp || ''} ${crumb.category || ''} ${crumb.message || crumb.data?.url || ''}`)
  ].join('\n')
  return text.length > 12_000 ? `${text.slice(0, 11_980)}\n…(truncated)` : text
}

/** Bugsink's custom webhook posts the canonical issue JSON plus a few convenience fields. */
export function parseBugsinkWebhook(body: unknown): ErrorAlert[] {
  const data = (body || {}) as Record<string, unknown>
  const issueId = String(data.id || '')
  if (!issueId || !['NEW', 'REGRESSED', 'UNMUTED'].includes(String(data.alert_reason || ''))) return []
  return [{ issueId, title: String(data.title || data.calculated_type || 'Error').slice(0, 500), url: String(data.url || ''), culprit: String(data.transaction || '').slice(0, 500) }]
}

export type BugsinkIssue = { id: string, friendly_id?: string, calculated_type?: string, calculated_value?: string, transaction?: string, digested_event_count?: number, last_seen?: string, is_resolved?: boolean, is_muted?: boolean }

export function bugsinkIssueStatus(issue: BugsinkIssue): 'resolved' | 'ignored' | 'unresolved' {
  return issue.is_resolved ? 'resolved' : issue.is_muted ? 'ignored' : 'unresolved'
}

/** Shape a Bugsink issue like the GlitchTip rows the panel already renders. */
export function bugsinkIssueRow(issue: BugsinkIssue, baseUrl: string) {
  const title = [issue.calculated_type, issue.calculated_value].filter(Boolean).join(': ') || 'Error'
  return { id: String(issue.id), shortId: issue.friendly_id || '', title, culprit: issue.transaction || '', level: 'error', count: issue.digested_event_count || 0, lastSeen: issue.last_seen || '', status: bugsinkIssueStatus(issue), url: `${baseUrl}/issues/issue/${issue.id}/event/last/` }
}

/** Bugsink has no "set status"; reaching a state can take two actions (reopen, then mute). */
export function bugsinkActionsFor(issue: BugsinkIssue, statusKey: unknown): string[] {
  const target = glitchtipStatusFor(statusKey)
  const current = bugsinkIssueStatus(issue)
  if (target === current) return []
  if (target === 'resolved') return ['resolve']
  if (target === 'ignored') return current === 'resolved' ? ['reopen', 'mute'] : ['mute']
  return [current === 'resolved' ? 'reopen' : 'unmute']
}
