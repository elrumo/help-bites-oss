import { ATTRIBUTE_KEY_RE, CONTACT_LIMITS, cleanTags, normalizeEmail, type ContactAttributeValue } from './contacts'
import { safeHttpUrl } from './support'

// Lead forms: "notify me", waitlist and interest forms that collect people
// into a project's contacts. A form is a list of fields (always one email),
// its words, its look, and what happens after someone signs up: a
// confirmation email (double opt-in), a welcome email from a template, a
// sequence, tags. Apps read it from GET /v1/forms/{pk}/{key} and post to the
// same URL (docs/FORMS.md). Shared by the server, the panel and the embed's
// contract; the native app ports the limits by hand
// (tests/leadFormsNativeParity.test.ts).

export const LEAD_FORM_LIMITS = { forms: 50, fields: 12, options: 20, name: 80, label: 80, placeholder: 80, option: 60, title: 120, description: 400, button: 40, message: 300, tags: 10, text: 200, textarea: 500, radius: 32 } as const
/** A form's key, the name a site asks for it by: lowercase letters, digits and dashes. */
export const LEAD_FORM_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/
export const LEAD_FIELD_TYPES = ['email', 'name', 'text', 'textarea', 'number', 'url', 'phone', 'select', 'checkbox'] as const
export const LEAD_FORM_FONTS = ['system', 'rounded', 'serif', 'mono'] as const
export const LEAD_FORM_LAYOUTS = ['stacked', 'inline'] as const
/** Keys a field may not take: the contact's own fields and what the endpoint reads itself. */
export const RESERVED_FIELD_KEYS = ['email', 'name', 'website', 'pk', 'form', 'project', 'externalId', 'tags', 'subscription'] as const

export type LeadFieldType = (typeof LEAD_FIELD_TYPES)[number]
export type LeadFormFont = (typeof LEAD_FORM_FONTS)[number]
export type LeadFormLayout = (typeof LEAD_FORM_LAYOUTS)[number]

export type LeadFormField = {
  id: string
  /** Where the answer goes: `email` and `name` are the contact's own; anything else is `attributes.<key>`. */
  key: string
  type: LeadFieldType
  label: string
  placeholder: string
  required: boolean
  /** `select` only. */
  options: string[]
}

export type LeadFormContent = {
  title: string
  description: string
  buttonLabel: string
  /** Shown once someone is on the list. */
  successTitle: string
  successMessage: string
  /** Shown instead of successMessage while they still have to confirm their address. */
  confirmMessage: string
  /** Small print under the button: a privacy note, a link to the terms. */
  footnote: string
}

export type LeadFormStyle = {
  /** '#rrggbb', or '' for the project's accent. */
  accent: string
  /** '' follows the host page's light or dark theme. */
  background: string
  text: string
  radius: number
  font: LeadFormFont
  /** `inline` puts the inputs and the button on one row (an email box and a button), wrapping when narrow. */
  layout: LeadFormLayout
}

export type LeadFormSettings = {
  /** People confirm their address from an email before they are on the list. */
  doubleOptIn: boolean
  /** The confirmation email's template (send key or id; it gets {{confirmUrl}}). '' uses the project's `confirm-subscription` template, else HelpBites' own. */
  confirmTemplate: string
  /** Sent once someone is on the list (confirmed, or right away without double opt-in). '' sends none. */
  welcomeTemplate: string
  /** A sequence (id) they start once they are on the list. */
  sequence: string
  /** Added to the contact. */
  tags: string[]
  /** Where a plain HTML form, the hosted page and the confirmation link send people afterwards. '' shows HelpBites' own page. */
  redirectUrl: string
}

export type LeadForm = {
  id: string
  projectId: string
  key: string
  name: string
  /** Off: the public URL answers 404 and nobody can sign up. */
  active: boolean
  fields: LeadFormField[]
  content: LeadFormContent
  style: LeadFormStyle
  settings: LeadFormSettings
  /** The segment made for this form's leads (its id), '' if it was deleted. */
  segment: string
  /** People who came through this form, and how many of them are on the list (subscribed). */
  stats: { leads: number, confirmed: number }
  /** The public read and submit URL (`/v1/forms/<pk>/<key>`) and the hosted page (`/f/<pk>/<key>`), on this server. */
  path: string
  pagePath: string
  createdAt: string | null
  updatedAt: string | null
}

/** What a site or an app receives. */
export type PublicLeadForm = {
  key: string
  name: string
  fields: LeadFormField[]
  content: LeadFormContent
  /** `accent` is the project's when the form leaves it empty. */
  style: LeadFormStyle
  doubleOptIn: boolean
  project: { name: string, logoUrl: string }
}

export const DEFAULT_LEAD_CONTENT: LeadFormContent = {
  title: 'Be the first to know',
  description: 'Leave your email and we will tell you when it is ready.',
  buttonLabel: 'Notify me',
  successTitle: 'You are on the list',
  successMessage: 'Thanks! We will be in touch soon.',
  confirmMessage: 'Check your inbox and confirm your email to finish signing up.',
  footnote: ''
}
export const DEFAULT_LEAD_STYLE: LeadFormStyle = { accent: '', background: '', text: '', radius: 12, font: 'system', layout: 'stacked' }
export const DEFAULT_LEAD_SETTINGS: LeadFormSettings = { doubleOptIn: true, confirmTemplate: '', welcomeTemplate: '', sequence: '', tags: [], redirectUrl: '' }

/** The words a field shows when the operator leaves its label empty. */
export const LEAD_FIELD_LABELS: Record<LeadFieldType, string> = {
  email: 'Email', name: 'Name', text: 'Text', textarea: 'Message', number: 'Number', url: 'Website', phone: 'Phone', select: 'Choose one', checkbox: 'I agree'
}

const HEX = /^#[0-9a-f]{6}$/i
const PHONE = /^[+()\d\s./-]{5,30}$/

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

let counter = 0
export function newFieldId(): string {
  counter += 1
  return `fd_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** A key from a name: "Launch waitlist" → "launch-waitlist". */
export function leadFormKeyFrom(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'waitlist'
}

/** An attribute key from a label: "Company size" → "company_size". */
export function fieldKeyFrom(label: string): string {
  const key = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const safe = (/^[a-z]/.test(key) ? key : `f_${key}`).slice(0, 40).replace(/_+$/, '')
  return (RESERVED_FIELD_KEYS as readonly string[]).includes(safe) ? `${safe}_answer` : safe
}

const field = (type: LeadFieldType, extra: Partial<LeadFormField> = {}): LeadFormField => ({
  id: newFieldId(), key: type === 'email' || type === 'name' ? type : fieldKeyFrom(extra.label || LEAD_FIELD_LABELS[type]), type, label: LEAD_FIELD_LABELS[type], placeholder: '', required: type === 'email', options: [], ...extra
})

/** Starting points for a new form: a single email box, a waitlist, or a form that asks more. */
export const LEAD_FORM_PRESETS = ['email', 'waitlist', 'detailed'] as const
export type LeadFormPreset = (typeof LEAD_FORM_PRESETS)[number]

export function presetForm(preset: LeadFormPreset): { fields: LeadFormField[], content: LeadFormContent, style: LeadFormStyle } {
  if (preset === 'email') {
    return { fields: [field('email', { placeholder: 'you@example.com' })], content: { ...DEFAULT_LEAD_CONTENT }, style: { ...DEFAULT_LEAD_STYLE, layout: 'inline' } }
  }
  if (preset === 'detailed') {
    return {
      fields: [
        field('email', { placeholder: 'you@example.com' }),
        field('name', { placeholder: 'Ada Lovelace' }),
        field('text', { key: 'company', label: 'Company', placeholder: 'Acme' }),
        field('select', { key: 'role', label: 'Your role', options: ['Founder', 'Developer', 'Designer', 'Other'] }),
        field('textarea', { key: 'use_case', label: 'What would you use it for?' })
      ],
      content: { ...DEFAULT_LEAD_CONTENT, title: 'Request early access', description: 'Tell us a little about yourself and we will invite you as soon as we can.', buttonLabel: 'Request access' },
      style: { ...DEFAULT_LEAD_STYLE }
    }
  }
  return {
    fields: [field('email', { placeholder: 'you@example.com' }), field('name', { placeholder: 'Your name' })],
    content: { ...DEFAULT_LEAD_CONTENT, title: 'Join the waitlist', buttonLabel: 'Join the waitlist' },
    style: { ...DEFAULT_LEAD_STYLE }
  }
}

function text(raw: Record<string, unknown>, key: string, max: number, errors: string[], label: string): string {
  const value = raw[key]
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') { errors.push(`${label} must be text`); return '' }
  const trimmed = value.trim()
  if (trimmed.length > max) errors.push(`${label} is up to ${max} characters`)
  return trimmed.slice(0, max)
}

/**
 * The full list of fields. There is always exactly one email field (added
 * first when missing), at most one name field, and every other key is an
 * attribute key used once.
 */
export function validateLeadFields(value: unknown): { fields: LeadFormField[], errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(value)) return { fields: presetForm('email').fields, errors: ['fields must be a list'] }
  if (value.length > LEAD_FORM_LIMITS.fields) errors.push(`A form has at most ${LEAD_FORM_LIMITS.fields} fields`)
  const ids = new Set<string>()
  const keys = new Set<string>()
  const fields: LeadFormField[] = []
  for (const [index, item] of value.slice(0, LEAD_FORM_LIMITS.fields).entries()) {
    const raw = record(item)
    const at = `Field ${index + 1}`
    const type = raw.type as LeadFieldType
    if (!LEAD_FIELD_TYPES.includes(type)) { errors.push(`${at}: type is one of ${LEAD_FIELD_TYPES.join(', ')}`); continue }
    if ((type === 'email' || type === 'name') && fields.some(f => f.type === type)) { errors.push(`${at}: a form has one ${type} field`); continue }
    let id = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : ''
    if (!id || ids.has(id)) id = newFieldId()
    ids.add(id)
    const label = text(raw, 'label', LEAD_FORM_LIMITS.label, errors, `${at}: label`) || LEAD_FIELD_LABELS[type]
    let key: string = type
    if (type !== 'email' && type !== 'name') {
      key = typeof raw.key === 'string' && raw.key.trim() ? raw.key.trim() : fieldKeyFrom(label)
      if (!ATTRIBUTE_KEY_RE.test(key)) { errors.push(`${at}: key "${key.slice(0, 40)}" uses letters, digits and _, starting with a letter`); continue }
      if ((RESERVED_FIELD_KEYS as readonly string[]).includes(key)) { errors.push(`${at}: "${key}" is reserved; pick another key`); continue }
    }
    if (keys.has(key)) { errors.push(`${at}: the key "${key}" is used twice`); continue }
    keys.add(key)
    let options: string[] = []
    if (type === 'select') {
      const list = Array.isArray(raw.options) ? raw.options : []
      options = [...new Set(list.map(o => String(o ?? '').trim().slice(0, LEAD_FORM_LIMITS.option)).filter(Boolean))].slice(0, LEAD_FORM_LIMITS.options)
      if (!options.length) errors.push(`${at}: a choice needs at least one option`)
      if (list.length > LEAD_FORM_LIMITS.options) errors.push(`${at}: at most ${LEAD_FORM_LIMITS.options} options`)
    }
    fields.push({
      id,
      key,
      type,
      label,
      placeholder: type === 'checkbox' || type === 'select' ? '' : text(raw, 'placeholder', LEAD_FORM_LIMITS.placeholder, errors, `${at}: placeholder`),
      // The address is what the form is for.
      required: type === 'email' ? true : raw.required === true,
      options
    })
  }
  if (!fields.some(f => f.type === 'email')) fields.unshift(field('email', { placeholder: 'you@example.com' }))
  if (fields.length > LEAD_FORM_LIMITS.fields) fields.length = LEAD_FORM_LIMITS.fields
  return { fields, errors }
}

/** Partial: only the keys sent change. */
export function validateLeadContent(value: unknown, base: LeadFormContent = DEFAULT_LEAD_CONTENT): { content: LeadFormContent, errors: string[] } {
  const errors: string[] = []
  const raw = record(value)
  const content = { ...base }
  const limits: Record<keyof LeadFormContent, number> = {
    title: LEAD_FORM_LIMITS.title, description: LEAD_FORM_LIMITS.description, buttonLabel: LEAD_FORM_LIMITS.button,
    successTitle: LEAD_FORM_LIMITS.title, successMessage: LEAD_FORM_LIMITS.message, confirmMessage: LEAD_FORM_LIMITS.message, footnote: LEAD_FORM_LIMITS.message
  }
  for (const key of Object.keys(limits) as Array<keyof LeadFormContent>) {
    if (raw[key] === undefined) continue
    content[key] = text(raw, key, limits[key], errors, `content.${key}`)
  }
  // Empty words fall back to the defaults, except the optional ones.
  for (const key of ['buttonLabel', 'successTitle'] as const) if (!content[key]) content[key] = DEFAULT_LEAD_CONTENT[key]
  return { content, errors }
}

export function validateLeadStyle(value: unknown, base: LeadFormStyle = DEFAULT_LEAD_STYLE): { style: LeadFormStyle, errors: string[] } {
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
    if (!Number.isInteger(radius) || radius < 0 || radius > LEAD_FORM_LIMITS.radius) errors.push(`style.radius is a whole number from 0 to ${LEAD_FORM_LIMITS.radius}`)
    else style.radius = radius
  }
  if (raw.font !== undefined) {
    if (!LEAD_FORM_FONTS.includes(raw.font as LeadFormFont)) errors.push(`style.font is one of ${LEAD_FORM_FONTS.join(', ')}`)
    else style.font = raw.font as LeadFormFont
  }
  if (raw.layout !== undefined) {
    if (!LEAD_FORM_LAYOUTS.includes(raw.layout as LeadFormLayout)) errors.push(`style.layout is one of ${LEAD_FORM_LAYOUTS.join(', ')}`)
    else style.layout = raw.layout as LeadFormLayout
  }
  return { style, errors }
}

/** The settings' shape; that the templates and the sequence exist is the server's to check. */
export function validateLeadSettings(value: unknown, base: LeadFormSettings = DEFAULT_LEAD_SETTINGS): { settings: LeadFormSettings, errors: string[] } {
  const errors: string[] = []
  const raw = record(value)
  const settings = { ...base, tags: [...base.tags] }
  if (raw.doubleOptIn !== undefined) {
    if (typeof raw.doubleOptIn !== 'boolean') errors.push('settings.doubleOptIn must be true or false')
    else settings.doubleOptIn = raw.doubleOptIn
  }
  for (const key of ['confirmTemplate', 'welcomeTemplate', 'sequence'] as const) {
    if (raw[key] === undefined) continue
    settings[key] = text(raw, key, 120, errors, `settings.${key}`)
  }
  if (raw.tags !== undefined) {
    const tags = cleanTags(raw.tags)
    if (tags.length > LEAD_FORM_LIMITS.tags) errors.push(`At most ${LEAD_FORM_LIMITS.tags} tags`)
    settings.tags = tags.slice(0, LEAD_FORM_LIMITS.tags)
  }
  if (raw.redirectUrl !== undefined) {
    const url = raw.redirectUrl ? safeHttpUrl(raw.redirectUrl) : ''
    if (raw.redirectUrl && !url) errors.push('settings.redirectUrl must be an http(s) URL')
    else settings.redirectUrl = url
  }
  return { settings, errors }
}

export const normalizeLeadContent = (value: unknown) => validateLeadContent(value).content
export const normalizeLeadStyle = (value: unknown) => validateLeadStyle(value).style
export const normalizeLeadSettings = (value: unknown) => validateLeadSettings(value).settings

/** Saved fields as they are (they were checked on write); a form with none still asks for an email. */
export function leadFieldsOf(value: unknown): LeadFormField[] {
  const list = Array.isArray(value) ? value : []
  const fields = list.map((item) => {
    const f = record(item)
    return { id: String(f.id || ''), key: String(f.key || ''), type: (LEAD_FIELD_TYPES.includes(f.type as LeadFieldType) ? f.type : 'text') as LeadFieldType, label: String(f.label || ''), placeholder: String(f.placeholder || ''), required: f.required === true, options: Array.isArray(f.options) ? f.options.map(String) : [] }
  })
  return fields.some(f => f.type === 'email') ? fields : [field('email'), ...fields]
}

// ---- a submission ----------------------------------------------------------------

export type LeadSubmission = { email: string, name: string, attributes: Record<string, ContactAttributeValue>, bot: boolean }

const TRUE = new Set(['true', 'on', 'yes', '1'])

/**
 * What someone typed, checked against the form's fields: a JSON body or a
 * plain HTML form (every value a string). `website` is the honeypot: people
 * leave it empty, bots fill it in. Unknown keys are ignored.
 */
export function readLeadSubmission(fields: LeadFormField[], body: Record<string, unknown>): { submission: LeadSubmission, errors: string[] } {
  const errors: string[] = []
  const submission: LeadSubmission = { email: '', name: '', attributes: {}, bot: Boolean(String(body.website ?? '').trim()) }
  for (const f of fields) {
    const raw = body[f.key]
    const blank = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())
    const label = f.label || LEAD_FIELD_LABELS[f.type]
    if (f.type === 'checkbox') {
      const on = raw === true || TRUE.has(String(raw ?? '').trim().toLowerCase())
      if (f.required && !on) errors.push(`${label}: tick the box to continue`)
      else submission.attributes[f.key] = on
      continue
    }
    if (blank) {
      if (f.required) errors.push(f.type === 'email' ? 'Enter a valid email address' : `${label} is required`)
      continue
    }
    const value = typeof raw === 'string' ? raw.trim() : raw
    switch (f.type) {
      case 'email': {
        const email = normalizeEmail(value)
        if (!email) errors.push('Enter a valid email address')
        else submission.email = email
        break
      }
      case 'name': submission.name = String(value).slice(0, CONTACT_LIMITS.name); break
      case 'number': {
        const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
        if (!Number.isFinite(n)) errors.push(`${label} must be a number`)
        else submission.attributes[f.key] = n
        break
      }
      case 'url': {
        const url = safeHttpUrl(String(value))
        if (!url || url.length > CONTACT_LIMITS.attributeValue) errors.push(`${label} must be a web address`)
        else submission.attributes[f.key] = url
        break
      }
      case 'phone': {
        if (!PHONE.test(String(value))) errors.push(`${label} must be a phone number`)
        else submission.attributes[f.key] = String(value)
        break
      }
      case 'select': {
        if (!f.options.includes(String(value))) errors.push(`${label}: pick one of the options`)
        else submission.attributes[f.key] = String(value)
        break
      }
      case 'textarea': submission.attributes[f.key] = String(value).slice(0, LEAD_FORM_LIMITS.textarea); break
      default: submission.attributes[f.key] = String(value).slice(0, LEAD_FORM_LIMITS.text)
    }
  }
  return { submission, errors }
}
