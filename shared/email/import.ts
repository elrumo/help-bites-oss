import { DEFAULT_SETTINGS, type EmailDocument, type EmailSettings } from './blocks'
import { decodeHtmlEntities } from './resolve'

// An HTML email from elsewhere (a file, an API import, another app's
// template) becomes one custom-HTML block: the design stays exactly as
// written. What the editor can own is lifted out of the markup instead:
// the <title> becomes the subject, a hidden preheader at the top becomes the
// preheader setting, and the page background carries over, so the email
// renders the way it did before.

export type HtmlImportOptions = {
  /** Subject; defaults to the document's <title>. */
  title?: string
  /** Preheader; defaults to the hidden preview text at the top of the email, which is then removed. */
  preheader?: string
  /** Plain-text part; blank means it is generated from the HTML at send time. */
  text?: string
  /** Any other settings to set over the detected ones. */
  settings?: Partial<EmailSettings>
}

export const IMPORTED_CONTENT_WIDTH = 672

const LEAF_RE = /<(span|div)\b([^>]*)>([^<]*)<\/\1>/gi
const HIDDEN_STYLE_RE = /display\s*:\s*none|max-height\s*:\s*0|visibility\s*:\s*hidden/i
const COLOR_RE = /(?:background(?:-color)?\s*:\s*|bgcolor\s*=\s*["']?)(#[0-9a-f]{6}|#[0-9a-f]{3})\b/i

function stripDocumentShell(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1]
  if (body === undefined) return html.replace(/<!doctype[^>]*>/i, '').trim()
  // Mail clients that honour <style> also honour it in the body; keep the head's.
  const styles = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '').match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []
  return [...styles, body.trim()].join('\n')
}

/** The page colour: the body's, else the outermost wrapper's (the first one declared near the top). */
function backgroundOf(html: string): string | null {
  const body = html.match(/<body\b([^>]*)>/i)?.[1] || ''
  return body.match(COLOR_RE)?.[1] || stripDocumentShell(html).slice(0, 1500).match(COLOR_RE)?.[1] || null
}

function hiddenText(attrs: string, inner: string): string {
  if (!HIDDEN_STYLE_RE.test(attrs)) return ''
  return decodeHtmlEntities(inner.replace(/\s+/g, ' ').trim())
}

/**
 * The preview text emails hide before their first table: `display:none` (or
 * zero-height) elements holding plain text. Every copy of it is removed (a
 * span and a div with the same words is a common pattern).
 */
export function extractPreheader(html: string): { preheader: string, html: string } {
  const firstTable = html.search(/<table\b/i)
  const head = firstTable === -1 ? html : html.slice(0, firstTable)
  let preheader = ''
  for (const match of head.matchAll(LEAF_RE)) {
    preheader = hiddenText(match[2] || '', match[3] || '')
    if (preheader) break
  }
  if (!preheader) return { preheader: '', html }
  const cleaned = head
    .replace(LEAF_RE, (full, _tag, attrs: string, inner: string) => (hiddenText(attrs || '', inner || '') === preheader ? '' : full))
    .replace(/^[ \t]*\r?\n/gm, '')
  return { preheader, html: cleaned + html.slice(head.length) }
}

function titleOf(html: string): string {
  return decodeHtmlEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '')
}

/** One custom-HTML block, with subject, preheader and background lifted into the settings. */
export function htmlToEmailDocument(html: string, options: HtmlImportOptions = {}): EmailDocument {
  const source = String(html || '')
  const title = (options.title ?? titleOf(source)).trim() || 'Untitled email'
  const background = backgroundOf(source)
  let body = stripDocumentShell(source)
  let preheader = options.preheader ?? ''
  if (options.preheader === undefined) ({ preheader, html: body } = extractPreheader(body))
  const text = String(options.text || '').replace(/\r\n/g, '\n').trim()
  const settings: EmailSettings = {
    ...DEFAULT_SETTINGS,
    title,
    preheader,
    // The imported design draws its own card; the editor's wrapper melts into the page colour
    // and leaves room for a 640px card inside the usual 16px gutters.
    ...(background ? { backgroundColor: background, contentBackground: background } : {}),
    contentWidth: IMPORTED_CONTENT_WIDTH,
    ...(text ? { text } : {}),
    ...options.settings
  }
  return { settings, blocks: [{ id: 'blk_imported', type: 'html', html: body.trim(), padding: 0 }] }
}
