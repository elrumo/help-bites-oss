import { DEFAULT_STYLE_CHOICE, validateStyleChoice, type StyleChoice } from '../projectStyle'
import { safeHttpUrl } from '../support'
import type { LegalAnswers } from './types'

// `Project.legal`: who operates the app (reused by every document's wizard) and
// how the hosted pages look. Custom CSS is deliberately not here.

export const LEGAL_FONTS = ['system', 'serif', 'mono'] as const
export type LegalFont = (typeof LEGAL_FONTS)[number]

export type LegalConfig = {
  entity: { name: string, address: string, email: string, dpo: string }
  /** '#rrggbb', or '' to use the project's look (the Brand kit's accent): an override for the legal pages only. */
  accent: string
  font: LegalFont
  /** '' falls back to the project's look (the Brand kit's logo): an override for the legal pages only. */
  logoUrl: string
  footerText: string
  /** How the hosted pages take their style: the project's, or their own over it. `accent` and `font` above stay the pages' own layer over both. */
  style: StyleChoice
}

export const DEFAULT_LEGAL_CONFIG: LegalConfig = {
  entity: { name: '', address: '', email: '', dpo: '' },
  accent: '',
  font: 'system',
  logoUrl: '',
  footerText: '',
  style: DEFAULT_STYLE_CHOICE
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function normalizeLegalConfig(value: unknown): LegalConfig {
  return validateLegalConfig(value, DEFAULT_LEGAL_CONFIG).config
}

/** Validate a (partial) config on top of `base`: only the keys sent change; bad values are reported, not applied. */
export function validateLegalConfig(value: unknown, base: LegalConfig = DEFAULT_LEGAL_CONFIG): { config: LegalConfig, errors: string[] } {
  const errors: string[] = []
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) errors.push('legal must be an object')
  const raw = record(value)
  const config: LegalConfig = { ...base, entity: { ...base.entity } }

  if (raw.entity !== undefined) {
    const entity = record(raw.entity)
    for (const [key, max] of [['name', 120], ['address', 300], ['email', 200], ['dpo', 200]] as const) {
      if (entity[key] === undefined) continue
      const text = typeof entity[key] === 'string' ? (entity[key] as string).trim() : null
      if (text === null || text.length > max) errors.push(`entity.${key} is up to ${max} characters`)
      else if (key === 'email' && text && !EMAIL.test(text)) errors.push('entity.email must be an email address')
      else config.entity[key] = text
    }
  }
  if (raw.accent !== undefined) {
    const accent = typeof raw.accent === 'string' ? raw.accent.trim() : null
    if (accent === null || (accent && !/^#[0-9a-f]{6}$/i.test(accent))) errors.push('accent must be a #rrggbb colour or empty')
    else config.accent = accent
  }
  if (raw.font !== undefined) {
    if (!LEGAL_FONTS.includes(raw.font as LegalFont)) errors.push(`font is one of ${LEGAL_FONTS.join(', ')}`)
    else config.font = raw.font as LegalFont
  }
  if (raw.logoUrl !== undefined) {
    const url = safeHttpUrl(raw.logoUrl)
    if (raw.logoUrl && !url) errors.push('logoUrl must be an http(s) URL')
    else config.logoUrl = url
  }
  if (raw.footerText !== undefined) {
    if (typeof raw.footerText !== 'string' || raw.footerText.trim().length > 300) errors.push('footerText is up to 300 characters')
    else config.footerText = raw.footerText.trim()
  }
  if (raw.style !== undefined) {
    const style = validateStyleChoice(raw.style, base.style ?? DEFAULT_STYLE_CHOICE)
    errors.push(...style.errors)
    config.style = style.choice
  }
  return { config, errors }
}

/** The wizard's answers with the project's saved identity filling anything left out. */
export function withEntityDefaults(answers: LegalAnswers, config: LegalConfig, project: { name?: string, siteUrl?: string } = {}): LegalAnswers {
  const out: LegalAnswers = { ...answers }
  const fallback: Record<string, string> = {
    app_name: project.name || '',
    entity_name: config.entity.name,
    entity_address: config.entity.address,
    contact_email: config.entity.email,
    dpo_contact: config.entity.dpo,
    website_url: project.siteUrl || ''
  }
  for (const [key, value] of Object.entries(fallback)) {
    if (value && (typeof out[key] !== 'string' || !(out[key] as string).trim())) out[key] = value
  }
  return out
}
