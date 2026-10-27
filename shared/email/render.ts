/**
 * EmailDocument → email-safe HTML.
 *
 * "Email-safe" here means: a single outer table for the page background, an
 * inner fixed-width table for the content card, every block rendered as table
 * rows with inline styles only (no <style>, no flexbox, no external CSS), and
 * widths/alignment expressed the way Outlook and Gmail actually honour. This is
 * the canonical output used for the live preview, the copy-to-clipboard export,
 * and what the AI's edits ultimately produce.
 *
 * The same renderer runs on the client (preview iframe) and could run on the
 * server (export), so it must stay dependency-free and deterministic.
 */
import type {
  Align,
  ButtonBlock,
  ColumnsBlock,
  ComponentBlock,
  DividerBlock,
  EmailBlock,
  EmailComponentField,
  EmailDocument,
  HeadingBlock,
  HtmlBlock,
  ImageBlock,
  SectionBlock,
  SpacerBlock,
  TextBlock
} from './blocks'
import { getPaddingSides, paddingCssValue, paddingHorizontal } from './blocks'

export type RenderOptions = {
  /** Tag every block's cell with `data-block-id` (the editor preview only; exports stay clean). */
  ids?: boolean
}

/** Escape text destined for an HTML text node / attribute value. */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * A link a reader can follow: http(s) or mailto, or one that starts with a
 * `{{placeholder}}` not filled in yet (sends fill them before rendering, and
 * an unknown one stays as written, so a test shows it); anything else is `#`.
 */
function safeHref(href: string): string {
  return /^(https?:|mailto:)/i.test(href) || /^\{\{\{?\s*[\w.-]+\s*\}?\}\}/.test(href) ? href : '#'
}

/** A free-form CSS value (a shadow, a font stack) that can't break out of its declaration or attribute. */
function cssValue(s: string): string {
  return String(s ?? '').replace(/url\s*\(|expression\s*\(/gi, '').replace(/[;{}<>"\\]/g, '').trim().slice(0, 200)
}

/**
 * Allow only a tiny, email-safe inline subset of HTML for the rich-text fields
 * (text blocks). Everything else is escaped. We tokenise tags and pass through
 * a strict allowlist; `href` on <a> is sanitised to http(s)/mailto only, and
 * <a>/<span> keep a few text styles (a link's colour and weight, a highlight).
 */
const INLINE_ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'a', 'span'])

export const INLINE_STYLE_PROPS = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'font-size']
const SAFE_STYLE_VALUE = /^[#\w\s.,%()+-]+$/

function inlineStyle(attrs: string): string {
  const raw = attrs.match(/style\s*=\s*("([^"]*)"|'([^']*)')/i)
  if (!raw) return ''
  return (raw[2] ?? raw[3] ?? '').split(';').map((declaration) => {
    const colon = declaration.indexOf(':')
    if (colon === -1) return ''
    const prop = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).replace(/!important/gi, '').trim()
    if (!INLINE_STYLE_PROPS.includes(prop) || !SAFE_STYLE_VALUE.test(value) || /url|expression/i.test(value)) return ''
    return `${prop}:${value};`
  }).join('')
}

export function sanitizeInline(html: string): string {
  if (!html) return ''
  return String(html).replace(/<\/?([a-zA-Z0-9]+)([^<>]*)>/g, (full, rawName: string, attrs: string) => {
    const name = rawName.toLowerCase()
    if (!INLINE_ALLOWED.has(name)) return '' // drop disallowed tags, keep inner text
    const closing = full.startsWith('</')
    if (closing) return `</${name}>`
    if (name === 'br') return '<br>'
    const style = inlineStyle(attrs)
    if (name === 'a') {
      const hrefMatch = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)')/i)
      const href = hrefMatch ? (hrefMatch[2] ?? hrefMatch[3] ?? '') : ''
      const safe = safeHref(href)
      // Links take the text colour unless they bring their own.
      const linkStyle = /(^|;)color:/.test(style) ? style : `color:inherit;${style}`
      return `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">`
    }
    if (name === 'span' && style) return `<span style="${style}">`
    return `<${name}>`
  })
}

/** `{{@key}}`: a component field. The `@` keeps it apart from `{{variables}}`, which fill in first. */
export const SLOT_RE = /\{\{\s*@([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g
const SAFE_URL = /^(https?:|mailto:|tel:|cid:|#|\{\{)/i
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/+-]+\)|[a-z]+|\{\{\s*[\w.-]+\s*\}\})$/i

/** A field's value in one instance: its own, else the field's default. */
export function componentValue(field: EmailComponentField, values: Record<string, string> | undefined): string {
  return String((values && Object.hasOwn(values, field.key) ? values[field.key] : field.default) ?? '')
}

/** A component's HTML with each `{{@key}}` filled in, escaped or checked by the field's type. */
export function fillComponent(html: string, fields: EmailComponentField[], values: Record<string, string> | undefined): string {
  const byKey = new Map((fields || []).map(f => [f.key, f]))
  return String(html ?? '').replace(SLOT_RE, (_full, key: string) => {
    const field = byKey.get(key)
    if (!field) return ''
    const value = componentValue(field, values).trim()
    switch (field.type) {
      case 'richtext': return sanitizeInline(value)
      case 'url':
      case 'image': return value ? esc(SAFE_URL.test(value) ? value : '#') : ''
      case 'color': return SAFE_COLOR.test(value) ? value : ''
      case 'number': {
        const n = Number.parseFloat(value)
        return Number.isFinite(n) ? String(n) : ''
      }
      default: return esc(value)
    }
  })
}

function idAttr(block: EmailBlock, opts: RenderOptions): string {
  return opts.ids ? ` data-block-id="${esc(block.id)}"` : ''
}

function cellOpen(block: EmailBlock, align: Align | undefined, opts: RenderOptions): string {
  const bg = block.background ? `background-color:${esc(block.background)};` : ''
  const a = align ? `text-align:${align};` : ''
  return `<td${idAttr(block, opts)} style="padding:${paddingCssValue(block.padding)};${bg}${a}">`
}

function renderHeading(b: HeadingBlock, opts: RenderOptions): string {
  const sizes: Record<number, number> = { 1: 28, 2: 22, 3: 18 }
  const size = b.fontSize && b.fontSize > 0 ? b.fontSize : sizes[b.level] ?? 22
  const color = b.color ? `color:${esc(b.color)};` : ''
  const font = b.fontFamily ? `font-family:${cssValue(b.fontFamily.replace(/"/g, '\''))};` : ''
  const tracking = b.letterSpacing ? `letter-spacing:${b.letterSpacing}px;` : ''
  return `${cellOpen(b, b.align, opts)}<h${b.level} style="margin:0;font-size:${size}px;line-height:1.25;font-weight:700;${color}${font}${tracking}">${esc(b.text)}</h${b.level}></td>`
}

function renderText(b: TextBlock, opts: RenderOptions): string {
  const color = b.color ? `color:${esc(b.color)};` : ''
  const fs = b.fontSize ? `font-size:${b.fontSize}px;` : 'font-size:15px;'
  return `${cellOpen(b, b.align, opts)}<div style="margin:0;line-height:1.6;${fs}${color}">${sanitizeInline(b.html)}</div></td>`
}

function renderButton(b: ButtonBlock, opts: RenderOptions): string {
  const href = safeHref(b.href)
  const radius = typeof b.radius === 'number' ? b.radius : 6
  // The padding scales with the label: 15px (the default) keeps 12px 24px.
  const fs = b.fontSize && b.fontSize > 0 ? b.fontSize : 15
  const shadow = b.shadow ? `box-shadow:${cssValue(b.shadow)};` : ''
  // Bulletproof-ish button: a table-wrapped anchor with inline padding.
  return `${cellOpen(b, b.align, opts)}<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;"><tr><td style="background-color:${esc(b.backgroundColor)};border-radius:${radius}px;${shadow}"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:${Math.round(fs * 0.8)}px ${Math.round(fs * 1.6)}px;font-size:${fs}px;font-weight:600;color:${esc(b.color)};text-decoration:none;border-radius:${radius}px;">${esc(b.label)}</a></td></tr></table></td>`
}

function renderImage(b: ImageBlock, contentWidth: number, opts: RenderOptions): string {
  const availableWidth = Math.max(contentWidth - paddingHorizontal(b.padding), 0)
  const w = b.width && b.width > 0 ? Math.min(b.width, contentWidth) : availableWidth
  // A block image ignores text-align, so centre and right come from its margins
  // (and the wrapper's align attribute, for Outlook).
  const margin = b.align === 'center' ? 'margin:0 auto;' : b.align === 'right' ? 'margin:0 0 0 auto;' : ''
  // Sized by height (a badge): the width follows the picture's own shape.
  const size = !(b.width && b.width > 0) && b.height && b.height > 0
    ? `height="${b.height}" style="display:block;${margin}height:${b.height}px;width:auto;max-width:100%;`
    : `width="${w}" style="display:block;${margin}width:${w}px;max-width:100%;height:auto;`
  const img = `<img src="${esc(b.src)}" alt="${esc(b.alt)}" ${size}border:0;outline:none;text-decoration:none;border-radius:4px;" />`
  const inner = b.href && safeHref(b.href) !== '#'
    ? `<a href="${esc(b.href)}" target="_blank" rel="noopener noreferrer">${img}</a>`
    : img
  return `${cellOpen(b, b.align, opts)}<div align="${b.align}" style="text-align:${b.align};">${inner}</div></td>`
}

function renderDivider(b: DividerBlock, opts: RenderOptions): string {
  const color = esc(b.color ?? '#e4e4e7')
  const t = typeof b.thickness === 'number' ? b.thickness : 1
  return `${cellOpen(b, undefined, opts)}<div style="border-top:${t}px solid ${color};font-size:0;line-height:0;">&nbsp;</div></td>`
}

function renderSpacer(b: SpacerBlock, opts: RenderOptions): string {
  return `<td${idAttr(b, opts)} style="font-size:0;line-height:0;height:${b.height}px;">&nbsp;</td>`
}

function renderHtml(b: HtmlBlock, opts: RenderOptions): string {
  // Trusted-ish escape hatch: emitted verbatim inside a cell. The AI is
  // instructed to keep this email-safe; the user owns the risk for hand-typed
  // HTML (same trust model as the rest of this self-hosted, single-user app).
  return `${cellOpen(b, undefined, opts)}${b.html ?? ''}</td>`
}

function renderComponent(b: ComponentBlock, opts: RenderOptions): string {
  // Same trust model as an html block; only the field values are escaped.
  return `${cellOpen(b, undefined, opts)}${fillComponent(b.html, b.fields, b.values)}</td>`
}

function renderColumns(b: ColumnsBlock, contentWidth: number, opts: RenderOptions): string {
  const cols = b.columns.length || 1
  const gap = typeof b.gap === 'number' ? b.gap : 16
  const inner = Math.max(contentWidth - paddingHorizontal(b.padding), 0)
  const colWidth = Math.max(0, Math.floor((inner - gap * (cols - 1)) / cols))
  const cells = b.columns.map((col, i) => {
    const ml = i > 0 ? `padding-left:${gap}px;` : ''
    const body = col.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${col.map(child => `<tr>${renderBlock(child, colWidth, opts)}</tr>`).join('')}</table>`
      : '&nbsp;'
    return `<td width="${colWidth}" valign="top" style="${ml}">${body}</td>`
  }).join('')
  return `${cellOpen(b, undefined, opts)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table></td>`
}

function renderSection(b: SectionBlock, contentWidth: number, opts: RenderOptions): string {
  const pad = getPaddingSides(b.padding)
  const inner = Math.max(contentWidth - pad.left - pad.right, 0)
  const radius = typeof b.radius === 'number' && b.radius > 0 ? b.radius : 0
  const angle = typeof b.gradientAngle === 'number' ? b.gradientAngle : 180
  const bg = b.background ? `background-color:${esc(b.background)};` : ''
  // Outlook ignores the gradient and shows the solid colour.
  const gradient = b.gradientTo ? `background-image:linear-gradient(${angle}deg, ${esc(b.background || b.gradientTo)}, ${esc(b.gradientTo)});` : ''
  const round = radius ? `border-radius:${radius}px;` : ''
  const shadow = b.shadow ? `box-shadow:${cssValue(b.shadow)};` : ''
  // The children's table clips to the corners, so a band at the top of a
  // rounded card stays inside it.
  // ponytail: one radius for every corner; add per-corner radii if a client shows a band's square corners.
  const clip = Math.max(0, radius - Math.min(pad.top, pad.right, pad.bottom, pad.left))
  const rows = b.blocks.map(child => `<tr>${renderBlock(child, inner, opts)}</tr>`).join('') || '<tr><td>&nbsp;</td></tr>'
  return `<td${idAttr(b, opts)} style="padding:${paddingCssValue(b.padding)};${bg}${gradient}${round}${shadow}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;${clip ? `border-radius:${clip}px;overflow:hidden;` : ''}">${rows}</table></td>`
}

/** One block as a standalone table: what "save as component" starts from. */
export function renderBlockTable(b: EmailBlock, contentWidth: number): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${renderBlock(b, contentWidth)}</tr></table>`
}

/** Render a single block as a `<td>…</td>` (caller wraps in a `<tr>`). */
export function renderBlock(b: EmailBlock, contentWidth: number, opts: RenderOptions = {}): string {
  switch (b.type) {
    case 'heading': return renderHeading(b, opts)
    case 'text': return renderText(b, opts)
    case 'button': return renderButton(b, opts)
    case 'image': return renderImage(b, contentWidth, opts)
    case 'divider': return renderDivider(b, opts)
    case 'spacer': return renderSpacer(b, opts)
    case 'columns': return renderColumns(b, contentWidth, opts)
    case 'html': return renderHtml(b, opts)
    case 'section': return renderSection(b, contentWidth, opts)
    case 'component': return renderComponent(b, opts)
    default: return ''
  }
}

/**
 * Render just the content rows (no <html> wrapper) — used by the live preview.
 * The card is fluid up to `contentWidth`: a fixed-width table doesn't shrink
 * on a phone (a percentage max-width means nothing inside an auto-width cell),
 * so mail apps would zoom the whole email out to fit it.
 *
 * A card the colour of the page is no card: the design draws its own (a
 * section, imported HTML), and rounding and clipping here would cut its shadow.
 */
export function renderBlocks(doc: EmailDocument, opts: RenderOptions = {}): string {
  const { settings, blocks } = doc
  const rows = blocks.map(b => `<tr>${renderBlock(b, settings.contentWidth, opts)}</tr>`).join('')
  const melted = String(settings.contentBackground || '').trim().toLowerCase() === String(settings.backgroundColor || '').trim().toLowerCase()
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${settings.contentWidth}px;background-color:${esc(settings.contentBackground)};${melted ? '' : 'border-radius:8px;overflow:hidden;'}">${rows}</table>`
}

/** Render the full, standalone, email-safe HTML document. */
export function renderEmailHtml(doc: EmailDocument, opts: RenderOptions = {}): string {
  const { settings } = doc
  const preheader = settings.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(settings.preheader)}</div>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${esc(settings.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${esc(settings.backgroundColor)};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${esc(settings.backgroundColor)};font-family:${settings.fontFamily.replace(/"/g, '\'')};color:${esc(settings.textColor)};">
<tr>
<td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="${settings.contentWidth}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
${renderBlocks(doc, opts)}
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>`
}
