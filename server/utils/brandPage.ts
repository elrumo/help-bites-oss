import { createHash } from 'node:crypto'
import {
  BRAND_RADII, BRAND_SECTIONS, BRAND_SECTION_LABELS, BRAND_TEMPLATES, BRAND_THEMES, brandSectionOf, hexToRgb, readableOn,
  type BrandConfig, type BrandFont, type BrandRadius, type BrandSection, type BrandTemplate, type BrandTheme
} from '#shared/brand'
import { formatBytes } from '#shared/entitlements'
import { poweredByHtml, type PoweredBy } from './branding'
import { escapeHtml } from './messageEmail'
import type { BrandAssetView } from './brand'

// The public brand page, /brand/<publicKey>, as server-rendered HTML in one of
// three templates. The kit is the subject, so the page wears it: its accent,
// its own typefaces (when they are on Google Fonts), its logo on its colour.
// One small fixed script copies colour values and, inside an iframe, reports
// the page's height; the CSP allows only that script, by hash.

export type BrandPageOptions = {
  template?: BrandTemplate
  theme?: BrandTheme
  radius?: BrandRadius
  accent?: string
  sections?: BrandSection[]
  /** Inside brand.js's iframe: no top bar, a static side panel, height reports. */
  embed?: boolean
}

const SCRIPT = `document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-copy]');if(!b||!navigator.clipboard)return;navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){b.classList.add('is-copied');setTimeout(function(){b.classList.remove('is-copied')},1400)})});if(window.parent!==window){var post=function(){window.parent.postMessage({source:'help-bites-brand',type:'resize',height:document.documentElement.scrollHeight},'*')};window.addEventListener('load',post);if(window.ResizeObserver)new ResizeObserver(post).observe(document.body)}`

export const BRAND_PAGE_CSP = `default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'sha256-${createHash('sha256').update(SCRIPT).digest('base64')}'; base-uri 'none'; form-action 'none'; frame-ancestors *`

const SANS = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif'
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace'

const RADII: Record<BrandRadius, [string, string]> = { sharp: ['0px', '0px'], soft: ['12px', '8px'], round: ['28px', '14px'] }

const LIGHT = '--bg: #ffffff; --surface: #f4f4f5; --text: #18181b; --muted: #6b6b74; --line: #e4e4e7; --checker: #ececee;'
const DARK = '--bg: #0f0f11; --surface: #1b1b1f; --text: #f4f4f5; --muted: #a1a1aa; --line: #2a2a2f; --checker: #232327;'

const FONT_ROLE_NOTE: Record<BrandFont['role'], string> = { display: 'For headlines', body: 'For text', mono: 'For code and numbers', other: '' }

/** A family name safe inside a CSS string. */
const family = (name: string) => name.replace(/[^\p{L}\p{N} \-_.]/gu, '').trim()

function stack(font: BrandFont | undefined, fallback: string): string {
  const name = font ? family(font.name) : ''
  return name ? `"${name}", ${fallback}` : fallback
}

const fileType = (mime: string) => ({ 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WebP', 'image/svg+xml': 'SVG', 'image/x-icon': 'ICO', 'application/pdf': 'PDF' }[mime] || 'File')

function fileFacts(asset: BrandAssetView): string {
  const dims = asset.width && asset.height ? `${asset.width} × ${asset.height}` : ''
  return [fileType(asset.mime), dims, formatBytes(asset.size)].filter(Boolean).join(', ')
}

function download(asset: BrandAssetView, label = 'Download'): string {
  return `<a class="dl" href="${escapeHtml(asset.downloadUrl)}" download>${label}<span class="sr"> ${escapeHtml(asset.name)}</span></a>`
}

const paragraphs = (text: string) => text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')

function heroArt(assets: BrandAssetView[], name: string, onAccent: string): string {
  // The logo drawn for the plate's shade, else any logo, else the app icon, else the name set in type.
  const wanted = onAccent === '#ffffff' ? 'dark' : 'light'
  const logos = assets.filter(a => a.kind === 'logo' && a.mime.startsWith('image/'))
  const logo = logos.find(a => a.background === wanted) || logos.find(a => a.background === 'any') || logos[0]
  if (logo) return `<img class="plate-logo" src="${escapeHtml(logo.url)}" alt="${escapeHtml(name)}">`
  const icon = assets.find(a => a.kind === 'icon' && a.mime.startsWith('image/'))
  if (icon) return `<img class="plate-icon" src="${escapeHtml(icon.url)}" alt="${escapeHtml(name)}">`
  return `<span class="plate-word">${escapeHtml(name)}</span>`
}

function colorsSection(config: BrandConfig): string {
  if (!config.colors.length) return ''
  const items = config.colors.map((c) => {
    const hex = c.hex.toUpperCase()
    const [r, g, b] = hexToRgb(c.hex)
    return `<li>
<button class="chip" type="button" data-copy="${hex}" style="--c: ${c.hex}; --on: ${readableOn(c.hex)}" aria-label="Copy ${hex}"><span class="chip-fill"><span class="chip-copied" aria-hidden="true">Copied</span></span></button>
<div class="chip-meta"><strong>${escapeHtml(c.name || hex)}</strong><span>${hex}</span><span>RGB ${r} ${g} ${b}</span>${c.usage ? `<p>${escapeHtml(c.usage)}</p>` : ''}</div>
</li>`
  }).join('')
  return `<ul class="swatches">${items}</ul><p class="hint">Select a colour to copy its hex value.</p>`
}

function typographySection(config: BrandConfig): string {
  if (!config.fonts.length) return ''
  return `<div class="fonts">${config.fonts.map((f) => {
    const face = `"${family(f.name)}", ${f.role === 'mono' ? MONO : f.role === 'display' ? SERIF : SANS}`
    const facts = [FONT_ROLE_NOTE[f.role], f.weights && `Weights ${f.weights}`].filter(Boolean).map(t => `<span>${escapeHtml(t)}</span>`).join('')
    return `<article class="font" style="--face: ${escapeHtml(face)}">
<div class="specimen" aria-hidden="true">Aa</div>
<div class="font-meta"><h3>${escapeHtml(f.name)}</h3><p class="facts">${facts}</p>
<p class="sample">${escapeHtml(f.sample || 'Sphinx of black quartz, judge my vow.')}</p>
<p class="glyphs" aria-hidden="true">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz 0123456789</p>
${f.downloadUrl ? `<a class="dl" href="${escapeHtml(f.downloadUrl)}" rel="noopener">Get ${escapeHtml(f.name)}</a>` : ''}</div>
</article>`
  }).join('')}</div>`
}

function logosSection(assets: BrandAssetView[]): string {
  const logos = assets.filter(a => brandSectionOf(a.kind) === 'logos')
  if (!logos.length) return ''
  return `<ul class="tiles">${logos.map(a => `<li class="tile">
<div class="tile-art on-${a.background}"><img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}" loading="lazy"></div>
<div class="tile-meta"><div><span class="tile-name">${escapeHtml(a.name)}</span><span class="muted">${escapeHtml(fileFacts(a))}</span></div>${download(a)}</div>
</li>`).join('')}</ul>`
}

function screenshotsSection(assets: BrandAssetView[]): string {
  const shots = assets.filter(a => a.kind === 'screenshot')
  if (!shots.length) return ''
  return `<ul class="shots">${shots.map(a => `<li><img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}" loading="lazy"${a.width && a.height ? ` width="${a.width}" height="${a.height}"` : ''}><div class="shot-meta"><span>${escapeHtml(a.name)}</span>${download(a)}</div></li>`).join('')}</ul>`
}

function assetsSection(assets: BrandAssetView[]): string {
  const files = assets.filter(a => brandSectionOf(a.kind) === 'assets')
  if (!files.length) return ''
  return `<ul class="files">${files.map(a => `<li>
<div class="file-thumb on-${a.background}">${a.mime.startsWith('image/') ? `<img src="${escapeHtml(a.url)}" alt="" loading="lazy">` : `<span>${fileType(a.mime)}</span>`}</div>
<div class="file-meta"><span class="tile-name">${escapeHtml(a.name)}</span>${a.description ? `<span class="muted">${escapeHtml(a.description)}</span>` : ''}<span class="muted">${escapeHtml(fileFacts(a))}</span></div>
${download(a)}
</li>`).join('')}</ul>`
}

function guidelinesSection(guidelines: { id: string, title: string, html: string }[]): string {
  if (!guidelines.length) return ''
  return `<div class="rules">${guidelines.map(g => `<article class="rule"><h3>${escapeHtml(g.title)}</h3><div class="prose">${g.html}</div></article>`).join('')}</div>`
}

const ANCHORS: Record<BrandSection, string> = { colors: 'colours', typography: 'typography', logos: 'logos', screenshots: 'screenshots', assets: 'files', guidelines: 'guidelines' }

export type BrandPageData = {
  name: string
  iconUrl: string
  tagline: string
  about: string
  accent: string
  config: BrandConfig
  guidelines: { id: string, title: string, html: string }[]
  assets: BrandAssetView[]
}

export function renderBrandPage(data: BrandPageData, poweredBy: PoweredBy | null, options: BrandPageOptions = {}): string {
  const page = data.config.page
  const template = BRAND_TEMPLATES.includes(options.template as BrandTemplate) ? options.template! : page.template
  const theme = BRAND_THEMES.includes(options.theme as BrandTheme) ? options.theme! : page.theme
  const radius = BRAND_RADII.includes(options.radius as BrandRadius) ? options.radius! : page.radius
  const accent = /^#[0-9a-f]{6}$/i.test(options.accent || '') ? options.accent!.toLowerCase() : data.accent
  const onAccent = readableOn(accent)
  const order = (options.sections?.length ? options.sections : page.sections).filter(s => BRAND_SECTIONS.includes(s))
  const assets = data.assets

  const bodies: Record<BrandSection, () => string> = {
    colors: () => colorsSection(data.config),
    typography: () => typographySection(data.config),
    logos: () => logosSection(assets),
    screenshots: () => screenshotsSection(assets),
    assets: () => assetsSection(assets),
    guidelines: () => guidelinesSection(data.guidelines)
  }
  const sections = order.map(key => ({ key, html: bodies[key]() })).filter(s => s.html)
  const nav = sections.map(s => `<a href="#${ANCHORS[s.key]}">${BRAND_SECTION_LABELS[s.key]}</a>`).join('')
  const main = sections.map(s => `<section class="sec" id="${ANCHORS[s.key]}"><h2>${BRAND_SECTION_LABELS[s.key]}</h2>${s.html}</section>`).join('\n')
    || '<section class="sec empty"><p class="muted">Nothing has been added to this brand kit yet.</p></section>'

  const display = data.config.fonts.find(f => f.role === 'display') || data.config.fonts.find(f => f.role === 'body')
  const body = data.config.fonts.find(f => f.role === 'body') || display
  const fontLinks = [...new Set(data.config.fonts.map(f => f.cssUrl).filter(Boolean))].map(url => `<link rel="stylesheet" href="${escapeHtml(url)}">`).join('\n')
  const [r, rs] = RADII[radius]
  const palette = theme === 'light' ? `:root { ${LIGHT} color-scheme: light; }`
    : theme === 'dark' ? `:root { ${DARK} color-scheme: dark; }`
      : `:root { ${LIGHT} color-scheme: light dark; } @media (prefers-color-scheme: dark) { :root { ${DARK} } }`
  const vars = `:root { --accent: ${accent}; --on-accent: ${onAccent}; --display: ${stack(display, template === 'editorial' ? SERIF : SANS)}; --body: ${stack(body, SANS)}; --mono: ${MONO}; --r: ${r}; --r-sm: ${rs}; }`

  const headline = page.headline || data.name
  const lede = page.intro || data.tagline
  const mark = data.iconUrl ? `<img class="mark" src="${escapeHtml(data.iconUrl)}" alt="">` : ''
  const hero = `<h1 class="headline">${escapeHtml(headline)}</h1>${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ''}`
  const about = data.about ? `<div class="about">${paragraphs(data.about)}</div>` : ''
  const foot = `<footer class="foot"><p>${escapeHtml(data.name)} brand kit</p>${poweredByHtml(poweredBy)}</footer>`
  const bar = options.embed ? '' : `<header class="bar">${mark}<span class="name">${escapeHtml(data.name)}</span><nav aria-label="Sections">${nav}</nav></header>`

  const content = template === 'split'
    ? `<div class="frame">
<aside class="side"><div>${mark ? `<div class="side-mark">${mark}</div>` : ''}${hero}</div><div class="side-art">${heroArt(assets, data.name, onAccent)}</div><nav aria-label="Sections">${nav}</nav></aside>
<main class="main">${about}${main}${foot}</main>
</div>`
    : `<div class="wrap">${bar}
<section class="hero">${hero}<div class="plate">${heroArt(assets, data.name, onAccent)}</div></section>
<main>${about}${main}</main>
${foot}
</div>`

  const og = assets.find(a => a.kind === 'social') || assets.find(a => a.kind === 'logo' && a.mime.startsWith('image/') && a.mime !== 'image/svg+xml')
  const title = `${data.name} brand kit`
  return `<!doctype html>
<html lang="en" class="t-${template}${options.embed ? ' is-embed' : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${lede ? `<meta name="description" content="${escapeHtml(lede)}">` : ''}
<meta property="og:title" content="${escapeHtml(title)}">
${og ? `<meta property="og:image" content="${escapeHtml(og.url)}">` : ''}
${data.iconUrl ? `<link rel="icon" href="${escapeHtml(data.iconUrl)}">` : ''}
${fontLinks}
<style>${palette}${vars}${CSS}${TEMPLATE_CSS[template]}</style>
</head>
<body>
${content}
<script>${SCRIPT}</script>
</body>
</html>`
}

const CSS = `
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } * { transition: none !important; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 var(--body); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
img { display: block; max-width: 100%; height: auto; }
a { color: inherit; text-underline-offset: 3px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.muted { color: var(--muted); }
.wrap { max-width: 1160px; margin: 0 auto; padding: 0 28px; }
.bar { display: flex; align-items: center; gap: 12px; padding: 22px 0; }
.mark { width: 28px; height: 28px; border-radius: var(--r-sm); object-fit: cover; }
.bar .name { font-weight: 600; letter-spacing: -0.01em; }
.bar nav { margin-left: auto; display: flex; gap: 22px; font-size: 14px; }
.bar nav a, .side nav a { text-decoration: none; }
.bar nav a { color: var(--muted); }
.bar nav a:hover { color: var(--text); }
.headline { margin: 0; font-family: var(--display); text-wrap: balance; }
.lede { margin: 0; color: var(--muted); text-wrap: pretty; }
.plate { display: grid; place-items: center; background: var(--accent); color: var(--on-accent); border-radius: var(--r); overflow: hidden; }
.plate-logo { max-width: min(56%, 520px); max-height: 46%; width: auto; object-fit: contain; }
.plate-icon { width: clamp(96px, 16vw, 180px); border-radius: 22%; box-shadow: 0 18px 48px rgb(0 0 0 / 0.22); }
.plate-word { font: 600 clamp(40px, 8vw, 104px)/1 var(--display); letter-spacing: -0.04em; padding: 0 24px; text-align: center; }
.about { max-width: 64ch; padding-top: 64px; font-size: 18px; line-height: 1.65; }
.about p { margin: 0 0 1em; }
.sec { padding-top: 88px; }
.sec > h2 { margin: 0 0 32px; font: 600 clamp(26px, 3.2vw, 34px)/1.1 var(--display); letter-spacing: -0.025em; }
.empty { padding-bottom: 40px; }
.hint { margin: 18px 0 0; font-size: 13px; color: var(--muted); }

.swatches { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(156px, 1fr)); gap: 28px 20px; }
.chip { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: copy; border-radius: var(--r); }
.chip-fill { display: flex; align-items: flex-end; aspect-ratio: 4 / 5; padding: 14px; background: var(--c); color: var(--on); border-radius: var(--r); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 9%, transparent); font-size: 13px; font-weight: 600; }
.chip-copied { opacity: 0; transform: translateY(4px); transition: opacity 0.18s ease, transform 0.18s ease; }
.chip.is-copied .chip-copied { opacity: 1; transform: none; }
.chip:focus-visible, .dl:focus-visible, nav a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.chip-meta { margin-top: 14px; font-size: 14px; line-height: 1.5; }
.chip-meta strong { display: block; font-weight: 600; }
.chip-meta span { display: block; color: var(--muted); font-family: var(--mono); font-size: 12.5px; }
.chip-meta p { margin: 8px 0 0; color: var(--muted); font-size: 13px; }

.fonts { display: grid; gap: 20px; }
.font { display: grid; grid-template-columns: minmax(180px, 0.8fr) 2fr; gap: 32px; padding: 32px; background: var(--surface); border-radius: var(--r); }
.specimen { font: 500 clamp(96px, 14vw, 168px)/0.9 var(--face); letter-spacing: -0.04em; }
.font-meta h3 { margin: 0; font: 600 22px/1.2 var(--face); letter-spacing: -0.01em; }
.facts { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 6px 0 18px; color: var(--muted); font-size: 14px; }
.sample { margin: 0 0 14px; font: 400 clamp(22px, 2.6vw, 30px)/1.3 var(--face); letter-spacing: -0.01em; text-wrap: balance; }
.glyphs { margin: 0 0 18px; font: 400 15px/1.7 var(--face); color: var(--muted); overflow-wrap: anywhere; }

.tiles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; }
/* overflow: hidden keeps the 4:3 box from growing to a tall image's height. */
.tile-art { display: grid; place-items: center; aspect-ratio: 4 / 3; padding: 14%; overflow: hidden; border-radius: var(--r); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent); }
.tile-art img { max-width: 100%; max-height: 100%; min-height: 0; object-fit: contain; }
.on-light { background: #f6f6f7; }
.on-dark { background: #18181b; }
.on-any { background-color: var(--surface); background-image: linear-gradient(45deg, var(--checker) 25%, transparent 25%, transparent 75%, var(--checker) 75%), linear-gradient(45deg, var(--checker) 25%, transparent 25%, transparent 75%, var(--checker) 75%); background-size: 16px 16px; background-position: 0 0, 8px 8px; }
.tile-meta { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-top: 12px; font-size: 14px; }
.tile-name { display: block; font-weight: 600; }
.tile-meta .muted, .file-meta .muted { display: block; font-size: 13px; }
.dl { flex: none; display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: calc(var(--r-sm) + 4px); background: color-mix(in srgb, var(--text) 7%, transparent); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.dl:hover { background: color-mix(in srgb, var(--text) 12%, transparent); }

.shots { list-style: none; margin: 0 -28px; padding: 0 28px 8px; display: flex; gap: 20px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: thin; }
.shots li { flex: none; scroll-snap-align: start; }
.shots img { height: min(560px, 70vh); width: auto; border-radius: var(--r); box-shadow: inset 0 0 0 1px var(--line); background: var(--surface); }
.shot-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; font-size: 14px; }

.files { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.files li { display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.file-thumb { display: grid; place-items: center; width: 56px; height: 56px; padding: 8px; border-radius: var(--r-sm); overflow: hidden; font-size: 11px; font-weight: 700; color: var(--muted); }
.file-thumb img { max-height: 100%; object-fit: contain; }
.file-meta { min-width: 0; font-size: 14px; }

.rules { display: grid; gap: 0; border-top: 1px solid var(--line); }
.rule { display: grid; grid-template-columns: minmax(180px, 1fr) 2fr; gap: 32px; padding: 28px 0; border-bottom: 1px solid var(--line); }
.rule h3 { margin: 0; font: 600 18px/1.35 var(--display); letter-spacing: -0.01em; }
.prose { font-size: 16px; line-height: 1.7; }
.prose > :first-child { margin-top: 0; }
.prose p, .prose ul, .prose ol { margin: 0 0 1em; }
.prose li { margin: 0.2em 0; }
.prose code { font: 0.9em var(--mono); background: var(--surface); padding: 1px 5px; border-radius: 5px; }
.prose img { border-radius: var(--r-sm); margin: 8px 0; }

.foot { padding: 96px 0 48px; color: var(--muted); font-size: 13px; }
.foot p { margin: 0; }

@media (max-width: 760px) {
  .wrap { padding: 0 18px; }
  .bar nav { display: none; }
  .sec { padding-top: 64px; }
  .font, .rule { grid-template-columns: 1fr; gap: 12px; }
  .font { padding: 24px; }
  .shots { margin: 0 -18px; padding: 0 18px 8px; }
  .shots img { height: 420px; }
}
@media print { .bar nav, .dl, .hint { display: none; } .sec { break-inside: avoid; } }
`

const TEMPLATE_CSS: Record<BrandTemplate, string> = {
  minimal: `
.t-minimal .hero { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); align-items: end; gap: 20px 56px; padding-top: 56px; }
.t-minimal .headline { font-weight: 600; font-size: clamp(48px, 8vw, 104px); line-height: 0.94; letter-spacing: -0.05em; }
.t-minimal .lede { font-size: 18px; line-height: 1.55; max-width: 40ch; padding-bottom: 6px; }
.t-minimal .plate { grid-column: 1 / -1; aspect-ratio: 16 / 7; margin-top: 36px; }
@media (max-width: 760px) { .t-minimal .hero { grid-template-columns: 1fr; padding-top: 28px; } .t-minimal .plate { aspect-ratio: 4 / 3; margin-top: 16px; } }
`,
  editorial: `
.t-editorial .wrap { max-width: 820px; }
.t-editorial .bar { justify-content: center; }
.t-editorial .bar nav { display: none; }
.t-editorial .hero { padding-top: 72px; text-align: center; }
.t-editorial .headline { font-weight: 400; font-size: clamp(56px, 11vw, 132px); line-height: 0.92; letter-spacing: -0.035em; }
.t-editorial .lede { max-width: 34ch; margin: 24px auto 0; font: 400 clamp(19px, 2.2vw, 23px)/1.5 var(--display); }
.t-editorial .plate { aspect-ratio: 1; max-width: 560px; margin: 56px auto 0; }
.t-editorial .about { margin: 0 auto; text-align: center; font-family: var(--display); font-size: 20px; }
.t-editorial .sec { padding-top: 104px; }
.t-editorial .sec > h2 { text-align: center; font-weight: 400; font-size: clamp(30px, 4vw, 42px); }
.t-editorial .swatches { grid-template-columns: repeat(auto-fit, minmax(128px, 160px)); justify-content: center; text-align: center; }
.t-editorial .chip { border-radius: 50%; }
.t-editorial .chip-fill { aspect-ratio: 1; border-radius: 50%; justify-content: center; align-items: center; }
.t-editorial .hint { text-align: center; }
.t-editorial .font { grid-template-columns: 1fr; text-align: center; background: none; border-top: 1px solid var(--line); border-radius: 0; padding: 40px 0 8px; }
.t-editorial .facts { justify-content: center; }
.t-editorial .rule { grid-template-columns: 1fr; gap: 10px; }
.t-editorial .rule h3 { font-weight: 400; font-size: 24px; }
.t-editorial .foot { text-align: center; }
`,
  split: `
.t-split .frame { display: grid; grid-template-columns: minmax(320px, 42%) minmax(0, 1fr); min-height: 100vh; }
.t-split .side { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 32px; padding: 40px 44px; background: var(--accent); color: var(--on-accent); overflow: auto; }
.t-split .side-mark { margin-bottom: 40px; }
.t-split .side-mark .mark { width: 40px; height: 40px; }
.t-split .headline { font-weight: 600; font-size: clamp(44px, 5.4vw, 80px); line-height: 0.95; letter-spacing: -0.045em; }
.t-split .lede { margin-top: 18px; color: inherit; opacity: 0.78; font-size: 18px; max-width: 32ch; }
.t-split .side-art { flex: 1; display: grid; place-items: center; min-height: 160px; }
.t-split .side-art .plate-logo { max-width: 72%; max-height: 180px; }
.t-split .side-art .plate-word { display: none; }
.t-split .side nav { display: flex; flex-wrap: wrap; gap: 6px 20px; font-size: 14px; }
.t-split .side nav a { opacity: 0.72; }
.t-split .side nav a:hover { opacity: 1; }
.t-split .main { padding: 8px 56px 0; min-width: 0; }
.t-split .about { padding-top: 56px; }
.t-split .sec:first-of-type { padding-top: 56px; }
.t-split .shots { margin: 0 -56px; padding: 0 56px 8px; }
.t-split.is-embed .frame { min-height: 0; }
.t-split.is-embed .side { position: static; height: auto; min-height: 520px; }
@media (max-width: 900px) {
  .t-split .frame { grid-template-columns: 1fr; }
  .t-split .side { position: static; height: auto; min-height: 70vh; padding: 28px 22px; }
  .t-split .main { padding: 0 20px; }
  .t-split .shots { margin: 0 -20px; padding: 0 20px 8px; }
}
`
}
