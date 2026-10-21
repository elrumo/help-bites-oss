import { poweredByHtml, type PoweredBy } from './branding'
import { escapeHtml } from './messageEmail'

// The few public pages marketing email links to — preferences, confirm,
// sign-up, lead forms — as plain server-rendered HTML: no JavaScript, no sign-in, they
// work in any mail client's browser and survive link scanners (a GET never
// changes anything; every change is a form POST).

/** `poweredBy` is poweredByFor(project), awaited by the caller because these pages render synchronously. */
export type PageBrand = { name: string, logoUrl: string, accent: string, poweredBy?: PoweredBy | null }

export function pageBrand(project: { get: (key: string) => unknown }, poweredBy: PoweredBy | null = null): PageBrand {
  const theme = (project.get('theme') || {}) as { accent?: string }
  return {
    name: String(project.get('name') || 'Newsletter'),
    logoUrl: String(project.get('brandLogoUrl') || project.get('iconUrl') || ''),
    accent: /^#[0-9a-f]{6}$/i.test(String(theme.accent || '')) ? String(theme.accent) : '#4f46e5',
    poweredBy
  }
}

/** A whole page around `body` (already-escaped HTML). */
export function renderMarketingPage(brand: PageBrand, title: string, body: string): string {
  const logo = /^https?:\/\//.test(brand.logoUrl) ? `<img src="${escapeHtml(brand.logoUrl)}" alt="" width="40" height="40">` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · ${escapeHtml(brand.name)}</title>
<style>
:root { --accent: ${brand.accent}; --bg: #f6f6f7; --card: #fff; --text: #18181b; --muted: #6b6b76; --line: #e4e4e7; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #111113; --card: #1a1a1d; --text: #ededf0; --muted: #a0a0ab; --line: #2c2c31; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; align-content: center; padding: 24px 16px; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
main { width: 100%; max-width: 440px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; font-weight: 600; }
header img { border-radius: 10px; object-fit: cover; }
h1 { font-size: 20px; line-height: 1.3; margin: 0 0 8px; }
p { margin: 0 0 16px; color: var(--muted); }
form { margin: 0; }
fieldset { border: 1px solid var(--line); border-radius: 10px; padding: 4px 14px; margin: 0 0 16px; }
label { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; cursor: pointer; }
label + label { border-top: 1px solid var(--line); }
label small { display: block; color: var(--muted); font-size: 13px; }
input[type=checkbox] { margin-top: 4px; accent-color: var(--accent); width: 16px; height: 16px; }
input[type=email], input[type=text], input[type=number], input[type=url], input[type=tel], select, textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; margin-bottom: 12px; }
textarea { resize: vertical; }
label.field { display: block; padding: 0; cursor: auto; }
label.field + label.field, label.field + label.check, label.check + label.field { border-top: 0; }
label.field > span { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
label.field small { display: inline; }
label.check { padding: 0 0 12px; }
p.small { font-size: 13px; margin: 16px 0 0; }
button { width: 100%; padding: 11px 16px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
button.quiet { background: transparent; color: var(--muted); border: 1px solid var(--line); font-weight: 500; margin-top: 10px; }
.note { padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--text); margin-bottom: 16px; }
.hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
</style>
</head>
<body>
<main>
<header>${logo}<span>${escapeHtml(brand.name)}</span></header>
${body}
</main>
${poweredByHtml(brand.poweredBy)}
</body>
</html>`
}

export function messagePage(brand: PageBrand, title: string, message: string): string {
  return renderMarketingPage(brand, title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`)
}

/** For a link that is broken or forged: no project to brand it with. */
export function invalidLinkPage(): string {
  return messagePage({ name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }, 'This link does not work', 'It may be incomplete or out of date. Use the link in the most recent email you got from us.')
}
