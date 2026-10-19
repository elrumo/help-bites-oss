// Feature flags: per-project switches an operator flips in the panel and a
// host app reads over `/v1/flags`. HelpBites knows nothing about what a flag
// gates — keys are the host's own — so any app can use it:
//
//   off     nobody
//   admins  the host's admins (its own check, or the `role: "admin"` token
//           claim) plus anyone on the flag's `allow` list
//   on      everybody
//
// `fallback` is what a client should assume when it cannot reach HelpBites
// (after its last good answer goes stale); `off` unless an operator says so.
// `targets` are free-form tags ("frontend", "backend") a client filters by.

export const FLAG_STATES = ['off', 'admins', 'on'] as const
export type FlagState = typeof FLAG_STATES[number]

export type FeatureFlag = {
  key: string
  description: string
  state: FlagState
  fallback: FlagState
  targets: string[]
  /** The host's user ids (`sub`) or emails that count as admins for this flag. */
  allow: string[]
}

export type FlagViewer = { isAdmin: boolean, sub?: string, email?: string }

export const FLAG_KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/
export const FLAGS_MAX = 200
const TARGETS_MAX = 10
const ALLOW_MAX = 200

function isFlagState(value: unknown): value is FlagState {
  return FLAG_STATES.includes(value as FlagState)
}

function targetList(value: unknown, errors: string[], key: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) { errors.push(`${key}: targets must be a list`); return [] }
  const targets = [...new Set(value.map(v => String(v ?? '').trim().toLowerCase()).filter(Boolean))]
  const bad = targets.find(t => !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(t))
  if (bad) errors.push(`${key}: target "${bad}" must be lowercase letters, digits, - or _ (max 32)`)
  if (targets.length > TARGETS_MAX) errors.push(`${key}: at most ${TARGETS_MAX} targets`)
  return targets
}

function allowList(value: unknown, errors: string[], key: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) { errors.push(`${key}: allow must be a list`); return [] }
  const allow = [...new Set(value
    .map(v => String(v ?? '').trim().slice(0, 200))
    .filter(Boolean)
    .map(v => (v.includes('@') ? v.toLowerCase() : v)))]
  if (allow.length > ALLOW_MAX) errors.push(`${key}: at most ${ALLOW_MAX} allowed users`)
  return allow
}

/**
 * Validate a whole flag list (the panel saves it as one). Malformed entries are
 * reported rather than dropped, so a save never silently loses a flag.
 */
export function validateFlags(value: unknown): { flags: FeatureFlag[], errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(value)) return { flags: [], errors: ['flags must be a list'] }
  if (value.length > FLAGS_MAX) errors.push(`At most ${FLAGS_MAX} flags`)

  const flags: FeatureFlag[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const raw = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const key = String(raw.key ?? '').trim()
    if (!FLAG_KEY_PATTERN.test(key)) { errors.push(`Flag key "${key}" must be lowercase letters, digits, ., - or _ (max 64)`); continue }
    if (seen.has(key)) { errors.push(`Duplicate flag "${key}"`); continue }
    seen.add(key)
    if (raw.state !== undefined && !isFlagState(raw.state)) errors.push(`${key}: state must be off, admins or on`)
    if (raw.fallback !== undefined && !isFlagState(raw.fallback)) errors.push(`${key}: fallback must be off, admins or on`)
    flags.push({
      key,
      description: String(raw.description ?? '').trim().slice(0, 200),
      state: isFlagState(raw.state) ? raw.state : 'off',
      fallback: isFlagState(raw.fallback) ? raw.fallback : 'off',
      targets: targetList(raw.targets, errors, key),
      allow: allowList(raw.allow, errors, key)
    })
  }
  return { flags, errors }
}

/** Read stored flags leniently: whatever is valid survives. */
export function normalizeFlags(value: unknown): FeatureFlag[] {
  return validateFlags(Array.isArray(value) ? value : []).flags
}

/** Whether `state` (a flag's live state or its fallback) lets this viewer in. */
export function flagEnabledFor(state: FlagState, flag: Pick<FeatureFlag, 'allow'>, viewer: FlagViewer): boolean {
  if (state === 'on') return true
  if (state !== 'admins') return false
  if (viewer.isAdmin) return true
  const email = viewer.email?.trim().toLowerCase()
  return Boolean((viewer.sub && flag.allow.includes(viewer.sub)) || (email && flag.allow.includes(email)))
}

/** Untagged flags are for everyone; a tagged flag only for its targets. No target = every flag. */
export function flagsForTarget(flags: FeatureFlag[], target: string): FeatureFlag[] {
  const t = target.trim().toLowerCase()
  return t ? flags.filter(f => !f.targets.length || f.targets.includes(t)) : flags
}
