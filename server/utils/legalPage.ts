import { LEGAL_FONTS, normalizeLegalConfig, type LegalFont } from '#shared/legal/config'
import { fillLabel, legalLabels } from '#shared/legal/labels'
import { localeName, normalizeLocale } from '#shared/locales'
import { poweredByHtml, type PoweredBy } from './branding'
import { legalToc } from './legalRender'
import { escapeHtml } from './messageEmail'
import { lookOf } from './projects'
import type { LegalSection } from '#shared/legal/types'

// The hosted legal pages, as plain server-rendered HTML in the style of
// marketingPages.ts: no JavaScript, no sign-in, readable in any browser and by
// crawlers. Unlike those pages they are meant to be indexed. All text is
// escaped here; `bodyHtml` is the one raw value, sanitised when it was saved.

const FONT_STACKS: Record<LegalFont, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
}

/** The same document in another language, published: where it lives. */
export type LegalTranslationLink = { locale: string, title: string, path: string }
type Doc = { type: string, slug: string, title: string, tldr: string, effectiveDate: string | null, version: number, html: string, sections: LegalSection[], locale?: string, translations?: LegalTranslationLink[], /** This page's own path, and the site's origin: both needed for hreflang links. */ path?: string, origin?: string }

/**
 * The project's look (Brand kit) with the legal pages' own settings on top:
 * `legal.accent`, `legal.logoUrl` and `legal.font` are optional per-document-set
 * overrides, blank by default, so a project that never touched them wears the kit.
 */
export function legalLook(project: ParseObject) {
  const config = normalizeLegalConfig(project.get('legal'))
  const base = lookOf(project)
  const own = (url: string) => (/^https?:\/\//.test(url) ? url : '')
  return {
    name: base.name,
    accent: config.accent || base.accent,
    font: FONT_STACKS[LEGAL_FONTS.includes(config.font) ? config.font : 'system'],
    logo: own(config.logoUrl) || base.logoUrl || base.iconUrl,
    footer: config.footerText
  }
}

function formatDate(value: string | null, locale = 'en'): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
  }
}

const CSS = `
:root { --accent: var(--brand); --bg: #fafafa; --card: #fff; --text: #1c1c21; --muted: #62626d; --line: #e6e6ea; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #111113; --card: #19191c; --text: #ececf0; --muted: #a2a2ad; --line: #2b2b31; } }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.7 var(--font); -webkit-text-size-adjust: 100%; }
a { color: var(--accent); text-underline-offset: 2px; }
.wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
.top { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; font-weight: 600; }
.top a { color: inherit; text-decoration: none; }
.top img { width: 36px; height: 36px; border-radius: 9px; object-fit: cover; }
article { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 40px 44px; }
h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 6px; letter-spacing: -0.02em; }
.meta { color: var(--muted); font-size: 0.875rem; margin: 0 0 28px; }
.tldr { border-left: 4px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: 0 10px 10px 0; padding: 14px 18px; margin: 0 0 28px; }
.tldr strong { display: block; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
.tldr p { margin: 0; }
details.toc { border: 1px solid var(--line); border-radius: 10px; padding: 10px 16px; margin: 0 0 32px; }
details.toc summary { cursor: pointer; font-weight: 600; font-size: 0.9rem; }
details.toc ol { margin: 10px 0 4px; padding-left: 20px; columns: 2; column-gap: 28px; font-size: 0.9rem; }
details.toc li { break-inside: avoid; padding: 1px 0; }
section { scroll-margin-top: 24px; }
h2 { font-size: 1.25rem; line-height: 1.3; margin: 2rem 0 0.5rem; letter-spacing: -0.01em; }
p, ul, ol { margin: 0 0 1rem; }
li { margin: 0.25rem 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 1rem; font-size: 0.95rem; }
th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
blockquote { margin: 0 0 1rem; padding-left: 14px; border-left: 3px solid var(--line); color: var(--muted); }
code { font-size: 0.9em; background: color-mix(in srgb, var(--text) 8%, transparent); padding: 1px 5px; border-radius: 5px; }
img { max-width: 100%; height: auto; }
footer.legal-foot { margin-top: 28px; text-align: center; color: var(--muted); font-size: 0.85rem; }
.list { list-style: none; padding: 0; margin: 0; }
.list li { margin: 0; border-top: 1px solid var(--line); }
.list li:first-child { border-top: 0; }
.list a { display: flex; justify-content: space-between; gap: 12px; padding: 14px 0; text-decoration: none; font-weight: 600; }
.list span { color: var(--muted); font-weight: 400; font-size: 0.875rem; }
@media (max-width: 640px) { article { padding: 24px 20px; border-radius: 12px; } h1 { font-size: 1.6rem; } details.toc ol { columns: 1; } }
@media print { body { background: #fff; color: #000; } article { border: 0; padding: 0; } details.toc, .top a[href]::after { display: none; } a { color: inherit; } }
`

function shell(project: ParseObject, title: string, description: string, body: string, poweredBy: PoweredBy | null, page: { lang?: string, head?: string } = {}): string {
  const l = legalLook(project)
  const logo = l.logo ? `<img src="${escapeHtml(l.logo)}" alt="" width="36" height="36">` : ''
  return `<!doctype html>
<html lang="${escapeHtml(normalizeLocale(page.lang) || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(l.name)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
<meta property="og:title" content="${escapeHtml(title)} · ${escapeHtml(l.name)}">
<meta name="robots" content="index,follow">
${page.head || ''}
<style>:root { --brand: ${l.accent}; --font: ${l.font}; }${CSS}</style>
</head>
<body>
<div class="wrap">
<div class="top">${logo}<span>${escapeHtml(l.name)}</span></div>
${body}
<footer class="legal-foot">${l.footer ? `<p>${escapeHtml(l.footer)}</p>` : ''}${poweredByHtml(poweredBy)}</footer>
</div>
</body>
</html>`
}

export function renderLegalPage(project: ParseObject, doc: Doc, others: { title: string, path: string }[], poweredBy: PoweredBy | null): string {
  const locale = normalizeLocale(doc.locale) || 'en'
  const t = legalLabels(locale)
  const date = formatDate(doc.effectiveDate, locale)
  const meta = [date && fillLabel(t.effective, { date }), doc.version > 0 && fillLabel(t.version, { n: doc.version })].filter(Boolean).join(' · ')
  const toc = doc.sections.length > 3
    ? `<details class="toc"><summary>${escapeHtml(t.contents)}</summary><ol>${legalToc(doc.sections).map(t => `<li><a href="#${t.id}">${escapeHtml(t.title)}</a></li>`).join('')}</ol></details>`
    : ''
  const tldr = doc.tldr ? `<div class="tldr"><strong>${escapeHtml(t.inShort)}</strong><p>${escapeHtml(doc.tldr)}</p></div>` : ''
  const translations = doc.translations || []
  const more = others.length
    ? `<footer class="legal-foot"><p>${others.map(o => `<a href="${escapeHtml(o.path)}">${escapeHtml(o.title)}</a>`).join(' · ')}</p></footer>`
    : ''
  // A way to the same document in its other languages, and the same for search engines.
  const langs = translations.length
    ? `<footer class="legal-foot"><p>${escapeHtml(t.languages)}: ${translations.map(o => `<a href="${escapeHtml(o.path)}" hreflang="${escapeHtml(o.locale)}" lang="${escapeHtml(o.locale)}">${escapeHtml(localeName(o.locale))}</a>`).join(' · ')}</p></footer>`
    : ''
  const alternates = translations.length && doc.origin && doc.path
    ? [{ locale, path: doc.path }, ...translations].map(o => `<link rel="alternate" hreflang="${escapeHtml(o.locale)}" href="${escapeHtml(doc.origin + o.path)}">`).join('\n')
    : ''
  return shell(project, doc.title, doc.tldr, `<article><h1>${escapeHtml(doc.title)}</h1>${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}${tldr}${toc}${doc.html}</article>${langs}${more}`, poweredBy, { lang: locale, head: alternates })
}

export function renderLegalIndex(project: ParseObject, docs: { title: string, path: string, effectiveDate: string | null, locale?: string }[], poweredBy: PoweredBy | null): string {
  const locales = new Set(docs.map(d => normalizeLocale(d.locale) || 'en'))
  const t = legalLabels(locales.size === 1 ? [...locales][0] : 'en')
  const items = docs.map(d => `<li><a href="${escapeHtml(d.path)}" lang="${escapeHtml(normalizeLocale(d.locale) || 'en')}">${escapeHtml(d.title)}<span>${escapeHtml(formatDate(d.effectiveDate, d.locale))}</span></a></li>`).join('')
  return shell(project, t.legal, '', `<article><h1>${escapeHtml(t.legal)}</h1><ul class="list">${items || `<li><span>${escapeHtml(t.empty)}</span></li>`}</ul></article>`, poweredBy)
}
