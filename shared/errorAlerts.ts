// Error alert rules: when an issue in the tracker crosses a line, mail the team.
// Pure so the browser form and the server share one validation and one evaluator.

export const ERROR_RULE_KINDS = ['new', 'total', 'rate'] as const
export type ErrorRuleKind = typeof ERROR_RULE_KINDS[number]

/** `new`: an issue HelpBites has not seen before. `total`: it has happened `threshold` times or more.
 * `rate`: `threshold` or more times within `windowMinutes`. `link` limits it to one tracker project ('' = all);
 * `cooldownMinutes` is how long before the same issue can trigger the same rule again. */
export type ErrorAlertRule = { id: string, name: string, kind: ErrorRuleKind, threshold: number, windowMinutes: number, cooldownMinutes: number, link: string, enabled: boolean }
export type ErrorAlertConfig = { rules: ErrorAlertRule[], emails: string[] }

export const MAX_ERROR_RULES = 20
export const DEFAULT_COOLDOWN: Record<ErrorRuleKind, number> = { new: 24 * 60, total: 24 * 60, rate: 60 }

const int = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

export function normalizeErrorAlerts(input: unknown): { config: ErrorAlertConfig, errors: string[] } {
  const raw = (input && typeof input === 'object' ? input : {}) as { rules?: unknown, emails?: unknown }
  const errors: string[] = []
  const rules = (Array.isArray(raw.rules) ? raw.rules : []).slice(0, MAX_ERROR_RULES).map((item, index): ErrorAlertRule => {
    const rule = (item || {}) as Record<string, unknown>
    const kind = ERROR_RULE_KINDS.find(k => k === rule.kind) || 'total'
    if (!ERROR_RULE_KINDS.some(k => k === rule.kind)) errors.push(`Rule ${index + 1}: unknown kind`)
    return {
      id: String(rule.id || '').replace(/[^\w-]/g, '').slice(0, 24) || `r${index + 1}${Math.random().toString(36).slice(2, 6)}`,
      name: String(rule.name || '').trim().slice(0, 80),
      kind,
      threshold: kind === 'new' ? 1 : int(rule.threshold, 1, 1_000_000, 10),
      windowMinutes: kind === 'rate' ? int(rule.windowMinutes, 1, 7 * 24 * 60, 60) : 0,
      cooldownMinutes: int(rule.cooldownMinutes, 1, 30 * 24 * 60, DEFAULT_COOLDOWN[kind]),
      link: String(rule.link || '').slice(0, 40),
      enabled: rule.enabled !== false
    }
  })
  const emails = [...new Set((Array.isArray(raw.emails) ? raw.emails : []).map(e => String(e).trim().toLowerCase()).filter(Boolean))].slice(0, 20)
  const bad = emails.find(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  if (bad) errors.push(`"${bad}" is not an email address`)
  return { config: { rules, emails: emails.filter(e => e !== bad) }, errors }
}

export const describeRule = (rule: ErrorAlertRule) => rule.kind === 'new'
  ? 'a new error appears'
  : rule.kind === 'total' ? `an error has happened ${rule.threshold} times in total` : `an error happens ${rule.threshold} times within ${rule.windowMinutes} min`

/** One observation of an issue's event count. */
export type CountSample = [at: number, count: number]

/** Events since the window opened. Samples only reach back as far as polling has run, so a young history undercounts rather than guesses. */
export function eventsInWindow(samples: CountSample[], count: number, now: number, windowMinutes: number): number {
  const from = now - windowMinutes * 60_000
  const base = [...samples].reverse().find(([at]) => at <= from) || samples[0]
  return base ? Math.max(0, count - base[1]) : 0
}

/** Rules this issue triggers now. `seenBefore` is whether earlier polls knew the issue; `lastFired` maps rule id to when it last fired for it. */
export function triggeredRules(rules: ErrorAlertRule[], issue: { linkId: string, count: number }, state: { samples: CountSample[], seenBefore: boolean, lastFired: Record<string, number> }, now: number): ErrorAlertRule[] {
  return rules.filter((rule) => {
    if (!rule.enabled || (rule.link && rule.link !== issue.linkId)) return false
    if (now - (state.lastFired[rule.id] || -Infinity) < rule.cooldownMinutes * 60_000) return false
    if (rule.kind === 'new') return !state.seenBefore
    if (rule.kind === 'total') return issue.count >= rule.threshold
    return eventsInWindow(state.samples, issue.count, now, rule.windowMinutes) >= rule.threshold
  })
}
