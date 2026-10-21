import { DEFAULT_CONTENT_LOCALE, normalizeLocale } from './locales'
import { safeHttpUrl } from './support'

// Onboarding flows: a few screens an app shows a new user. The operator edits a
// working copy; publishing freezes it into the version apps read from
// GET /v1/onboarding/{pk}/{key}. Apps cache that answer and can ship it inside
// their bundle, so HelpBites being down never blocks a first launch
// (docs/ONBOARDING.md). The native app ports these limits by hand
// (tests/onboardingNativeParity.test.ts).

export const ONBOARDING_LIMITS = { flows: 50, steps: 12, name: 80, title: 120, body: 600, label: 40, alt: 200, radius: 32 } as const
/** A flow's key, the name an app asks for it by: lowercase letters, digits and dashes. */
export const ONBOARDING_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/
/** Languages a flow can be translated into, besides the one it is written in. */
export const ONBOARDING_MAX_LOCALES = 20
export const ONBOARDING_FONTS = ['system', 'rounded', 'serif', 'mono'] as const
export const ONBOARDING_PROGRESS = ['bar', 'dots', 'none'] as const

export type OnboardingFont = (typeof ONBOARDING_FONTS)[number]
export type OnboardingProgress = (typeof ONBOARDING_PROGRESS)[number]

export type OnboardingStep = {
  id: string
  title: string
  body: string
  /** '' for a step without a picture. */
  imageUrl: string
  imageAlt: string
  /** '' uses the client's own: Continue, and Get started on the last step. */
  buttonLabel: string
}

export type OnboardingStyle = {
  /** '#rrggbb', or '' for the project's accent. */
  accent: string
  /** '' follows the client's light or dark theme. */
  background: string
  text: string
  /** Corner radius of the card and its button, in points. */
  radius: number
  font: OnboardingFont
}

export type OnboardingOptions = { skippable: boolean, progress: OnboardingProgress }

/** The words of a step a translation replaces; a missing or empty one falls back to the flow's own language. */
export type OnboardingStepText = Pick<OnboardingStep, 'title' | 'body' | 'imageAlt' | 'buttonLabel'>
/** One language of a flow: its name and, by step id, the words of each step. */
export type OnboardingTranslation = { name: string, steps: Record<string, Partial<OnboardingStepText>> }
export type OnboardingTranslations = Record<string, OnboardingTranslation>

/** What an app receives, and the shape of the copy it can bundle. */
export type PublicOnboardingFlow = {
  key: string
  name: string
  /** The language of this copy: the one asked for when the flow has it, else the flow's own. */
  locale: string
  /** Every language the flow has (its own first). */
  locales: string[]
  version: number
  publishedAt: string | null
  project: { name: string, logoUrl: string }
  style: OnboardingStyle
  options: OnboardingOptions
  steps: OnboardingStep[]
}

export const DEFAULT_ONBOARDING_STYLE: OnboardingStyle = { accent: '', background: '', text: '', radius: 20, font: 'system' }
export const DEFAULT_ONBOARDING_OPTIONS: OnboardingOptions = { skippable: true, progress: 'bar' }

const HEX = /^#[0-9a-f]{6}$/i

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

let counter = 0
export function newStepId(): string {
  counter += 1
  return `st_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** A key from a name: "Welcome tour" → "welcome-tour". */
export function onboardingKeyFrom(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'welcome'
}

/** Three screens to start from, so the editor never opens empty. */
export function starterSteps(appName: string): OnboardingStep[] {
  const app = appName.trim() || 'the app'
  return [
    { id: newStepId(), title: `Welcome to ${app}`, body: 'Say in one sentence what people can do here that they could not before.', imageUrl: '', imageAlt: '', buttonLabel: '' },
    { id: newStepId(), title: 'Show the one thing that matters', body: 'Point at the feature people should try first, and what they get from it.', imageUrl: '', imageAlt: '', buttonLabel: '' },
    { id: newStepId(), title: 'You are all set', body: 'Tell people where to find help if they get stuck.', imageUrl: '', imageAlt: '', buttonLabel: '' }
  ]
}

function text(raw: Record<string, unknown>, key: string, max: number, errors: string[], label: string): string {
  const value = raw[key]
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') { errors.push(`${label} must be text`); return '' }
  const trimmed = value.trim()
  if (trimmed.length > max) errors.push(`${label} is up to ${max} characters`)
  return trimmed.slice(0, max)
}

/** The full list of steps. A step without an id gets one; ids stay unique. */
export function validateOnboardingSteps(value: unknown): { steps: OnboardingStep[], errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(value)) return { steps: [], errors: ['steps must be a list'] }
  if (value.length > ONBOARDING_LIMITS.steps) errors.push(`A flow has at most ${ONBOARDING_LIMITS.steps} steps`)
  const seen = new Set<string>()
  const steps = value.slice(0, ONBOARDING_LIMITS.steps).map((item, index) => {
    const raw = record(item)
    const n = index + 1
    let id = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : ''
    if (!id || seen.has(id)) id = newStepId()
    seen.add(id)
    const imageUrl = raw.imageUrl ? safeHttpUrl(raw.imageUrl) : ''
    if (raw.imageUrl && !imageUrl) errors.push(`Step ${n}: imageUrl must be an http(s) URL`)
    const step: OnboardingStep = {
      id,
      title: text(raw, 'title', ONBOARDING_LIMITS.title, errors, `Step ${n}: title`),
      body: text(raw, 'body', ONBOARDING_LIMITS.body, errors, `Step ${n}: body`),
      imageUrl,
      imageAlt: text(raw, 'imageAlt', ONBOARDING_LIMITS.alt, errors, `Step ${n}: imageAlt`),
      buttonLabel: text(raw, 'buttonLabel', ONBOARDING_LIMITS.label, errors, `Step ${n}: buttonLabel`)
    }
    if (!step.title && !step.body && !step.imageUrl) errors.push(`Step ${n} is empty`)
    return step
  })
  return { steps, errors }
}

/** A (partial) style on top of `base`: only the keys sent change. */
export function validateOnboardingStyle(value: unknown, base: OnboardingStyle = DEFAULT_ONBOARDING_STYLE): { style: OnboardingStyle, errors: string[] } {
  const errors: string[] = []
  const raw = record(value)
  const style = { ...base }
  for (const key of ['accent', 'background', 'text'] as const) {
    if (raw[key] === undefined) continue
    const colour = typeof raw[key] === 'string' ? (raw[key] as string).trim() : null
    if (colour === null || (colour && !HEX.test(colour))) errors.push(`style.${key} must be a #rrggbb colour or empty`)
    else style[key] = colour.toLowerCase()
  }
  if (raw.radius !== undefined) {
    const radius = Number(raw.radius)
    if (!Number.isInteger(radius) || radius < 0 || radius > ONBOARDING_LIMITS.radius) errors.push(`style.radius is a whole number from 0 to ${ONBOARDING_LIMITS.radius}`)
    else style.radius = radius
  }
  if (raw.font !== undefined) {
    if (!ONBOARDING_FONTS.includes(raw.font as OnboardingFont)) errors.push(`style.font is one of ${ONBOARDING_FONTS.join(', ')}`)
    else style.font = raw.font as OnboardingFont
  }
  return { style, errors }
}

export function validateOnboardingOptions(value: unknown, base: OnboardingOptions = DEFAULT_ONBOARDING_OPTIONS): { options: OnboardingOptions, errors: string[] } {
  const errors: string[] = []
  const raw = record(value)
  const options = { ...base }
  if (raw.skippable !== undefined) {
    if (typeof raw.skippable !== 'boolean') errors.push('options.skippable must be true or false')
    else options.skippable = raw.skippable
  }
  if (raw.progress !== undefined) {
    if (!ONBOARDING_PROGRESS.includes(raw.progress as OnboardingProgress)) errors.push(`options.progress is one of ${ONBOARDING_PROGRESS.join(', ')}`)
    else options.progress = raw.progress as OnboardingProgress
  }
  return { options, errors }
}

export const normalizeOnboardingStyle = (value: unknown) => validateOnboardingStyle(value).style
export const normalizeOnboardingOptions = (value: unknown) => validateOnboardingOptions(value).options

/** Saved steps as they are, without re-checking (they were checked on write). */
export function onboardingStepsOf(value: unknown): OnboardingStep[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const s = record(item)
    return { id: String(s.id || ''), title: String(s.title || ''), body: String(s.body || ''), imageUrl: String(s.imageUrl || ''), imageAlt: String(s.imageAlt || ''), buttonLabel: String(s.buttonLabel || '') }
  })
}

// ---- translations ---------------------------------------------------------------

const STEP_TEXT_LIMITS = { title: ONBOARDING_LIMITS.title, body: ONBOARDING_LIMITS.body, imageAlt: ONBOARDING_LIMITS.alt, buttonLabel: ONBOARDING_LIMITS.label } as const
const STEP_TEXT_KEYS = Object.keys(STEP_TEXT_LIMITS) as Array<keyof OnboardingStepText>

/** A flow's own language: a valid tag, else English. */
export const onboardingLocaleOf = (value: unknown): string => normalizeLocale(value) || DEFAULT_CONTENT_LOCALE

/**
 * Translations as sent by an operator, on top of `base`: a language that is present replaces
 * that language, `null` removes it. Step ids that no step has are dropped.
 */
export function validateOnboardingTranslations(value: unknown, steps: OnboardingStep[], source: string, base: OnboardingTranslations = {}): { translations: OnboardingTranslations, errors: string[] } {
  const errors: string[] = []
  const out: OnboardingTranslations = { ...base }
  const ids = new Set(steps.map(s => s.id))
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { translations: out, errors: ['translations must be an object keyed by language'] }
  for (const [rawTag, raw] of Object.entries(value as Record<string, unknown>)) {
    const tag = normalizeLocale(rawTag)
    if (!tag) { errors.push(`"${rawTag.slice(0, 20)}" is not a language tag`); continue }
    if (tag.toLowerCase() === source.toLowerCase()) { errors.push(`${tag} is the flow's own language`); continue }
    if (raw === null) { delete out[tag]; continue }
    const entry = record(raw)
    const stepsIn = record(entry.steps)
    const translation: OnboardingTranslation = { name: text(entry, 'name', ONBOARDING_LIMITS.name, errors, `${tag}: name`), steps: {} }
    for (const [id, stepRaw] of Object.entries(stepsIn)) {
      if (!ids.has(id)) continue
      const s = record(stepRaw)
      const words: Partial<OnboardingStepText> = {}
      for (const key of STEP_TEXT_KEYS) {
        const word = text(s, key, STEP_TEXT_LIMITS[key], errors, `${tag}: ${key}`)
        if (word) words[key] = word
      }
      if (Object.keys(words).length) translation.steps[id] = words
    }
    out[tag] = translation
  }
  if (Object.keys(out).length > ONBOARDING_MAX_LOCALES) errors.push(`A flow has at most ${ONBOARDING_MAX_LOCALES} translations`)
  return { translations: out, errors }
}

/** Saved translations as they are, without re-checking (they were checked on write). */
export function onboardingTranslationsOf(value: unknown): OnboardingTranslations {
  const out: OnboardingTranslations = {}
  for (const [tag, raw] of Object.entries(record(value))) {
    const entry = record(raw)
    const steps: OnboardingTranslation['steps'] = {}
    for (const [id, s] of Object.entries(record(entry.steps))) {
      const words: Partial<OnboardingStepText> = {}
      for (const key of STEP_TEXT_KEYS) if (typeof record(s)[key] === 'string' && record(s)[key]) words[key] = record(s)[key] as string
      if (Object.keys(words).length) steps[id] = words
    }
    out[tag] = { name: String(entry.name || ''), steps }
  }
  return out
}

/** Every string of a flow that a translator works on, by a flat key: `name` and `<stepId>.<field>`. Empty ones are left out. */
export function onboardingTexts(name: string, steps: OnboardingStep[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (name.trim()) out.name = name
  for (const step of steps) for (const key of STEP_TEXT_KEYS) if (step[key].trim()) out[`${step.id}.${key}`] = step[key]
  return out
}

/** The flat texts of an existing translation, in the shape onboardingTexts uses. */
export function translationTexts(translation: OnboardingTranslation | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!translation) return out
  if (translation.name) out.name = translation.name
  for (const [id, words] of Object.entries(translation.steps)) for (const key of STEP_TEXT_KEYS) if (words[key]) out[`${id}.${key}`] = words[key]!
  return out
}

/** Flat texts (as translateStrings returns them) back into a translation. */
export function translationFromTexts(texts: Record<string, string>, steps: OnboardingStep[]): OnboardingTranslation {
  const translation: OnboardingTranslation = { name: texts.name || '', steps: {} }
  for (const step of steps) {
    const words: Partial<OnboardingStepText> = {}
    for (const key of STEP_TEXT_KEYS) if (texts[`${step.id}.${key}`]) words[key] = texts[`${step.id}.${key}`]
    if (Object.keys(words).length) translation.steps[step.id] = words
  }
  return translation
}

/** A flow's name and steps in one language: each translated word replaces the original, anything missing stays in the flow's own language. */
export function localizeOnboarding(name: string, steps: OnboardingStep[], translation: OnboardingTranslation | undefined): { name: string, steps: OnboardingStep[] } {
  if (!translation) return { name, steps }
  return {
    name: translation.name || name,
    steps: steps.map(step => ({ ...step, ...translation.steps[step.id] }))
  }
}
