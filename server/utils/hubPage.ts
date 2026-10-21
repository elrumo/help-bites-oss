import { createHash } from 'node:crypto'
import type { HubSectionView } from '#shared/hub'
import { poweredByHtml, type PoweredBy } from './branding'
import { escapeHtml } from './messageEmail'
import type { HubData } from './hub'

// The hub page, /hub/<publicKey>: server-rendered HTML in the style of
// legalPage.ts and brandPage.ts. It wears the project's look (accent, logo,
// typefaces, corner radius, light or dark) and lists what hub.ts gathered.
// Nothing here is user HTML: every value is escaped, every link must be http(s).
// The one script opens the chat on "Contact us"; the CSP allows it by hash
// and helpbites.js (the loader) from this origin.

const SCRIPT = `document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-chat]');if(!t)return;e.preventDefault();window.HelpBites=window.HelpBites||[];window.HelpBites.push(['open'])})`

export const HUB_PAGE_CSP = `default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'sha256-${createHash('sha256').update(SCRIPT).digest('base64')}'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`

const HREF = /^https?:\/\/[^\s"'<>]+$/i
const href = (url: string) => (HREF.test(url) ? escapeHtml(url) : '#')
// A value that goes inside a <style> block: nothing that could close it or start a rule.
const css = (value: string) => value.replace(/[<>{};\\]/g, '')
// Only the stylesheets a Brand kit may link (already validated when saved; checked again here).
const fontSheets = (urls: string[]) => urls.filter(url => /^https:\/\/fonts\.googleapis\.com\//.test(url) && HREF.test(url))

const paragraphs = (text: string) => text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')

function sectionHtml(section: HubSectionView): string {
  const heading = `<h2>${escapeHtml(section.title)}</h2>`
  const items = section.items.length
    ? `<ul class="items">${section.items.map(item => `<li><a href="${href(item.url)}">${escapeHtml(item.title)}</a>${item.meta ? `<span class="meta">${escapeHtml(item.meta)}</span>` : ''}</li>`).join('')}</ul>`
    : ''
  const text = section.text ? `<div class="text">${paragraphs(section.text)}</div>` : ''
  const chat = section.action === 'chat' ? `<p><button type="button" class="btn" data-chat>Start a chat</button></p>` : ''
  // A section with a list links to the whole thing; one without is just a door.
  const more = section.url ? `<p class="more"><a href="${href(section.url)}">${section.items.length ? 'See all' : `Open ${escapeHtml(section.title.toLowerCase())}`} <span aria-hidden="true">→</span></a></p>` : ''
  return `<section id="${escapeHtml(section.key)}" class="card">${heading}${text}${items}${chat}${more}</section>`
}

export function renderHubPage(data: HubData, poweredBy: PoweredBy | null = null): string {
  const look = data.look
  const logo = (url: string, cls: string) => (HREF.test(url) ? `<img class="logo ${cls}" src="${escapeHtml(url)}" alt="" height="40">` : '')
  const split = look.logoDarkUrl && look.logoDarkUrl !== look.logoUrl
  const mark = look.logoUrl || look.iconUrl
    ? (split ? `${logo(look.logoUrl, 'on-light')}${logo(look.logoDarkUrl, 'on-dark')}` : logo(look.logoUrl || look.iconUrl, ''))
    : ''
  const sheets = fontSheets(look.fontCssUrls).map(url => `<link rel="stylesheet" href="${escapeHtml(url)}">`).join('\n')
  const title = data.hub.title || data.project.name
  const radius = Math.max(0, Math.min(32, Math.round(look.radiusPx)))
  return `<!doctype html>
<html lang="en" data-scheme="${look.scheme === 'dark' || look.scheme === 'light' ? look.scheme : 'auto'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${data.hub.tagline ? `<meta name="description" content="${escapeHtml(data.hub.tagline)}">` : ''}
<meta property="og:title" content="${escapeHtml(title)}">
<meta name="robots" content="index,follow">
${sheets}
<style>
:root { --accent: ${css(look.accent)}; --on-accent: ${css(look.accentText)}; --radius: ${radius}px; --font: ${css(look.fontFamily.body)}; --font-display: ${css(look.fontFamily.display)}; --bg: #fafafa; --card: #fff; --text: #1c1c21; --muted: #62626d; --line: #e6e6ea; color-scheme: light; }
:root[data-scheme="dark"] { --bg: #111113; --card: #19191c; --text: #ececf0; --muted: #a2a2ad; --line: #2b2b31; color-scheme: dark; }
@media (prefers-color-scheme: dark) { :root[data-scheme="auto"] { --bg: #111113; --card: #19191c; --text: #ececf0; --muted: #a2a2ad; --line: #2b2b31; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 var(--font); -webkit-text-size-adjust: 100%; }
a { color: var(--accent); text-underline-offset: 2px; }
.wrap { max-width: 680px; margin: 0 auto; padding: 40px 20px 64px; }
header { text-align: center; margin-bottom: 32px; }
.logo { max-width: 200px; width: auto; object-fit: contain; margin-bottom: 12px; }
.on-dark { display: none; }
:root[data-scheme="dark"] .on-light { display: none; }
:root[data-scheme="dark"] .on-dark { display: inline-block; }
@media (prefers-color-scheme: dark) { :root[data-scheme="auto"] .on-light { display: none; } :root[data-scheme="auto"] .on-dark { display: inline-block; } }
h1 { font: 700 2rem/1.2 var(--font-display); letter-spacing: -0.02em; margin: 0 0 6px; }
.tagline { margin: 0; color: var(--muted); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: calc(var(--radius) + 6px); padding: 22px 24px; margin-bottom: 16px; }
h2 { font: 600 1.05rem/1.3 var(--font-display); margin: 0 0 10px; }
.text p { margin: 0 0 10px; }
.items { list-style: none; margin: 0; padding: 0; }
.items li { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; border-top: 1px solid var(--line); }
.items li:first-child { border-top: 0; }
.items a { color: var(--text); text-decoration: none; font-weight: 500; }
.items a:hover { color: var(--accent); }
.meta { color: var(--muted); font-size: 0.85rem; white-space: nowrap; }
.more { margin: 12px 0 0; font-size: 0.9rem; }
.btn { font: inherit; font-weight: 600; background: var(--accent); color: var(--on-accent); border: 0; border-radius: var(--radius); padding: 10px 18px; cursor: pointer; }
.links { list-style: none; padding: 0; margin: 24px 0 0; display: flex; flex-wrap: wrap; gap: 8px 18px; justify-content: center; }
footer { margin-top: 32px; text-align: center; }
</style>
</head>
<body>
<div class="wrap">
<header>${mark}<h1>${escapeHtml(title)}</h1>${data.hub.tagline ? `<p class="tagline">${escapeHtml(data.hub.tagline)}</p>` : ''}</header>
<main>
${data.sections.map(sectionHtml).join('\n')}
</main>
${data.links.length ? `<ul class="links">${data.links.map(link => `<li><a href="${href(link.url)}" rel="noopener">${escapeHtml(link.label)}</a></li>`).join('')}</ul>` : ''}
<footer>${poweredByHtml(poweredBy)}</footer>
</div>
<script>${SCRIPT}</script>
<script src="/helpbites.js" data-project="${escapeHtml(data.project.publicKey)}" data-features="chat" async></script>
</body>
</html>`
}
