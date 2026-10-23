import { ATTRIBUTE_KEY_RE, CONTACT_LIMITS, cleanTags, normalizeEmail, type ContactAttributeValue } from './contacts'
import { DEFAULT_CONTENT_LOCALE, normalizeLocale } from './locales'
import type { ResolvedStyle } from './projectStyle'
import { safeHttpUrl } from './support'

// Lead forms: "notify me", waitlist and interest forms that collect people
// into a project's contacts. A form is a list of fields (always one email),
// its words, its look, and what happens after someone signs up: a
// confirmation email (double opt-in), a welcome email from a template, a
// sequence, tags. Apps read it from GET /v1/forms/{pk}/{key} and post to the
// same URL (docs/FORMS.md). A form is written in one language and can carry a
// translation per language of its words; uploads are files kept privately for
// the operator. Shared by the server, the panel and the embed's contract; the
// native app ports the limits by hand (tests/leadFormsNativeParity.test.ts).

export const LEAD_FORM_LIMITS = { forms: 50, fields: 12, options: 20, name: 80, label: 80, placeholder: 80, option: 60, title: 120, description: 400, button: 40, message: 300, tags: 10, text: 200, textarea: 500, radius: 32, files: 3, fileMB: 20 } as const
/** Languages a form can be translated into, besides the one it is written in. */
export const LEAD_FORM_MAX_LOCALES = 20
/** A form's key, the name a site asks for it by: lowercase letters, digits and dashes. */
export const LEAD_FORM_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/
export const LEAD_FIELD_TYPES = ['email', 'name', 'text', 'textarea', 'number', 'url', 'phone', 'select', 'checkbox', 'file'] as const
/** What a file field takes: pictures, documents (PDF, Office, OpenDocument, text), or either plus ZIP archives. */
export const LEAD_FILE_KINDS = ['images', 'documents', 'any'] as const
export const LEAD_FORM_FONTS = ['system', 'rounded', 'serif', 'mono'] as const
export const LEAD_FORM_LAYOUTS = ['stacked', 'inline'] as const
/** Keys a field may not take: the contact's own fields and what the endpoint reads itself. */
export const RESERVED_FIELD_KEYS = ['email', 'name', 'website', 'pk', 'form', 'project', 'externalId', 'tags', 'subscription'] as const

export type LeadFieldType = (typeof LEAD_FIELD_TYPES)[number]
export type LeadFileKind = (typeof LEAD_FILE_KINDS)[number]
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
  /** `file` only ('' otherwise): which files it takes, and how large one may be. */
  accept: LeadFileKind | ''
  maxMB: number
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
  /** The language the form is written in; `translations` carry its words in others (one per language tag). */
  locale: string
  translations: LeadFormTranslations
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

/** A field as a site or an app receives it: its words in the language asked for, and what each option says there (`options` stay the values to send). */
export type PublicLeadField = LeadFormField & { optionLabels: string[] }

/** What a site or an app receives. */
export type PublicLeadForm = {
  key: string
  name: string
  /** The language of these words: the one asked for when the form has it, else its own. */
  locale: string
  /** Every language the form has (its own first). */
  locales: string[]
  fields: PublicLeadField[]
  content: LeadFormContent
  /** `accent` is the project's when the form leaves it empty. */
  style: LeadFormStyle
  /** The finished look: the project's style (light and dark, shadow…) with this form's own fields over it. */
  look: ResolvedStyle
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
  email: 'Email', name: 'Name', text: 'Text', textarea: 'Message', number: 'Number', url: 'Website', phone: 'Phone', select: 'Choose one', checkbox: 'I agree', file: 'Attach a file'
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
  id: newFieldId(), key: type === 'email' || type === 'name' ? type : fieldKeyFrom(extra.label || LEAD_FIELD_LABELS[type]), type, label: LEAD_FIELD_LABELS[type], placeholder: '', required: type === 'email', options: [],
  accept: type === 'file' ? 'any' : '', maxMB: type === 'file' ? 10 : 0, ...extra
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
    if (type === 'file' && fields.filter(f => f.type === 'file').length >= LEAD_FORM_LIMITS.files) { errors.push(`${at}: a form has at most ${LEAD_FORM_LIMITS.files} file fields`); continue }
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
    let accept: LeadFileKind | '' = ''
    let maxMB = 0
    if (type === 'file') {
      accept = raw.accept === undefined ? 'any' : raw.accept as LeadFileKind
      if (!LEAD_FILE_KINDS.includes(accept as LeadFileKind)) { errors.push(`${at}: accept is one of ${LEAD_FILE_KINDS.join(', ')}`); accept = 'any' }
      maxMB = raw.maxMB === undefined ? 10 : Number(raw.maxMB)
      if (!Number.isInteger(maxMB) || maxMB < 1 || maxMB > LEAD_FORM_LIMITS.fileMB) { errors.push(`${at}: maxMB is a whole number from 1 to ${LEAD_FORM_LIMITS.fileMB}`); maxMB = 10 }
    }
    fields.push({
      id,
      key,
      type,
      label,
      placeholder: type === 'checkbox' || type === 'select' || type === 'file' ? '' : text(raw, 'placeholder', LEAD_FORM_LIMITS.placeholder, errors, `${at}: placeholder`),
      // The address is what the form is for.
      required: type === 'email' ? true : raw.required === true,
      options,
      accept,
      maxMB
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
  const fields = list.map((item): LeadFormField => {
    const f = record(item)
    const type = (LEAD_FIELD_TYPES.includes(f.type as LeadFieldType) ? f.type : 'text') as LeadFieldType
    return {
      id: String(f.id || ''), key: String(f.key || ''), type, label: String(f.label || ''), placeholder: String(f.placeholder || ''), required: f.required === true, options: Array.isArray(f.options) ? f.options.map(String) : [],
      accept: type === 'file' ? (LEAD_FILE_KINDS.includes(f.accept as LeadFileKind) ? f.accept as LeadFileKind : 'any') : '',
      maxMB: type === 'file' ? Number(f.maxMB) || 10 : 0
    }
  })
  return fields.some(f => f.type === 'email') ? fields : [field('email'), ...fields]
}

// ---- the words HelpBites adds ------------------------------------------------------

/**
 * What the form itself says around the operator's words (validation, the
 * confirm page, the built-in confirmation email, the embed's errors), by
 * language. A form shown in another language gets English. public/forms.js
 * carries the words it needs (tests/leadForms.test.ts keeps them in step).
 */
export const LEAD_FORM_WORDS = {
  en: {
    optional: '(optional)', invalidEmail: 'Enter a valid email address', required: '{label} is required', tick: '{label}: tick the box to continue',
    number: '{label} must be a number', url: '{label} must be a web address', phone: '{label} must be a phone number', choice: '{label}: pick one of the options',
    fileType: '{label}: this kind of file is not accepted', fileSize: '{label}: the file is larger than {mb} MB', fileHint: 'Up to {mb} MB',
    confirmTitle: 'Confirm your email', confirmBody: 'One click and you are on the list.', confirmButton: 'Confirm my email',
    expiredTitle: 'This link has expired', expiredBody: 'Confirmation links work for seven days. Sign up again to get a new one.',
    closedTitle: 'This form is closed', closedBody: 'It may have been moved or taken down.',
    emailSubject: 'Confirm your email for {name}', emailBody: 'Please confirm you want to hear from {name}. If you did not sign up, ignore this message: you will not hear from us.',
    hello: 'Hi {name},', helloThere: 'Hi there,', emailReason: 'You get this email because this address was used to sign up for {name}.',
    tooMany: 'Too many tries. Wait a moment and try again.', failed: 'Something went wrong. Please try again.', offline: 'Could not reach the server. Check your connection and try again.'
  },
  es: {
    optional: '(opcional)', invalidEmail: 'Escribe un correo electrónico válido', required: '{label} es obligatorio', tick: '{label}: marca la casilla para continuar',
    number: '{label} debe ser un número', url: '{label} debe ser una dirección web', phone: '{label} debe ser un número de teléfono', choice: '{label}: elige una de las opciones',
    fileType: '{label}: este tipo de archivo no se acepta', fileSize: '{label}: el archivo ocupa más de {mb} MB', fileHint: 'Hasta {mb} MB',
    confirmTitle: 'Confirma tu correo', confirmBody: 'Un clic y ya estás en la lista.', confirmButton: 'Confirmar mi correo',
    expiredTitle: 'Este enlace ha caducado', expiredBody: 'Los enlaces de confirmación duran siete días. Vuelve a registrarte para recibir uno nuevo.',
    closedTitle: 'Este formulario está cerrado', closedBody: 'Puede que se haya movido o retirado.',
    emailSubject: 'Confirma tu correo para {name}', emailBody: 'Confirma que quieres recibir noticias de {name}. Si no te has registrado, ignora este mensaje: no volverás a saber de nosotros.',
    hello: 'Hola, {name}:', helloThere: 'Hola:', emailReason: 'Recibes este correo porque esta dirección se usó para registrarse en {name}.',
    tooMany: 'Demasiados intentos. Espera un momento y vuelve a intentarlo.', failed: 'Algo ha fallado. Vuelve a intentarlo.', offline: 'No se ha podido conectar con el servidor. Comprueba tu conexión y vuelve a intentarlo.'
  },
  ca: {
    optional: '(opcional)', invalidEmail: 'Escriu una adreça electrònica vàlida', required: '{label} és obligatori', tick: '{label}: marca la casella per continuar',
    number: '{label} ha de ser un número', url: '{label} ha de ser una adreça web', phone: '{label} ha de ser un número de telèfon', choice: '{label}: tria una de les opcions',
    fileType: '{label}: aquest tipus de fitxer no s’accepta', fileSize: '{label}: el fitxer ocupa més de {mb} MB', fileHint: 'Fins a {mb} MB',
    confirmTitle: 'Confirma el teu correu', confirmBody: 'Un clic i ja ets a la llista.', confirmButton: 'Confirma el meu correu',
    expiredTitle: 'Aquest enllaç ha caducat', expiredBody: 'Els enllaços de confirmació duren set dies. Torna a registrar-te per rebre’n un de nou.',
    closedTitle: 'Aquest formulari està tancat', closedBody: 'Potser s’ha mogut o retirat.',
    emailSubject: 'Confirma el teu correu per a {name}', emailBody: 'Confirma que vols rebre notícies de {name}. Si no t’has registrat, ignora aquest missatge: no en sabràs res més.',
    hello: 'Hola, {name}:', helloThere: 'Hola:', emailReason: 'Reps aquest correu perquè aquesta adreça s’ha fet servir per registrar-se a {name}.',
    tooMany: 'Massa intents. Espera un moment i torna-ho a provar.', failed: 'Alguna cosa ha fallat. Torna-ho a provar.', offline: 'No s’ha pogut connectar amb el servidor. Comprova la connexió i torna-ho a provar.'
  },
  fr: {
    optional: '(facultatif)', invalidEmail: 'Saisissez une adresse e-mail valide', required: '{label} est obligatoire', tick: '{label} : cochez la case pour continuer',
    number: '{label} doit être un nombre', url: '{label} doit être une adresse web', phone: '{label} doit être un numéro de téléphone', choice: '{label} : choisissez une des options',
    fileType: '{label} : ce type de fichier n’est pas accepté', fileSize: '{label} : le fichier dépasse {mb} Mo', fileHint: 'Jusqu’à {mb} Mo',
    confirmTitle: 'Confirmez votre e-mail', confirmBody: 'Un clic et vous êtes sur la liste.', confirmButton: 'Confirmer mon e-mail',
    expiredTitle: 'Ce lien a expiré', expiredBody: 'Les liens de confirmation sont valables sept jours. Inscrivez-vous à nouveau pour en recevoir un nouveau.',
    closedTitle: 'Ce formulaire est fermé', closedBody: 'Il a peut-être été déplacé ou retiré.',
    emailSubject: 'Confirmez votre e-mail pour {name}', emailBody: 'Confirmez que vous souhaitez recevoir des nouvelles de {name}. Si vous ne vous êtes pas inscrit, ignorez ce message : vous n’entendrez plus parler de nous.',
    hello: 'Bonjour {name},', helloThere: 'Bonjour,', emailReason: 'Vous recevez cet e-mail parce que cette adresse a été utilisée pour s’inscrire à {name}.',
    tooMany: 'Trop de tentatives. Patientez un instant et réessayez.', failed: 'Une erreur est survenue. Veuillez réessayer.', offline: 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.'
  },
  de: {
    optional: '(optional)', invalidEmail: 'Gib eine gültige E-Mail-Adresse ein', required: '{label} ist erforderlich', tick: '{label}: Setze das Häkchen, um fortzufahren',
    number: '{label} muss eine Zahl sein', url: '{label} muss eine Webadresse sein', phone: '{label} muss eine Telefonnummer sein', choice: '{label}: Wähle eine der Optionen',
    fileType: '{label}: Diese Art von Datei wird nicht angenommen', fileSize: '{label}: Die Datei ist größer als {mb} MB', fileHint: 'Bis zu {mb} MB',
    confirmTitle: 'Bestätige deine E-Mail-Adresse', confirmBody: 'Ein Klick und du stehst auf der Liste.', confirmButton: 'E-Mail-Adresse bestätigen',
    expiredTitle: 'Dieser Link ist abgelaufen', expiredBody: 'Bestätigungslinks gelten sieben Tage. Melde dich erneut an, um einen neuen zu erhalten.',
    closedTitle: 'Dieses Formular ist geschlossen', closedBody: 'Es wurde vielleicht verschoben oder entfernt.',
    emailSubject: 'Bestätige deine E-Mail-Adresse für {name}', emailBody: 'Bitte bestätige, dass du Nachrichten von {name} erhalten möchtest. Wenn du dich nicht angemeldet hast, ignoriere diese Nachricht: Du hörst dann nichts mehr von uns.',
    hello: 'Hallo {name},', helloThere: 'Hallo,', emailReason: 'Du erhältst diese E-Mail, weil diese Adresse für eine Anmeldung bei {name} verwendet wurde.',
    tooMany: 'Zu viele Versuche. Warte einen Moment und versuche es erneut.', failed: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.', offline: 'Der Server ist nicht erreichbar. Prüfe deine Verbindung und versuche es erneut.'
  },
  it: {
    optional: '(facoltativo)', invalidEmail: 'Inserisci un indirizzo email valido', required: '{label} è obbligatorio', tick: '{label}: spunta la casella per continuare',
    number: '{label} deve essere un numero', url: '{label} deve essere un indirizzo web', phone: '{label} deve essere un numero di telefono', choice: '{label}: scegli una delle opzioni',
    fileType: '{label}: questo tipo di file non è accettato', fileSize: '{label}: il file supera {mb} MB', fileHint: 'Fino a {mb} MB',
    confirmTitle: 'Conferma la tua email', confirmBody: 'Un clic e sei nella lista.', confirmButton: 'Conferma la mia email',
    expiredTitle: 'Questo link è scaduto', expiredBody: 'I link di conferma valgono sette giorni. Iscriviti di nuovo per riceverne uno nuovo.',
    closedTitle: 'Questo modulo è chiuso', closedBody: 'Potrebbe essere stato spostato o rimosso.',
    emailSubject: 'Conferma la tua email per {name}', emailBody: 'Conferma che vuoi ricevere notizie da {name}. Se non ti sei iscritto, ignora questo messaggio: non riceverai altro da noi.',
    hello: 'Ciao {name},', helloThere: 'Ciao,', emailReason: 'Ricevi questa email perché questo indirizzo è stato usato per iscriversi a {name}.',
    tooMany: 'Troppi tentativi. Attendi un momento e riprova.', failed: 'Qualcosa è andato storto. Riprova.', offline: 'Impossibile raggiungere il server. Controlla la connessione e riprova.'
  },
  pt: {
    optional: '(opcional)', invalidEmail: 'Digite um e-mail válido', required: '{label} é obrigatório', tick: '{label}: marque a caixa para continuar',
    number: '{label} deve ser um número', url: '{label} deve ser um endereço web', phone: '{label} deve ser um número de telefone', choice: '{label}: escolha uma das opções',
    fileType: '{label}: este tipo de arquivo não é aceito', fileSize: '{label}: o arquivo tem mais de {mb} MB', fileHint: 'Até {mb} MB',
    confirmTitle: 'Confirme seu e-mail', confirmBody: 'Um clique e você está na lista.', confirmButton: 'Confirmar meu e-mail',
    expiredTitle: 'Este link expirou', expiredBody: 'Os links de confirmação valem por sete dias. Cadastre-se de novo para receber um novo.',
    closedTitle: 'Este formulário está fechado', closedBody: 'Ele pode ter sido movido ou removido.',
    emailSubject: 'Confirme seu e-mail para {name}', emailBody: 'Confirme que você quer receber notícias de {name}. Se você não se cadastrou, ignore esta mensagem: você não receberá mais nada de nós.',
    hello: 'Olá, {name},', helloThere: 'Olá,', emailReason: 'Você está recebendo este e-mail porque este endereço foi usado para se cadastrar em {name}.',
    tooMany: 'Muitas tentativas. Aguarde um momento e tente de novo.', failed: 'Algo deu errado. Tente de novo.', offline: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente de novo.'
  },
  ja: {
    optional: '(任意)', invalidEmail: '有効なメールアドレスを入力してください', required: '{label}は必須です', tick: '{label}: 続けるにはチェックを入れてください',
    number: '{label}には数値を入力してください', url: '{label}にはウェブアドレスを入力してください', phone: '{label}には電話番号を入力してください', choice: '{label}: 選択肢から1つ選んでください',
    fileType: '{label}: この種類のファイルは受け付けていません', fileSize: '{label}: ファイルが{mb} MBを超えています', fileHint: '{mb} MBまで',
    confirmTitle: 'メールアドレスの確認', confirmBody: 'ワンクリックで登録が完了します。', confirmButton: 'メールアドレスを確認',
    expiredTitle: 'このリンクは期限切れです', expiredBody: '確認リンクの有効期限は7日間です。もう一度登録して新しいリンクを受け取ってください。',
    closedTitle: 'このフォームは受付を終了しました', closedBody: '移動または削除された可能性があります。',
    emailSubject: '{name}のメールアドレス確認', emailBody: '{name}からのお知らせを受け取るには、メールアドレスを確認してください。心当たりがない場合は、このメールを無視してください。今後ご連絡することはありません。',
    hello: '{name}様', helloThere: 'こんにちは。', emailReason: 'このメールは、このアドレスで{name}への登録があったためお送りしています。',
    tooMany: '試行回数が多すぎます。しばらくしてからもう一度お試しください。', failed: 'エラーが発生しました。もう一度お試しください。', offline: 'サーバーに接続できませんでした。接続を確認して、もう一度お試しください。'
  },
  ko: {
    optional: '(선택)', invalidEmail: '올바른 이메일 주소를 입력하세요', required: '{label}은(는) 필수입니다', tick: '{label}: 계속하려면 체크하세요',
    number: '{label}에는 숫자를 입력하세요', url: '{label}에는 웹 주소를 입력하세요', phone: '{label}에는 전화번호를 입력하세요', choice: '{label}: 옵션 중 하나를 고르세요',
    fileType: '{label}: 이 형식의 파일은 받을 수 없습니다', fileSize: '{label}: 파일이 {mb}MB보다 큽니다', fileHint: '최대 {mb}MB',
    confirmTitle: '이메일 확인', confirmBody: '한 번만 누르면 명단에 등록됩니다.', confirmButton: '이메일 확인하기',
    expiredTitle: '만료된 링크입니다', expiredBody: '확인 링크는 7일 동안 유효합니다. 다시 가입하면 새 링크를 받을 수 있습니다.',
    closedTitle: '마감된 양식입니다', closedBody: '이동되었거나 삭제되었을 수 있습니다.',
    emailSubject: '{name} 이메일 주소를 확인해 주세요', emailBody: '{name}의 소식을 받으려면 이메일 주소를 확인해 주세요. 가입한 적이 없다면 이 메일을 무시하세요. 더 이상 연락드리지 않습니다.',
    hello: '{name}님, 안녕하세요.', helloThere: '안녕하세요.', emailReason: '이 주소로 {name}에 가입 신청이 있어 이 메일을 보내드립니다.',
    tooMany: '시도 횟수가 너무 많습니다. 잠시 후 다시 시도하세요.', failed: '문제가 발생했습니다. 다시 시도하세요.', offline: '서버에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요.'
  },
  zh: {
    optional: '(选填)', invalidEmail: '请输入有效的邮箱地址', required: '{label}为必填项', tick: '{label}：请勾选后继续',
    number: '{label}必须是数字', url: '{label}必须是网址', phone: '{label}必须是电话号码', choice: '{label}：请从选项中选择一项',
    fileType: '{label}：不接受此类文件', fileSize: '{label}：文件超过 {mb} MB', fileHint: '最大 {mb} MB',
    confirmTitle: '确认你的邮箱', confirmBody: '点击一下即可加入名单。', confirmButton: '确认我的邮箱',
    expiredTitle: '此链接已过期', expiredBody: '确认链接的有效期为七天。请重新注册以获取新链接。',
    closedTitle: '此表单已关闭', closedBody: '它可能已被移动或下线。',
    emailSubject: '确认你在 {name} 的邮箱', emailBody: '请确认你希望收到 {name} 的消息。如果你没有注册，请忽略这封邮件：我们不会再联系你。',
    hello: '{name}，你好：', helloThere: '你好：', emailReason: '你收到这封邮件，是因为有人用这个地址注册了 {name}。',
    tooMany: '尝试次数过多，请稍后再试。', failed: '出了点问题，请重试。', offline: '无法连接服务器，请检查网络后重试。'
  }
} as const

export type LeadFormWords = { [K in keyof typeof LEAD_FORM_WORDS.en]: string }
/** The words public/forms.js carries itself. */
export const EMBED_WORD_KEYS = ['optional', 'tooMany', 'failed', 'offline', 'fileSize', 'fileHint'] as const

/** The built-in words for a language tag (its base language, `pt-BR` → `pt`), English when there are none. */
export function leadFormWords(locale: string | null | undefined): LeadFormWords {
  const base = String(locale || '').toLowerCase().split('-')[0] as keyof typeof LEAD_FORM_WORDS
  return LEAD_FORM_WORDS[base] || LEAD_FORM_WORDS.en
}

/** `{label} is required` with the blanks filled. */
export function fillWords(words: string, values: Record<string, string | number>): string {
  return words.replace(/\{(\w+)\}/g, (match, key: string) => (values[key] === undefined ? match : String(values[key])))
}

// ---- a submission ----------------------------------------------------------------

export type LeadSubmission = { email: string, name: string, attributes: Record<string, ContactAttributeValue>, bot: boolean }

const TRUE = new Set(['true', 'on', 'yes', '1'])

/**
 * What someone typed, checked against the form's fields: a JSON body, a plain
 * HTML form or a multipart one (every value a string). `website` is the
 * honeypot: people leave it empty, bots fill it in. Unknown keys and file
 * fields (checkLeadFiles) are left to others. `words` say what is wrong in the
 * visitor's language; `aliases` map what a translated option says back to the
 * option itself (leadOptionAliases), so a client that sends the words it showed
 * is understood.
 */
export function readLeadSubmission(fields: LeadFormField[], body: Record<string, unknown>, options: { words?: LeadFormWords, aliases?: Record<string, Record<string, string>> } = {}): { submission: LeadSubmission, errors: string[] } {
  const words = options.words || LEAD_FORM_WORDS.en
  const errors: string[] = []
  const submission: LeadSubmission = { email: '', name: '', attributes: {}, bot: Boolean(String(body.website ?? '').trim()) }
  for (const f of fields) {
    if (f.type === 'file') continue
    const raw = body[f.key]
    const blank = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())
    const say = (template: string) => fillWords(template, { label: f.label || LEAD_FIELD_LABELS[f.type] })
    if (f.type === 'checkbox') {
      const on = raw === true || TRUE.has(String(raw ?? '').trim().toLowerCase())
      if (f.required && !on) errors.push(say(words.tick))
      else submission.attributes[f.key] = on
      continue
    }
    if (blank) {
      if (f.required) errors.push(f.type === 'email' ? words.invalidEmail : say(words.required))
      continue
    }
    const value = typeof raw === 'string' ? raw.trim() : raw
    switch (f.type) {
      case 'email': {
        const email = normalizeEmail(value)
        if (!email) errors.push(words.invalidEmail)
        else submission.email = email
        break
      }
      case 'name': submission.name = String(value).slice(0, CONTACT_LIMITS.name); break
      case 'number': {
        const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
        if (!Number.isFinite(n)) errors.push(say(words.number))
        else submission.attributes[f.key] = n
        break
      }
      case 'url': {
        const url = safeHttpUrl(String(value))
        if (!url || url.length > CONTACT_LIMITS.attributeValue) errors.push(say(words.url))
        else submission.attributes[f.key] = url
        break
      }
      case 'phone': {
        if (!PHONE.test(String(value))) errors.push(say(words.phone))
        else submission.attributes[f.key] = String(value)
        break
      }
      case 'select': {
        const option = f.options.includes(String(value)) ? String(value) : options.aliases?.[f.key]?.[String(value)]
        if (!option) errors.push(say(words.choice))
        else submission.attributes[f.key] = option
        break
      }
      case 'textarea': submission.attributes[f.key] = String(value).slice(0, LEAD_FORM_LIMITS.textarea); break
      default: submission.attributes[f.key] = String(value).slice(0, LEAD_FORM_LIMITS.text)
    }
  }
  return { submission, errors }
}

// ---- uploads -----------------------------------------------------------------------

type FileType = { ext: string, mime: string }
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))
const startsWith = (b: Uint8Array, bytes: number[]) => bytes.every((v, i) => b[i] === v)
const ZIP = [0x50, 0x4B, 0x03, 0x04]
const OLE = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]

// Recognised by their first bytes: the name does not matter.
const IMAGES: Array<FileType & { test: (b: Uint8Array) => boolean }> = [
  { ext: 'png', mime: 'image/png', test: b => startsWith(b, [0x89, 0x50, 0x4E, 0x47]) },
  { ext: 'jpg', mime: 'image/jpeg', test: b => startsWith(b, [0xFF, 0xD8, 0xFF]) },
  { ext: 'gif', mime: 'image/gif', test: b => ascii(b, 0, 4) === 'GIF8' },
  { ext: 'webp', mime: 'image/webp', test: b => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' }
]
// Container formats share their first bytes: the name says which one, the bytes must agree.
const DOCUMENTS: Record<string, FileType & { test: (b: Uint8Array) => boolean }> = {
  pdf: { ext: 'pdf', mime: 'application/pdf', test: b => ascii(b, 0, 5) === '%PDF-' },
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', test: b => startsWith(b, ZIP) },
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', test: b => startsWith(b, ZIP) },
  pptx: { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', test: b => startsWith(b, ZIP) },
  odt: { ext: 'odt', mime: 'application/vnd.oasis.opendocument.text', test: b => startsWith(b, ZIP) },
  ods: { ext: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet', test: b => startsWith(b, ZIP) },
  doc: { ext: 'doc', mime: 'application/msword', test: b => startsWith(b, OLE) },
  xls: { ext: 'xls', mime: 'application/vnd.ms-excel', test: b => startsWith(b, OLE) },
  rtf: { ext: 'rtf', mime: 'application/rtf', test: b => ascii(b, 0, 5) === '{\\rtf' },
  // Text has no signature: no NUL byte in its first 4 KB is the best check there is.
  txt: { ext: 'txt', mime: 'text/plain', test: b => !b.subarray(0, 4096).includes(0) },
  csv: { ext: 'csv', mime: 'text/csv', test: b => !b.subarray(0, 4096).includes(0) },
  md: { ext: 'md', mime: 'text/markdown', test: b => !b.subarray(0, 4096).includes(0) }
}
const ARCHIVES: Record<string, FileType & { test: (b: Uint8Array) => boolean }> = {
  zip: { ext: 'zip', mime: 'application/zip', test: b => startsWith(b, ZIP) }
}

/** The extensions a kind takes, for a file input's `accept` and the panel's wording. */
export const LEAD_FILE_EXTENSIONS: Record<LeadFileKind, string[]> = {
  images: IMAGES.map(t => t.ext).concat('jpeg'),
  documents: Object.keys(DOCUMENTS),
  any: [...IMAGES.map(t => t.ext), 'jpeg', ...Object.keys(DOCUMENTS), ...Object.keys(ARCHIVES)]
}

/** What a file really is, when `kind` takes it; null otherwise. Pictures are recognised by their bytes, documents by name and bytes together. */
export function detectLeadFile(data: Uint8Array, filename: string, kind: LeadFileKind): FileType | null {
  if (!data.length) return null
  const image = IMAGES.find(t => t.test(data))
  if (image) return kind === 'documents' ? null : { ext: image.ext, mime: image.mime }
  if (kind === 'images') return null
  const ext = (String(filename).split('.').pop() || '').toLowerCase()
  const known = DOCUMENTS[ext] || (kind === 'any' ? ARCHIVES[ext] : undefined)
  return known?.test(data) ? { ext: known.ext, mime: known.mime } : null
}

/** A file name safe to keep and to offer back: no path, no control characters. */
export function leadFileName(name: string, ext: string): string {
  const base = String(name || '').split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N}.\- _()]+/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 120)
  return base || `file.${ext}`
}

export type UploadedLeadFile = { filename: string, data: Uint8Array }
export type AcceptedLeadFile = { field: LeadFormField, name: string, ext: string, mime: string, data: Uint8Array }

/** The files of a submission checked against the form's file fields: one per field, of a kind it takes, within its size. */
export function checkLeadFiles(fields: LeadFormField[], files: Record<string, UploadedLeadFile | undefined>, words: LeadFormWords = LEAD_FORM_WORDS.en): { files: AcceptedLeadFile[], errors: string[] } {
  const accepted: AcceptedLeadFile[] = []
  const errors: string[] = []
  for (const f of fields) {
    if (f.type !== 'file') continue
    const file = files[f.key]
    const label = f.label || LEAD_FIELD_LABELS.file
    if (!file || !file.data.length) {
      if (f.required) errors.push(fillWords(words.required, { label }))
      continue
    }
    if (file.data.length > f.maxMB * 1024 * 1024) { errors.push(fillWords(words.fileSize, { label, mb: f.maxMB })); continue }
    const type = detectLeadFile(file.data, file.filename, (f.accept || 'any') as LeadFileKind)
    if (!type) { errors.push(fillWords(words.fileType, { label })); continue }
    accepted.push({ field: f, name: leadFileName(file.filename, type.ext), ...type, data: file.data })
  }
  return { files: accepted, errors }
}

/** The most a multipart submission to this form can weigh: its file fields' limits, plus room for the rest. */
export function leadFormMaxBytes(fields: LeadFormField[]): number {
  return fields.filter(f => f.type === 'file').reduce((sum, f) => sum + f.maxMB * 1024 * 1024, 0) + 1024 * 1024
}

/** A stored upload as the panel and the API list it. */
export type LeadFile = { id: string, formId: string, contactId: string, field: string, name: string, mime: string, size: number, createdAt: string | null }

// ---- translations --------------------------------------------------------------------

/** The words of a field a translation replaces; `options` line up with the field's own, and an empty one falls back. */
export type LeadFieldText = { label: string, placeholder: string, options: string[] }
/** One language of a form: its words, and each field's by field id. */
export type LeadFormTranslation = { content: Partial<LeadFormContent>, fields: Record<string, Partial<LeadFieldText>> }
export type LeadFormTranslations = Record<string, LeadFormTranslation>

const CONTENT_KEYS: Array<keyof LeadFormContent> = ['title', 'description', 'buttonLabel', 'successTitle', 'successMessage', 'confirmMessage', 'footnote']
const CONTENT_LIMITS: Record<keyof LeadFormContent, number> = {
  title: LEAD_FORM_LIMITS.title, description: LEAD_FORM_LIMITS.description, buttonLabel: LEAD_FORM_LIMITS.button,
  successTitle: LEAD_FORM_LIMITS.title, successMessage: LEAD_FORM_LIMITS.message, confirmMessage: LEAD_FORM_LIMITS.message, footnote: LEAD_FORM_LIMITS.message
}

/** A form's own language: a valid tag, else English. */
export const leadFormLocaleOf = (value: unknown): string => normalizeLocale(value) || DEFAULT_CONTENT_LOCALE

/** The words of a field a translator works on: its label, its placeholder (when it shows one), its options. */
const fieldTexts = (f: LeadFormField): Array<'label' | 'placeholder'> => (f.type === 'checkbox' || f.type === 'select' || f.type === 'file' ? ['label'] : ['label', 'placeholder'])

/**
 * Translations as sent by an operator, on top of `base`: a language that is
 * present replaces that language, `null` removes it. Field ids no field has
 * are dropped.
 */
export function validateLeadTranslations(value: unknown, fields: LeadFormField[], source: string, base: LeadFormTranslations = {}): { translations: LeadFormTranslations, errors: string[] } {
  const errors: string[] = []
  const out: LeadFormTranslations = { ...base }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { translations: out, errors: ['translations must be an object keyed by language'] }
  const byId = new Map(fields.map(f => [f.id, f]))
  for (const [rawTag, raw] of Object.entries(value as Record<string, unknown>)) {
    const tag = normalizeLocale(rawTag)
    if (!tag) { errors.push(`"${rawTag.slice(0, 20)}" is not a language tag`); continue }
    if (tag.toLowerCase() === source.toLowerCase()) { errors.push(`${tag} is the form's own language`); continue }
    if (raw === null) { delete out[tag]; continue }
    const entry = record(raw)
    const translation: LeadFormTranslation = { content: {}, fields: {} }
    const content = record(entry.content)
    for (const key of CONTENT_KEYS) {
      const word = text(content, key, CONTENT_LIMITS[key], errors, `${tag}: content.${key}`)
      if (word) translation.content[key] = word
    }
    for (const [id, rawField] of Object.entries(record(entry.fields))) {
      const f = byId.get(id)
      if (!f) continue
      const r = record(rawField)
      const words: Partial<LeadFieldText> = {}
      for (const key of fieldTexts(f)) {
        const word = text(r, key, key === 'label' ? LEAD_FORM_LIMITS.label : LEAD_FORM_LIMITS.placeholder, errors, `${tag}: ${f.key}.${key}`)
        if (word) words[key] = word
      }
      const options = r.options
      if (f.type === 'select' && Array.isArray(options)) {
        const list = f.options.map((_, i) => String(options[i] ?? '').trim().slice(0, LEAD_FORM_LIMITS.option))
        if (list.some(Boolean)) words.options = list
      }
      if (Object.keys(words).length) translation.fields[id] = words
    }
    out[tag] = translation
  }
  if (Object.keys(out).length > LEAD_FORM_MAX_LOCALES) errors.push(`A form has at most ${LEAD_FORM_MAX_LOCALES} translations`)
  return { translations: out, errors }
}

/** Saved translations as they are, without re-checking (they were checked on write). */
export function leadTranslationsOf(value: unknown): LeadFormTranslations {
  const out: LeadFormTranslations = {}
  for (const [tag, raw] of Object.entries(record(value))) {
    const entry = record(raw)
    const content: Partial<LeadFormContent> = {}
    for (const key of CONTENT_KEYS) if (typeof record(entry.content)[key] === 'string' && record(entry.content)[key]) content[key] = record(entry.content)[key] as string
    const fields: LeadFormTranslation['fields'] = {}
    for (const [id, f] of Object.entries(record(entry.fields))) {
      const r = record(f)
      const words: Partial<LeadFieldText> = {}
      if (typeof r.label === 'string' && r.label) words.label = r.label
      if (typeof r.placeholder === 'string' && r.placeholder) words.placeholder = r.placeholder
      if (Array.isArray(r.options)) words.options = r.options.map(o => String(o ?? ''))
      if (Object.keys(words).length) fields[id] = words
    }
    out[tag] = { content, fields }
  }
  return out
}

/** Every string a translator works on, by a flat key (`content.title`, `<fieldId>.label`, `<fieldId>.options.2`). Empty ones are left out. */
export function leadFormTexts(content: LeadFormContent, fields: LeadFormField[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of CONTENT_KEYS) if (content[key].trim()) out[`content.${key}`] = content[key]
  for (const f of fields) {
    // A field left without a label shows its default one, which needs a translation too.
    for (const key of fieldTexts(f)) {
      const value = key === 'label' ? f.label || LEAD_FIELD_LABELS[f.type] : f[key]
      if (value.trim()) out[`${f.id}.${key}`] = value
    }
    if (f.type === 'select') f.options.forEach((option, i) => { if (option.trim()) out[`${f.id}.options.${i}`] = option })
  }
  return out
}

/** The flat texts of an existing translation, in the shape leadFormTexts uses. */
export function leadTranslationTexts(translation: LeadFormTranslation | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!translation) return out
  for (const key of CONTENT_KEYS) if (translation.content[key]) out[`content.${key}`] = translation.content[key]!
  for (const [id, words] of Object.entries(translation.fields)) {
    if (words.label) out[`${id}.label`] = words.label
    if (words.placeholder) out[`${id}.placeholder`] = words.placeholder
    words.options?.forEach((option, i) => { if (option) out[`${id}.options.${i}`] = option })
  }
  return out
}

/** Flat texts (as translateStrings returns them) back into a translation. */
export function leadTranslationFromTexts(texts: Record<string, string>, fields: LeadFormField[]): LeadFormTranslation {
  const translation: LeadFormTranslation = { content: {}, fields: {} }
  for (const key of CONTENT_KEYS) if (texts[`content.${key}`]) translation.content[key] = texts[`content.${key}`]
  for (const f of fields) {
    const words: Partial<LeadFieldText> = {}
    for (const key of fieldTexts(f)) if (texts[`${f.id}.${key}`]) words[key] = texts[`${f.id}.${key}`]
    if (f.type === 'select') {
      const options = f.options.map((_, i) => texts[`${f.id}.options.${i}`] || '')
      if (options.some(Boolean)) words.options = options
    }
    if (Object.keys(words).length) translation.fields[f.id] = words
  }
  return translation
}

/** The form's words in one language: each translated word replaces the original, anything missing stays in the form's own language. Options keep their values; `optionLabels` say what they show. */
export function localizeLeadForm(content: LeadFormContent, fields: LeadFormField[], translation: LeadFormTranslation | undefined): { content: LeadFormContent, fields: PublicLeadField[] } {
  return {
    content: { ...content, ...translation?.content },
    fields: fields.map((f) => {
      const words = translation?.fields[f.id]
      return {
        ...f,
        label: words?.label || f.label,
        placeholder: words?.placeholder || f.placeholder,
        optionLabels: f.options.map((option, i) => words?.options?.[i] || option)
      }
    })
  }
}

/** For each choice field, what its options say in every language, mapped back to the options: a client may send the words it showed. */
export function leadOptionAliases(fields: LeadFormField[], translations: LeadFormTranslations): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const f of fields) {
    if (f.type !== 'select') continue
    const map: Record<string, string> = {}
    for (const translation of Object.values(translations)) translation.fields[f.id]?.options?.forEach((label, i) => { if (label && f.options[i] && !f.options.includes(label)) map[label] = f.options[i]! })
    if (Object.keys(map).length) out[f.key] = map
  }
  return out
}
