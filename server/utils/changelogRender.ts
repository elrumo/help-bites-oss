import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import { CHANGELOG_COMMENT_LINKS_MAX, CHANGELOG_COMMENT_MAX_LENGTH, CHANGELOG_COMMENT_MIN_TEXT, CHANGELOG_SLUG_MAX_LENGTH, type ChangelogBodyFormat } from '#shared/changelog'

// Pure helpers for the changelog's text: the slug an entry is addressed by and
// the HTML it is served as. No Parse, so they unit-test without a database.

/**
 * Title → URL key. NFD-normalizes so accented characters degrade to their base
 * letter ("Cómo" → "como") instead of being dropped, which is what a naive
 * `[^a-z0-9]` filter does to most Spanish and Catalan titles.
 */
export function changelogSlugify(value: string): string {
  const slug = String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CHANGELOG_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')

  // A title made only of emoji or punctuation slugifies to nothing: fall back to
  // something unique rather than letting every such entry collide.
  return slug || `entry-${Date.now().toString(36)}`
}

/**
 * Appends `-2`, `-3`… until the slug is free and not reserved. `exists` is
 * injected so this tests without a database.
 *
 * Uniqueness is checked here, not by a unique index: Parse's schema API cannot
 * declare one. Two entries with the same title created in the same instant is
 * the only race, and the CLI's batch creates its entries one by one.
 */
export async function nextChangelogSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
  reserved: Set<string> = new Set(),
  maxAttempts = 20
): Promise<string> {
  const root = changelogSlugify(base)
  if (!reserved.has(root) && !(await exists(root))) return root

  for (let suffix = 2; suffix <= maxAttempts; suffix++) {
    const candidate = `${root.slice(0, CHANGELOG_SLUG_MAX_LENGTH - String(suffix).length - 1)}-${suffix}`
    if (!reserved.has(candidate) && !(await exists(candidate))) return candidate
  }

  return `${root.slice(0, CHANGELOG_SLUG_MAX_LENGTH - 8)}-${Date.now().toString(36)}`
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: false })

/**
 * The one allowlist. Entries are written by operators and release scripts, so
 * this is a defence against a compromised session or a model that pasted
 * something odd, but the HTML ends up in the host's own page, so it is a real
 * XSS boundary either way.
 *
 * Deliberately absent: `style` and `id` (they let an entry escape its card and
 * reposition the page), `script` / `iframe` / `object` / `form`, and every `on*`
 * handler, which sanitize-html strips by virtue of not being listed.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h2', 'h3', 'h4', 'p', 'br', 'hr',
    'strong', 'em', 'b', 'i', 'del', 's', 'mark', 'sup', 'sub',
    'code', 'pre', 'kbd',
    'ul', 'ol', 'li', 'blockquote',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    code: ['class'], // markdown-it writes language-* here for highlighting
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  // `data:` is allowed on images so an inline screenshot works, but only for
  // real image payloads: data:text/html would be a script vector.
  exclusiveFilter: frame =>
    frame.tag === 'img'
    && /^data:/i.test(frame.attribs.src || '')
    && !/^data:image\//i.test(frame.attribs.src || ''),
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href || ''
      const isInternal = href.startsWith('/') || href.startsWith('#')
      return {
        tagName,
        attribs: isInternal
          ? { ...attribs, href }
          : { ...attribs, href, target: '_blank', rel: 'nofollow noopener ugc' }
      }
    },
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: 'lazy' } })
  }
}

/**
 * Source text → the HTML actually served. Runs once per write, not once per
 * read: `bodyHtml` is stored beside `body`, so a host puts it straight into its
 * page, and a change to this allowlist is a deliberate re-save rather than a
 * silent shift in what an already-published entry looks like.
 */
export function renderChangelogBody(body: string, format: ChangelogBodyFormat = 'markdown'): string {
  const source = String(body ?? '')
  const rendered = format === 'html' ? source : md.render(source)
  return sanitizeHtml(rendered, SANITIZE_OPTIONS).trim()
}

/** Plain-text lead-in for list cards, og:description and search. */
export function deriveChangelogExcerpt(body: string, format: ChangelogBodyFormat = 'markdown', length = 200): string {
  const html = format === 'html' ? String(body ?? '') : md.render(String(body ?? ''))
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= length) return text
  // Cut on a word boundary so the ellipsis does not land mid-word.
  const clipped = text.slice(0, length)
  const lastSpace = clipped.lastIndexOf(' ')
  return `${(lastSpace > length * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`
}

// ---- comments -----------------------------------------------------------------

/**
 * `html: false` is the whole point of a separate renderer. Entries are written
 * by trusted people and may hold raw HTML; a comment may not. Raw tags in a
 * comment are escaped, not parsed, so the allowlist below is a second line of
 * defence rather than the only one.
 */
const commentMd = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: true })

/**
 * A smaller allowlist than the entries': no `img` (a remote image in a comment
 * is a tracking pixel and a layout weapon), no headings or `hr` (a comment that
 * out-shouts the entry it sits under), no tables. What is left is what a plain
 * composer toolbar produces.
 */
const COMMENT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'del', 's', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], code: ['class'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    // `ugc` is not decoration: it tells search engines these links were
    // contributed by readers, the difference between a thread and an SEO donation.
    a: (tagName, attribs) => {
      const href = attribs.href || ''
      const out: Record<string, string> = { href, title: attribs.title || '' }
      if (!href.startsWith('/') && !href.startsWith('#')) Object.assign(out, { target: '_blank', rel: 'nofollow noopener ugc' })
      return { tagName, attribs: out }
    }
  }
}

export function renderChangelogComment(body: string): string {
  return sanitizeHtml(commentMd.render(String(body ?? '')), COMMENT_SANITIZE_OPTIONS).trim()
}

/** What a reader actually sees as text: for the length floor, the duplicate guard and notification emails. */
export function changelogCommentText(body: string): string {
  return sanitizeHtml(commentMd.render(String(body ?? '')), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function countChangelogCommentLinks(bodyHtml: string): number {
  return (bodyHtml.match(/<a\s/gi) || []).length
}

/**
 * Everything a comment body must satisfy before it is stored, in one place so
 * create and edit cannot drift apart. `error` is written for the person typing.
 */
export function checkChangelogComment(body: string): { bodyHtml: string, text: string, error: string | null } {
  const source = String(body ?? '')
  const bodyHtml = renderChangelogComment(source)
  const text = changelogCommentText(source)
  let error: string | null = null
  if (source.length > CHANGELOG_COMMENT_MAX_LENGTH) error = `Comments are limited to ${CHANGELOG_COMMENT_MAX_LENGTH} characters`
  else if (text.length < CHANGELOG_COMMENT_MIN_TEXT) error = 'Write something first'
  else if (countChangelogCommentLinks(bodyHtml) > CHANGELOG_COMMENT_LINKS_MAX) error = `Comments can hold at most ${CHANGELOG_COMMENT_LINKS_MAX} links`
  return { bodyHtml, text, error }
}
