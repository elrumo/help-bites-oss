import { emptyDocument, walkBlocks, type EmailDocument } from './blocks'
import { applyTemplateVariables } from './placeholders'
import { currentTheme } from './theme'
import { componentValue } from './render'

// The one render pipeline: panel preview, share page and the send API all go
// through resolveTemplate, so what an operator previews is what gets sent.
//
// A master template is designed once and linked into projects. A linked row
// keeps no document of its own; it renders the master with the project's
// brand (`project.*` variables, accent on buttons) and its own variable
// values. Own and detached templates render as designed.

export type TemplateVariable = { key: string, label?: string, defaultValue?: string }

/**
 * The slice of a project a template can see. The server builds it with brandOf()
 * (emails.ts); the panel passes the project itself, so every field after
 * `theme` is read where it exists and left out where it does not.
 */
export type EmailBrand = {
  name?: string
  brandLogoUrl?: string
  siteUrl?: string
  theme?: { accent?: string }
  address?: string
  /** The project's look (shared/projectLook.ts): wins over `brandLogoUrl` and `theme.accent`, which Settings edits as stored. */
  look?: { accent?: string, logoUrl?: string }
  /** The company profile (shared/company.ts). */
  company?: { name?: string, legalName?: string, address?: string, email?: string }
  /** The public pages of the published legal documents (shared/legal/links.ts). */
  legalLinks?: { privacyUrl?: string, termsUrl?: string, cookiesUrl?: string, refundUrl?: string }
}

/** The accent applied to buttons of a linked master: the look's, else the stored one. */
export const brandAccentOf = (brand: EmailBrand): string | undefined => brand.look?.accent || brand.theme?.accent

export type ResolvableTemplate = {
  name: string
  document: EmailDocument | null
  variables: TemplateVariable[]
  variableValues?: Record<string, string>
}

/** Reserved placeholders filled from the project; never set per template. */
export const BRAND_VARIABLE_PREFIX = 'project.'

/** Reserved placeholders filled per message at send time: `{{recipient.email}}`, `{{recipient.name}}`. */
export const RECIPIENT_VARIABLE_PREFIX = 'recipient.'

/** Every `{{project.*}}` placeholder, for lists, linting and the editor. Unknown ones are never filled with anything. */
export const PROJECT_VARIABLES = ['project.name', 'project.logoUrl', 'project.url', 'project.address', 'project.company', 'project.email', 'project.privacyUrl', 'project.termsUrl', 'project.cookiesUrl', 'project.refundUrl'] as const

export function projectBrandVars(brand: EmailBrand): Record<string, string> {
  const links = brand.legalLinks || {}
  const company = brand.company || {}
  // Every key is always present, '' when the project has no value: a blank, never a leaked `{{project.privacyUrl}}`.
  return {
    'project.name': brand.name || '',
    'project.logoUrl': brand.look?.logoUrl || brand.brandLogoUrl || '',
    'project.url': brand.siteUrl || '',
    // The postal address marketing email must carry (Project settings → Company).
    'project.address': company.address || brand.address || '',
    'project.company': company.name || company.legalName || brand.name || '',
    'project.email': company.email || '',
    // The public pages of the published legal documents; '' for a type with none.
    'project.privacyUrl': links.privacyUrl || '',
    'project.termsUrl': links.termsUrl || '',
    'project.cookiesUrl': links.cookiesUrl || '',
    'project.refundUrl': links.refundUrl || ''
  }
}

// YIQ brightness: dark text on light accents, white on everything else.
function onColor(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const brightness = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000
  return brightness > 150 ? '#111111' : '#ffffff'
}

/**
 * Swap the master's brand colour for the project accent on buttons and on
 * components' colour fields. Anything in another colour was picked on purpose
 * and stays. Not applyThemeToDocument: on a document without a stored theme
 * that rewrites heading colours too.
 */
export function applyProjectAccent(doc: EmailDocument, accent: string | undefined): EmailDocument {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return doc
  const brand = currentTheme(doc).brand.toLowerCase()
  const on = onColor(accent)
  // JSON round-trip, not structuredClone: the panel passes reactive proxies.
  const next: EmailDocument = JSON.parse(JSON.stringify(doc))
  walkBlocks(next.blocks, (b) => {
    if (b.type === 'button' && String(b.backgroundColor || '').toLowerCase() === brand) {
      b.backgroundColor = accent
      b.color = on
    }
    if (b.type === 'component') {
      for (const field of b.fields) {
        if (field.type === 'color' && componentValue(field, b.values).trim().toLowerCase() === brand) b.values = { ...b.values, [field.key]: accent }
      }
    }
  })
  return next
}

/**
 * Precedence: template defaults < project brand < the row's own values <
 * call-time values. `master` is set for a linked row; its document and
 * defaults replace the row's (empty) ones.
 */
export function resolveTemplate(
  row: ResolvableTemplate,
  opts: { master?: ResolvableTemplate | null, brand?: EmailBrand | null, values?: Record<string, string> } = {}
): { subject: string, document: EmailDocument } {
  const source = opts.master || row
  const vars: Record<string, string> = {}
  for (const v of source.variables || []) {
    if (v.defaultValue != null) vars[v.key] = v.defaultValue
  }
  if (opts.brand) Object.assign(vars, projectBrandVars(opts.brand))
  Object.assign(vars, row.variableValues || {}, opts.values || {})

  let doc = source.document || emptyDocument()
  if (opts.master && opts.brand) doc = applyProjectAccent(doc, brandAccentOf(opts.brand))
  const document = applyTemplateVariables(doc, vars)
  return { subject: document.settings.title || source.name, document }
}

/**
 * The variables a sender passes, each with what it falls back to for this row
 * (the project's own value, else the default). Brand placeholders come from
 * the project, so they are not listed.
 */
export function senderVariables(row: ResolvableTemplate, master?: ResolvableTemplate | null): TemplateVariable[] {
  const values = row.variableValues || {}
  return (master || row).variables
    .filter(v => !v.key.startsWith(BRAND_VARIABLE_PREFIX) && !v.key.startsWith(RECIPIENT_VARIABLE_PREFIX))
    .map(v => (values[v.key] !== undefined ? { ...v, defaultValue: values[v.key] } : v))
}

/** The plain-text part: the template's own text version when it has one, else derived from the HTML. */
export function plainTextFor(document: EmailDocument, html: string): string {
  const own = String(document.settings.text || '').replace(/\r\n/g, '\n').trim()
  return own || htmlToText(html)
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', mdash: '—', ndash: '–', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•',
  laquo: '«', raquo: '»', euro: '€', pound: '£'
}

/** Decode character references once (`&amp;lt;` becomes `&lt;`, as a browser shows it). */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, code: string) => {
    if (code.startsWith('#')) {
      const n = /^#x/i.test(code) ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10)
      return Number.isInteger(n) && n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : full
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? full
  })
}

/** Plain-text part for the HTML a template renders to. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(style|title|head|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Hidden preheaders belong to the inbox preview, not the text body.
    .replace(/<(div|span)\b[^>]*display\s*:\s*none[^>]*>[^<]*<\/\1>/gi, '')
    .replace(/<a\s[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      if (href.startsWith('#')) return label
      return label && decodeHtmlEntities(label) !== decodeHtmlEntities(href) ? `${label} (${href})` : href
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|li|table|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeHtmlEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
