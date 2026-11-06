import { Marked } from 'marked'
import { readableOn } from '../brand'
import { DEFAULT_ACCENT } from '../projectLook'
import { CMS_ICONS } from './icons'
import { DEFAULT_STYLE, SAFE_COLOR, normalizeAsset, type CmsBlock, type CmsComponentDef, type CmsField, type CmsLibrary, type CmsStyle } from './content'

/**
 * Content tree → HTML, the same on the client (the editor's preview) and the
 * server (hosted pages, `format=html` in the delivery API).
 *
 * A component's template fills in its fields:
 *   {{@key}}               the value, escaped or checked for its type; a
 *                          `blocks` field is its children's HTML
 *   {{@image.alt}}         an asset's alt, width, height, mime (or url)
 *                          an `icon` field is an inline SVG (`.hb-icon`, 1em, currentColor)
 *   {{#key}}…{{/key}}      only when the value is set (non-empty, true, any blocks)
 *   {{^key}}…{{/key}}      only when it is not
 *   {{$pk}} {{$host}}      the project's public key and the HelpBites host (forms)
 *   {{$uid}} {{$parent}}   this block's `_uid` and its parent's (radio groups, exclusive <details>)
 * Each block's outer element gets `data-hb-uid` and `data-hb-component` (the
 * editor and the bridge select by them) and its animation as `data-hb-anim`.
 */

export const MOTION_PATH = '/vendor/motion-14.5.0.js'

export type RenderContext = {
  library: CmsLibrary
  pk: string
  /** The HelpBites origin, no trailing slash: forms post to it, the page runtime loads Motion from it. */
  host: string
}

export function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** A link a visitor can follow: web, mail, phone, a fragment or a path on the same site; anything else is `#`. */
export function safeUrl(url: string): string {
  const u = String(url ?? '').trim()
  return /^(https?:|mailto:|tel:|#|\/(?!\/)|\?)/i.test(u) ? u : '#'
}

// Markdown from fields: raw HTML in it is dropped (never passed through), and links and images keep only safe URLs.
const md = new Marked({
  async: false,
  gfm: true,
  renderer: {
    html: () => '',
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const external = /^https?:/i.test(href)
      return `<a href="${esc(safeUrl(href))}"${title ? ` title="${esc(title)}"` : ''}${external ? ' rel="noopener"' : ''}>${text}</a>`
    },
    image({ href, title, text }) {
      return /^https?:\/\//i.test(href) ? `<img src="${esc(href)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">` : esc(text)
    }
  }
})

export function renderMarkdown(text: string): string {
  return text ? md.parse(String(text)) as string : ''
}

function valueOf(field: CmsField, block: CmsBlock): unknown {
  return Object.hasOwn(block, field.key) ? block[field.key] : field.default
}

function isSet(field: CmsField | undefined, block: CmsBlock): boolean {
  if (!field) return false
  const v = valueOf(field, block)
  if (field.type === 'blocks') return Array.isArray(v) && v.length > 0
  if (field.type === 'asset') return !!normalizeAsset(v)
  if (field.type === 'boolean') return v === true
  if (field.type === 'number') return typeof v === 'number' && Number.isFinite(v)
  return typeof v === 'string' && v.trim() !== ''
}

const SECTION = /\{\{([#^])\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g
const SLOT = /\{\{\s*@([A-Za-z][A-Za-z0-9_]*)(?:\.(alt|width|height|mime|url))?\s*\}\}/g
const CONTEXT = /\{\{\s*\$(pk|host|uid|parent)\s*\}\}/g

type Walk = RenderContext & { used: Set<string> }

function fill(def: CmsComponentDef, block: CmsBlock, ctx: Walk, parent: string): string {
  const fields = new Map(def.fields.map(f => [f.key, f]))
  let html = def.html
  // Repeated, so a section can sit inside another of a different key.
  for (let i = 0; i < 8 && SECTION.test(html); i++) {
    SECTION.lastIndex = 0
    html = html.replace(SECTION, (_m, kind: string, key: string, inner: string) => (isSet(fields.get(key), block) === (kind === '#') ? inner : ''))
  }
  SECTION.lastIndex = 0
  html = html.replace(SLOT, (_m, key: string, prop?: string) => {
    const field = fields.get(key)
    if (!field) return ''
    const v = valueOf(field, block)
    switch (field.type) {
      case 'blocks': return renderList(Array.isArray(v) ? v as CmsBlock[] : [], ctx, block._uid)
      case 'asset': {
        const a = normalizeAsset(v)
        if (!a) return ''
        if (prop === 'alt') return esc(a.alt)
        if (prop === 'width' || prop === 'height') return a[prop] ? String(a[prop]) : ''
        if (prop === 'mime') return esc(a.mime)
        return esc(a.url)
      }
      case 'markdown': return renderMarkdown(typeof v === 'string' ? v : '')
      case 'textarea': return esc(typeof v === 'string' ? v : '').replace(/\n/g, '<br>')
      case 'url': return typeof v === 'string' && v.trim() ? esc(safeUrl(v)) : ''
      case 'color': return typeof v === 'string' && SAFE_COLOR.test(v.trim()) ? v.trim() : ''
      case 'number': return typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
      case 'boolean': return v === true ? 'true' : ''
      case 'icon': return typeof v === 'string' && Object.hasOwn(CMS_ICONS, v) ? `<svg class="hb-icon" viewBox="0 0 24 24" aria-hidden="true">${CMS_ICONS[v]}</svg>` : ''
      default: return esc(v ?? '')
    }
  })
  const context: Record<string, string> = { pk: ctx.pk, host: ctx.host, uid: block._uid, parent }
  return html.replace(CONTEXT, (_m, name: string) => esc(context[name]))
}

/** The block's outer tag carries its id, component and animation. */
function tag(html: string, block: CmsBlock): string {
  const anim = block._anim
  const hide = anim && anim.trigger !== 'scroll' ? ' data-hb-hide' : ''
  const attrs = ` data-hb-uid="${esc(block._uid)}" data-hb-component="${esc(block.component)}"${anim ? ` data-hb-anim="${esc(JSON.stringify(anim))}"${hide}` : ''}`
  return html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1${attrs}`)
}

function renderBlock(block: CmsBlock, ctx: Walk, parent = ''): string {
  const def = ctx.library.get(block.component)
  if (!def || !def.html || block._hidden) return ''
  ctx.used.add(def.key)
  return tag(fill(def, block, ctx, parent), block)
}

function renderList(blocks: CmsBlock[], ctx: Walk, parent: string): string {
  return blocks.map(b => renderBlock(b, ctx, parent)).join('\n')
}

const RADII: Record<CmsStyle['radius'], [string, string]> = { sharp: ['0px', '0px'], soft: ['14px', '8px'], round: ['28px', '999px'] }
const WIDTHS: Record<CmsStyle['width'], string> = { narrow: '760px', normal: '1120px', wide: '1320px' }
const LIGHT = '--hb-bg: #ffffff; --hb-surface: #f5f5f4; --hb-text: #1c1917; --hb-muted: #6b6560; --hb-line: #e7e5e4;'
const DARK = '--hb-bg: #0e0e10; --hb-surface: #19191c; --hb-text: #f5f5f4; --hb-muted: #a8a29e; --hb-line: #2a2a2e;'
const SANS = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'

const family = (name: string) => name.replace(/[^A-Za-z0-9 ]/g, '').trim()

/** The theme as CSS variables on :root, for every component's CSS to use. */
export function themeCss(style: CmsStyle, accent: string): string {
  const [radius, radiusSm] = RADII[style.radius]
  const body = family(style.bodyFont)
  const heading = family(style.headingFont)
  const vars = `--hb-accent: ${accent}; --hb-on-accent: ${readableOn(accent)}; --hb-radius: ${radius}; --hb-radius-sm: ${radiusSm}; --hb-max: ${WIDTHS[style.width]}; --hb-font: ${body ? `"${body}", ` : ''}${SANS}; --hb-heading-font: ${heading ? `"${heading}", ` : body ? `"${body}", ` : ''}${SANS};`
  const modes = style.mode === 'dark' ? `:root { ${DARK} color-scheme: dark; }` : style.mode === 'auto' ? `:root { ${LIGHT} } @media (prefers-color-scheme: dark) { :root { ${DARK} color-scheme: dark; } }` : `:root { ${LIGHT} }`
  return `:root { ${vars} }\n${modes}`
}

/** Typefaces Apple and Windows devices already have: named, never fetched (elsewhere the system font stands in). */
const SYSTEM_FONTS = new Set(['avenir', 'avenir next', 'helvetica', 'helvetica neue', 'arial', 'georgia', 'times new roman', 'menlo', 'sf pro', 'segoe ui'])

export function fontLink(style: CmsStyle): string {
  const families = [...new Set([style.headingFont, style.bodyFont].map(family).filter(f => f && !SYSTEM_FONTS.has(f.toLowerCase())))]
  if (!families.length) return ''
  const query = families.map(f => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700`).join('&')
  return `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${query}&display=swap">`
}

/** The base every page gets: a reset, the type scale and the `.hb-*` helpers built-ins use (a host page may restyle them). */
export const BASE_CSS = `*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body { margin: 0; background: var(--hb-bg); color: var(--hb-text); font: 16px/1.6 var(--hb-font); -webkit-font-smoothing: antialiased; overflow-x: clip; }
img, video, iframe { max-width: 100%; display: block; }
.hb-icon { width: 1em; height: 1em; flex: none; display: inline-block; vertical-align: -0.125em; }
img, video { height: auto; }
a { color: inherit; }
h1, h2, h3, h4 { font-family: var(--hb-heading-font); line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 .5em; text-wrap: balance; }
h1 { font-size: clamp(2.4rem, 5vw, 4rem); }
h2 { font-size: clamp(1.8rem, 3.4vw, 2.6rem); }
h3 { font-size: 1.25rem; }
p { margin: 0 0 1em; text-wrap: pretty; }
.hb-container { width: 100%; max-width: var(--hb-max); margin: 0 auto; padding: 0 24px; }
.hb-section { padding: clamp(56px, 8vw, 104px) 0; }
.hb-eyebrow { color: var(--hb-accent); font-size: .8rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 12px; }
.hb-lead { color: var(--hb-muted); font-size: 1.15rem; max-width: 62ch; }
.hb-center { text-align: center; }
.hb-center .hb-lead { margin-left: auto; margin-right: auto; }
.hb-muted { color: var(--hb-muted); }
.hb-prose > :last-child { margin-bottom: 0; }
.hb-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.hb-center .hb-actions { justify-content: center; }
.hb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 22px; border-radius: var(--hb-radius-sm); background: var(--hb-accent); color: var(--hb-on-accent); border: 1px solid transparent; font: 600 15px/1 var(--hb-font); text-decoration: none; cursor: pointer; transition: transform .15s ease, opacity .15s ease; }
.hb-btn:hover { transform: translateY(-1px); opacity: .92; }
.hb-btn--ghost { background: transparent; color: var(--hb-text); border-color: var(--hb-line); }
.hb-card { background: var(--hb-surface); border: 1px solid var(--hb-line); border-radius: var(--hb-radius); padding: 28px; }
.hb-grid { display: grid; gap: 20px; grid-template-columns: repeat(var(--hb-cols, 3), minmax(0, 1fr)); }
@media (max-width: 860px) { .hb-grid { grid-template-columns: repeat(min(var(--hb-cols, 3), 2), minmax(0, 1fr)); } }
@media (max-width: 560px) { .hb-grid { grid-template-columns: minmax(0, 1fr); } }
.hb-btn--ink { background: var(--hb-text); color: var(--hb-bg); }
.hb-btn--glass { background: rgb(255 255 255 / .12); color: #fff; border-color: rgb(255 255 255 / .25); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.hb-btn--soft { background: var(--hb-surface); color: var(--hb-text); border-color: var(--hb-line); }
.hb-btn .hb-icon { font-size: 1.1em; }
.hb-title { font-size: clamp(2.1rem, 4.6vw, 3.35rem); line-height: 1.06; font-weight: 700; letter-spacing: -0.032em; margin: 14px 0 0; text-wrap: balance; }
.hb-heading { font-size: clamp(1.75rem, 3vw, 2.1rem); line-height: 1.12; font-weight: 600; letter-spacing: -0.022em; margin: 14px 0 0; }
.hb-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.hb-pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 6px 12px; font-size: 13px; font-weight: 600; line-height: 1; background: color-mix(in srgb, var(--hb-text) 6%, transparent); color: var(--hb-text); }
.hb-pill--blue { background: rgb(59 130 246 / .1); color: #2563eb; }
.hb-pill--amber { background: rgb(245 158 11 / .12); color: #b45309; }
.hb-pill--violet { background: rgb(139 92 246 / .1); color: #7c3aed; }
.hb-pill--emerald { background: rgb(16 185 129 / .1); color: #047857; }
.hb-pill--dark { background: var(--hb-text); color: var(--hb-bg); }
.hb-pill--glass { background: rgb(255 255 255 / .1); color: rgb(255 255 255 / .85); box-shadow: inset 0 0 0 1px rgb(255 255 255 / .1); }
.hb-ping { position: relative; width: 8px; height: 8px; border-radius: 999px; background: currentColor; }
.hb-ping::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: currentColor; animation: hb-ping 1.8s cubic-bezier(0, 0, .2, 1) infinite; }
@keyframes hb-ping { 75%, 100% { transform: scale(2.4); opacity: 0; } }
.hb-step { display: inline-flex; align-items: center; height: 28px; border-radius: 999px; padding: 0 12px; margin-bottom: 14px; background: rgb(59 130 246 / .1); color: #2563eb; font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
.hb-textlink { color: var(--hb-accent); font-weight: 600; text-decoration: none; align-self: center; }
.hb-textlink::after { content: " ↗"; }
.hb-checks ul { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 16px; font-size: 17px; line-height: 1.35; }
.hb-checks li { display: flex; gap: 12px; align-items: flex-start; }
.hb-checks li::before { content: ""; flex: none; width: 20px; height: 20px; margin-top: 1px; border-radius: 999px; background: var(--hb-tint, var(--hb-accent)) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center / 12px no-repeat; }
.hb-tint--blue { --hb-tint: #3b82f6; } .hb-tint--amber { --hb-tint: #f59e0b; } .hb-tint--violet { --hb-tint: #8b5cf6; } .hb-tint--emerald { --hb-tint: #10b981; } .hb-tint--neutral { --hb-tint: #171717; }
.hb-stage { position: relative; aspect-ratio: 5 / 4; border-radius: 2rem; overflow: hidden; background: #f5f5f5; isolation: isolate; }
.hb-stage::before { content: ""; position: absolute; inset: 0; z-index: -1; }
.hb-stage--blue::before { background: radial-gradient(80% 70% at 10% 0%, rgb(147 197 253 / .65), transparent 70%), radial-gradient(60% 60% at 100% 100%, rgb(196 181 253 / .45), transparent 70%); }
.hb-stage--amber::before { background: radial-gradient(80% 70% at 10% 0%, rgb(253 230 138 / .7), transparent 70%), radial-gradient(60% 60% at 100% 100%, rgb(254 202 202 / .5), transparent 70%); }
.hb-stage--violet::before { background: radial-gradient(80% 70% at 90% 0%, rgb(196 181 253 / .65), transparent 70%), radial-gradient(60% 60% at 0% 100%, rgb(165 243 252 / .5), transparent 70%); }
.hb-stage--emerald::before { background: radial-gradient(80% 70% at 10% 0%, rgb(167 243 208 / .7), transparent 70%), radial-gradient(60% 60% at 100% 100%, rgb(186 230 253 / .5), transparent 70%); }
.hb-stage--bleed img { position: absolute; top: 9%; left: 7%; width: 128%; max-width: none; border-radius: 14px; background: #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / .06), 0 24px 60px -24px rgb(15 23 42 / .35); -webkit-mask-image: linear-gradient(to bottom, #000 45%, transparent 92%); mask-image: linear-gradient(to bottom, #000 45%, transparent 92%); }
.hb-stage--center img { position: absolute; top: 9%; left: 50%; width: 46%; transform: translateX(-50%); border-radius: 14px; box-shadow: 0 24px 60px -24px rgb(15 23 42 / .35); -webkit-mask-image: linear-gradient(to bottom, #000 55%, transparent 95%); mask-image: linear-gradient(to bottom, #000 55%, transparent 95%); }
.hb-stage--contain img { position: absolute; inset: 8%; width: 84%; height: 84%; object-fit: contain; }
.hb-js [data-hb-hide], .hb-js [data-hb-anim]:not([data-hb-anim^="{"]):not([data-hb-anim="parallax"]) { opacity: 0; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }`

/**
 * The one script a hosted page runs, allowed by its hash. Inside pages.js's
 * iframe it reports the page height. With animations on the page it adds
 * `hb-js` at once (animated blocks start hidden), loads Motion from
 * `data-motion` and plays each `data-hb-anim`; if Motion is not there within
 * 3 s, everything shows as is. Reduced motion: nothing hides, nothing moves.
 */
export const PAGE_RUNTIME = `(function () {
  var d = document, h = d.documentElement, script = d.currentScript, src = script && script.getAttribute('data-motion');
  if (window.parent !== window && /[?&]embed=1/.test(location.search)) {
    var post = function () { parent.postMessage({ source: 'help-bites-page', type: 'resize', height: h.scrollHeight }, '*'); };
    addEventListener('load', post);
    d.addEventListener('DOMContentLoaded', function () { if (window.ResizeObserver) new ResizeObserver(post).observe(d.body); });
  }
  if (!src || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  h.classList.add('hb-js');
  var timer = setTimeout(show, 3000);
  function show() { h.classList.remove('hb-js'); }
  var EASE = { 'ease-out': [0.16, 1, 0.3, 1], 'ease-in-out': [0.65, 0, 0.35, 1], linear: 'linear' };
  function frames(a) {
    var x = a.distance, f = { opacity: [0, 1] };
    if (a.effect === 'fade-up') f.y = [x, 0];
    if (a.effect === 'fade-down') f.y = [-x, 0];
    if (a.effect === 'fade-left') f.x = [x, 0];
    if (a.effect === 'fade-right') f.x = [-x, 0];
    if (a.effect === 'zoom-in') f.scale = [0.92, 1];
    if (a.effect === 'zoom-out') f.scale = [1.08, 1];
    if (a.effect === 'blur') f.filter = ['blur(12px)', 'blur(0px)'];
    if (a.effect === 'parallax') f = { y: [-x, x] };
    return f;
  }
  function read(el) {
    var raw = el.getAttribute('data-hb-anim'), a;
    try { a = raw.charAt(0) === '{' ? JSON.parse(raw) : { effect: raw }; } catch (e) { a = { effect: 'fade' }; }
    a.effect = a.effect || 'fade-up'; a.trigger = a.effect === 'parallax' ? 'scroll' : a.trigger || 'in-view';
    a.duration = a.duration || 600; a.delay = a.delay || 0; a.distance = a.distance == null ? 32 : a.distance; a.once = a.once !== false;
    return a;
  }
  function kids(el) {
    var marked = el.querySelectorAll('[data-hb-item]');
    if (marked.length) return Array.prototype.slice.call(marked);
    return Array.prototype.filter.call(el.querySelectorAll('[data-hb-uid]'), function (c) { return c.parentElement.closest('[data-hb-uid]') === el; });
  }
  function run(M, els) {
    Array.prototype.forEach.call(els, function (el) {
      var a = read(el), f = frames(a);
      var targets = a.stagger > 0 ? kids(el) : [el];
      if (!targets.length) targets = [el];
      var opts = { duration: a.duration / 1000, delay: a.stagger > 0 ? M.stagger(a.stagger / 1000, { startDelay: a.delay / 1000 }) : a.delay / 1000 };
      if (a.easing === 'spring') { opts.type = 'spring'; opts.bounce = 0.25; } else opts.ease = EASE[a.easing] || EASE['ease-out'];
      var first = {}; for (var k in f) first[k] = f[k][0];
      if (targets[0] !== el) { M.animate(targets, first, { duration: 0 }); el.style.opacity = 1; }
      if (a.trigger === 'scroll') {
        M.scroll(M.animate(targets, f, { ease: 'linear' }), { target: el, offset: a.effect === 'parallax' ? ['start end', 'end start'] : ['start end', 'center center'] });
      } else if (a.trigger === 'load') {
        M.animate(targets, f, opts);
      } else {
        var stop = M.inView(el, function () {
          M.animate(targets, f, opts);
          if (a.once) { if (stop) stop(); return; }
          return function () { M.animate(targets, first, { duration: 0 }); };
        }, { amount: 0.15 });
      }
    });
  }
  d.addEventListener('DOMContentLoaded', function () {
    var els = d.querySelectorAll('[data-hb-anim]');
    if (!els.length) { clearTimeout(timer); show(); return; }
    var s = d.createElement('script');
    s.src = src;
    s.onload = function () { clearTimeout(timer); try { run(window.Motion, els); } catch (e) { show(); } };
    s.onerror = function () { clearTimeout(timer); show(); };
    d.head.appendChild(s);
  });
})();`

export async function sha256Base64(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  let bin = ''
  for (const byte of new Uint8Array(digest)) bin += String.fromCharCode(byte)
  return btoa(bin)
}

/** A hosted page's policy: our runtime and Motion are the only scripts, forms post only to HelpBites, frames only video players. */
export async function pageCsp(host: string): Promise<string> {
  return [
    "default-src 'none'",
    'img-src http: https: data:',
    'media-src http: https: data:',
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    `script-src 'sha256-${await sha256Base64(PAGE_RUNTIME)}' ${host}${MOTION_PATH}`,
    'frame-src https://www.youtube-nocookie.com https://player.vimeo.com',
    "form-action 'self'",
    "base-uri 'none'",
    'frame-ancestors *'
  ].join('; ')
}

/** The body's HTML and the CSS it needs (the theme, then each component's own CSS, once). */
export function renderBlocks(content: CmsBlock, style: CmsStyle, accent: string, ctx: RenderContext): { html: string, css: string } {
  const walk: Walk = { ...ctx, used: new Set() }
  const html = renderBlock(content, walk)
  const own = [...walk.used].map(key => ctx.library.get(key)!).filter(def => def.css).map(def => `/* ${def.key} */\n${def.css}`)
  return { html, css: [themeCss(style, accent), BASE_CSS, ...own].join('\n') }
}

export type PageInput = {
  name: string
  content: CmsBlock
  style: CmsStyle
  /** The project's accent, for a page that leaves its own empty. */
  projectAccent: string
  projectName?: string
  /** The canonical URL, for og:url. */
  url?: string
  /** HTML for the "Powered by" badge, when the plan shows one. */
  poweredBy?: string
  /** Add the page runtime (hosted pages; the editor preview only while playing animations). */
  runtime?: boolean
  /** Extra markup at the end of <head> (the editor preview's own script). */
  head?: string
}

/** A whole page: meta from the root's `title`, `description` and `ogImage` fields, fonts, styles, body, runtime. */
export function renderPage(input: PageInput, ctx: RenderContext): string {
  const style = { ...DEFAULT_STYLE, ...input.style }
  const accent = style.accent || input.projectAccent || DEFAULT_ACCENT
  const { html, css } = renderBlocks(input.content, style, accent, ctx)
  const root = input.content
  const title = typeof root.title === 'string' && root.title.trim() ? root.title.trim() : input.name
  const description = typeof root.description === 'string' ? root.description.trim() : ''
  const og = normalizeAsset(root.ogImage)
  const meta = [
    `<title>${esc(title)}</title>`,
    description ? `<meta name="description" content="${esc(description)}">` : '',
    `<meta property="og:title" content="${esc(title)}">`,
    description ? `<meta property="og:description" content="${esc(description)}">` : '',
    input.projectName ? `<meta property="og:site_name" content="${esc(input.projectName)}">` : '',
    input.url ? `<meta property="og:url" content="${esc(input.url)}"><link rel="canonical" href="${esc(input.url)}">` : '',
    og ? `<meta property="og:image" content="${esc(og.url)}"><meta name="twitter:card" content="summary_large_image">` : ''
  ].filter(Boolean).join('\n')
  const runtime = input.runtime ? `<script data-motion="${esc(ctx.host + MOTION_PATH)}">${PAGE_RUNTIME}</script>` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${meta}
${runtime}
${fontLink(style)}
<style>${css.replace(/<\/style/gi, '<\\/style')}</style>
${input.head || ''}
</head>
<body>
${html}
${input.poweredBy || ''}
</body>
</html>`
}
