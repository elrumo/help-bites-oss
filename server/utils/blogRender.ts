import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import { blogReadingMinutes, BLOG_EXCERPT_MAX_LENGTH, type BlogBodyFormat } from '#shared/blog'

// Pure helpers for a blog post's text: the HTML it is served as, its lead-in,
// its reading time and the copy that goes out by email. No Parse, so they
// unit-test without a database. Comments reuse the changelog's renderer
// (checkChangelogComment): the same threat model, the same allowlist.

const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: false })

/** The video players a post may embed (an iframe from anywhere else is dropped). */
export const BLOG_EMBED_HOSTS = ['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'] as const

/**
 * Posts are written by the team, but their HTML lands in the host's own page
 * through the embed, so this is a real XSS boundary. Wider than the
 * changelog's (figures and underline from the editor, a YouTube or Vimeo
 * player, sandboxed), and like it without `style`, `id`, scripts, forms or
 * `on*` handlers. The post's title is the page's h1, so an h1 in the body
 * becomes an h2. HTML imported from Ghost goes through the same filter.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr',
    'strong', 'em', 'b', 'i', 'u', 'del', 's', 'mark', 'sup', 'sub',
    'code', 'pre', 'kbd',
    'ul', 'ol', 'li', 'blockquote',
    'a', 'img', 'figure', 'figcaption', 'iframe',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    iframe: ['src', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'loading', 'sandbox', 'referrerpolicy'],
    code: ['class'],
    ol: ['start'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'], iframe: ['https'] },
  allowedIframeHostnames: [...BLOG_EMBED_HOSTS],
  allowProtocolRelative: false,
  transformTags: {
    h1: 'h2',
    a: (tagName, attribs) => {
      const href = attribs.href || ''
      const internal = href.startsWith('/') || href.startsWith('#')
      return { tagName, attribs: internal ? attribs : { ...attribs, target: '_blank', rel: 'noopener' } }
    },
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: 'lazy' } }),
    // Whatever sandbox the source asked for, the player gets only what it needs to play.
    iframe: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: 'lazy', sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups', referrerpolicy: 'strict-origin-when-cross-origin' } })
  },
  // A frame from anywhere else loses its src above; this drops the empty frame too.
  exclusiveFilter: frame => frame.tag === 'iframe' && !frame.attribs.src
}

function sourceHtml(body: string, format: BlogBodyFormat): string {
  return format === 'html' ? String(body ?? '') : md.render(String(body ?? ''))
}

/** The body (Markdown, or HTML from an import) → the HTML served, once per write (stored as `bodyHtml`). */
export function renderBlogBody(body: string, format: BlogBodyFormat = 'markdown'): string {
  return sanitizeHtml(sourceHtml(body, format), SANITIZE_OPTIONS).trim()
}

function textOf(html: string): string {
  // A space at each block's edge: HTML from an import has no newlines between them, and words would run together.
  const spaced = html.replace(/<(\/?)(p|h[1-6]|li|blockquote|pre|figure|figcaption|div|br|hr|tr|td|th)\b/gi, ' <$1$2')
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The plain text a reader sees, for the reading time and search. */
export function blogPlainText(body: string, format: BlogBodyFormat = 'markdown'): string {
  return textOf(sourceHtml(body, format))
}

/** A lead-in cut on a word boundary, for a post with no excerpt of its own. Headings and captions are left out: they read badly run into the text. */
export function deriveBlogExcerpt(body: string, length = 200, format: BlogBodyFormat = 'markdown'): string {
  const text = textOf(sourceHtml(body, format).replace(/<(h[1-6]|figcaption)[^>]*>[\s\S]*?<\/\1>/gi, ' '))
  if (text.length <= length) return text
  const clipped = text.slice(0, Math.min(length, BLOG_EXCERPT_MAX_LENGTH))
  const lastSpace = clipped.lastIndexOf(' ')
  return `${(lastSpace > length * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`
}

export function blogBodyStats(body: string, format: BlogBodyFormat = 'markdown'): { readingMinutes: number } {
  return { readingMinutes: blogReadingMinutes(blogPlainText(body, format)) }
}

/**
 * The post's HTML made fit for a mail client: inline styles (mail clients drop
 * <style>), images that never overflow the 600px column, the accent on links.
 * Input is `bodyHtml`, already sanitised; the styles added here are ours.
 */
export function blogEmailHtml(bodyHtml: string, accent: string): string {
  const text = 'margin:0 0 16px 0;font-size:16px;line-height:1.65;'
  const styles: Record<string, string> = {
    p: text,
    ul: `${text}padding-left:22px;`,
    ol: `${text}padding-left:22px;`,
    li: 'margin:0 0 6px 0;',
    h2: 'margin:28px 0 10px 0;font-size:22px;line-height:1.3;font-weight:700;',
    h3: 'margin:24px 0 8px 0;font-size:18px;line-height:1.35;font-weight:700;',
    h4: 'margin:20px 0 8px 0;font-size:16px;line-height:1.4;font-weight:700;',
    blockquote: 'margin:0 0 16px 0;padding:2px 0 2px 14px;border-left:3px solid #e4e4e7;color:#52525b;',
    pre: 'margin:0 0 16px 0;padding:12px 14px;border-radius:8px;background:#f4f4f5;font-size:13px;line-height:1.5;overflow:auto;white-space:pre-wrap;',
    code: 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.9em;',
    img: 'display:block;max-width:100%;height:auto;margin:8px 0 16px 0;border-radius:8px;',
    figure: 'margin:0 0 16px 0;',
    figcaption: 'font-size:13px;color:#71717a;text-align:center;',
    hr: 'border:0;border-top:1px solid #e4e4e7;margin:24px 0;',
    table: 'border-collapse:collapse;width:100%;margin:0 0 16px 0;font-size:14px;',
    th: 'border:1px solid #e4e4e7;padding:6px 8px;text-align:left;',
    td: 'border:1px solid #e4e4e7;padding:6px 8px;text-align:left;',
    a: `color:${/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#4f46e5'};text-decoration:underline;`
  }
  return sanitizeHtml(bodyHtml, {
    allowedTags: SANITIZE_OPTIONS.allowedTags,
    allowedAttributes: { '*': ['style'], 'a': ['href', 'title', 'target', 'rel', 'style'], 'img': ['src', 'alt', 'width', 'height', 'style'], 'ol': ['start', 'style'], 'th': ['colspan', 'rowspan', 'style'], 'td': ['colspan', 'rowspan', 'style'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    // Any style the input carried is replaced, never merged: only ours goes out.
    transformTags: {
      ...Object.fromEntries(Object.entries(styles).map(([tag, style]) => [tag, (tagName: string, attribs: Record<string, string>) => ({ tagName, attribs: { ...attribs, style } })])),
      // Mail clients play no video: the player becomes a link to it.
      iframe: (_tagName: string, attribs: Record<string, string>) => ({ tagName: 'a', attribs: { href: videoPageUrl(attribs.src || ''), style: styles.a! }, text: 'Watch the video' })
    }
  })
}

/** A player's address → the video's own page, for a link. */
function videoPageUrl(src: string): string {
  return src
    .replace(/^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/([\w-]+).*$/, 'https://www.youtube.com/watch?v=$1')
    .replace(/^https:\/\/player\.vimeo\.com\/video\/(\d+).*$/, 'https://vimeo.com/$1')
}

/** A title or subject as text in an email: a zero-width space keeps `{{` apart, so it is never read as a placeholder. */
export function literalBraceText(text: string): string {
  return text.replace(/\{(?=\{)/g, '{\u200B').replace(/\}(?=\})/g, '}\u200B')
}
