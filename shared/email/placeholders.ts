import type { EmailDocument } from './blocks'

// `{{ key }}` fills in a value, `{{{ key }}}` fills it in raw. The difference
// only shows in raw HTML (custom HTML blocks, HTML sent through the API):
// there a `{{ key }}` value is HTML-escaped, so a name like `<b>Ada</b>`
// arrives as text, and `{{{ key }}}` is for values that are HTML on purpose
// (a pre-rendered list, a button row). Every other field is escaped or
// sanitized by the renderer, so both forms fill in the same there.
const PLACEHOLDER_RE = /\{\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}\}|\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g

export function escapeHtmlValue(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Fill the placeholders in one string. Unknown keys stay as written, so a
 * missing value shows up in the output instead of vanishing. `html: true`
 * escapes `{{ key }}` values; `{{{ key }}}` is never escaped.
 */
export function fillPlaceholders(value: string, vars: Record<string, string>, options: { html?: boolean } = {}): string {
  return value.replace(PLACEHOLDER_RE, (full, rawKey: string | undefined, key: string | undefined) => {
    const name = rawKey ?? key ?? ''
    if (!Object.hasOwn(vars, name)) return full
    const filled = String(vars[name] ?? '')
    return options.html && rawKey === undefined ? escapeHtmlValue(filled) : filled
  })
}

/** Every placeholder key in a string, in either form. */
export function placeholderKeys(value: string): string[] {
  const found = new Set<string>()
  for (const match of value.matchAll(PLACEHOLDER_RE)) found.add(match[1] ?? match[2] ?? '')
  found.delete('')
  return [...found]
}

function visit(value: unknown, vars: Record<string, string>, found?: Set<string>, html = false): unknown {
  if (typeof value === 'string') {
    if (found) for (const key of placeholderKeys(value)) found.add(key)
    return fillPlaceholders(value, vars, { html })
  }
  if (Array.isArray(value)) return value.map(item => visit(item, vars, found))
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  // Custom HTML (an html block, a component's markup) is what the renderer
  // emits verbatim. A component's values fill raw: the renderer escapes them.
  const rawHtml = record.type === 'html' || record.type === 'component'
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(record)) {
    out[key] = visit(inner, vars, found, rawHtml && key === 'html')
  }
  return out
}

export function applyTemplateVariables(doc: EmailDocument, vars: Record<string, string>): EmailDocument {
  return visit(doc, vars) as EmailDocument
}

export function extractTemplateVariables(doc: EmailDocument): string[] {
  const found = new Set<string>()
  visit(doc, {}, found)
  return [...found].sort((a, b) => a.localeCompare(b))
}
