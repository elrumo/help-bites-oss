import { describeRule, normalizeErrorAlerts, triggeredRules, type CountSample, type ErrorAlertConfig, type ErrorAlertRule } from '#shared/errorAlerts'

// Alert rules are checked by polling the tracker (once a minute, and right away when a tracker's alert webhook
// calls). What was seen last time lives in Redis: losing it only means rules may fire once more after a restart.
// ponytail: only the first page of unresolved issues per tracker project is checked, and state is never pruned
// (the hash expires 30 days after the project's last check).

const STATE_TTL = 30 * 24 * 3600
const stateKey = (projectId: string) => `sb:erralert:state:${projectId}`
const seededKey = (projectId: string, linkId: string) => `sb:erralert:seeded:${projectId}:${linkId}`
const recentKey = (projectId: string) => `sb:erralert:recent:${projectId}`

export type FiredAlert = { at: number, rule: string, title: string, url: string, link: string, count: number }
type IssueState = { samples: CountSample[], lastFired: Record<string, number> }

export const errorAlertConfig = (project: ParseObject): ErrorAlertConfig => normalizeErrorAlerts(project.get('errorAlerts')).config

export async function recentErrorAlerts(projectId: string): Promise<FiredAlert[]> {
  return (await useRedis().lrange(recentKey(projectId), 0, 49).catch(() => [] as string[])).flatMap((raw) => { try { return [JSON.parse(raw) as FiredAlert] } catch { return [] } })
}

/** One pass over a project's tracker projects: record the counts, fire the rules they cross, mail the result. Returns what fired. */
export async function runErrorAlerts(project: ParseObject): Promise<FiredAlert[]> {
  const config = errorAlertConfig(project)
  const rules = config.rules.filter(rule => rule.enabled)
  if (!rules.length) return []
  const redis = useRedis()
  const projectId = project.id || ''
  if (await redis.set(`sb:erralert:lock:${projectId}`, '1', 'EX', 30, 'NX') !== 'OK') return []
  const now = Date.now()
  const longest = Math.max(0, ...rules.filter(rule => rule.kind === 'rate').map(rule => rule.windowMinutes)) * 60_000
  const fired: Array<{ rule: ErrorAlertRule, alert: FiredAlert }> = []
  for (const link of errorLinksOf(project)) {
    const linkId = link.linkId || MAIN_LINK
    let issues: Awaited<ReturnType<typeof listIssues>>['issues']
    try { issues = (await listIssues(project, { status: 'unresolved', limit: 100 }, linkId)).issues } catch (error) { console.warn('[error-alerts]', (error as Error).message); continue }
    // The first pass over a tracker project only learns what is already there, so a new rule never announces old errors as new.
    const seeded = await redis.set(seededKey(projectId, linkId), '1', 'EX', STATE_TTL, 'NX') !== 'OK'
    const fields = issues.map(issue => `${linkId}:${issue.id}`)
    const stored = fields.length ? await redis.hmget(stateKey(projectId), ...fields) : []
    const writes: string[] = []
    issues.forEach((issue, index) => {
      const known: IssueState | null = stored[index] ? JSON.parse(stored[index]!) : null
      const state: IssueState = known || { samples: [], lastFired: {} }
      const count = Number(issue.count) || 0
      const last = state.samples[state.samples.length - 1]
      for (const rule of triggeredRules(rules, { linkId, count }, { samples: state.samples, seenBefore: Boolean(known) || !seeded, lastFired: state.lastFired }, now)) {
        state.lastFired[rule.id] = now
        fired.push({ rule, alert: { at: now, rule: rule.name || describeRule(rule), title: String(issue.title || 'Error'), url: String(issue.url || ''), link: link.label || '', count } })
      }
      if (!last || last[1] !== count || now - last[0] > 55_000) state.samples.push([now, count])
      // Keep one sample from before the longest window so a rate can reach back to its start.
      while (state.samples.length > 1 && (state.samples[1]![0] <= now - longest || state.samples.length > 500)) state.samples.shift()
      writes.push(`${linkId}:${issue.id}`, JSON.stringify(state))
    })
    if (writes.length) await redis.hset(stateKey(projectId), ...writes)
  }
  await redis.expire(stateKey(projectId), STATE_TTL)
  if (!fired.length) return []
  const alerts = fired.map(item => item.alert)
  await redis.lpush(recentKey(projectId), ...alerts.map(alert => JSON.stringify(alert)).reverse())
  await redis.ltrim(recentKey(projectId), 0, 49)
  await redis.expire(recentKey(projectId), STATE_TTL)
  const to = config.emails.length ? config.emails : parseRecipientList(project.get('notifyEmails'))
  const lines = fired.map(({ rule, alert }) => `${alert.title}${alert.link ? ` (${alert.link})` : ''}\nWhen ${describeRule(rule)}: ${alert.count} events so far\n${alert.url}`)
  if (to.length) void notifyErrorAlerts(project, to, lines).catch(error => console.warn('[error-alerts] mail failed:', (error as Error).message))
  void sendTelegram(project, `🚨 ${String(project.get('name') || 'Errors')}\n\n${lines.join('\n\n')}`).catch(error => console.warn('[error-alerts] telegram failed:', (error as Error).message))
  return alerts
}
