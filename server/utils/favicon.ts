import { pinnedFetch } from './outbound'
import { detectImageMime, storeAttachment } from './s3'

// The site's favicon as the project's icon (`useFavicon`). Fetched once when the setting turns on or Site URL changes, through
// pinnedFetch (no private or metadata addresses, a timeout, a size cap), and stored like any project image, so every client
// loads it from HelpBites' own bucket. Only raster images: an SVG icon is skipped, and an .ico is used when it holds a PNG.
// ponytail: an old favicon file stays in the bucket after a refetch; deleting it is the upgrade if storage ever matters.

const PAGE_MAX_BYTES = 1024 * 1024
const ICON_MAX_BYTES = 512 * 1024
const ICON_TRIES = 4

type Attributes = Record<string, string>

/** The attributes of one tag, names lowercased; the first of a repeated name wins, as in a browser. */
function attributesOf(tag: string): Attributes {
  const out: Attributes = {}
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    const name = match[1]!.toLowerCase()
    if (!(name in out)) out[name] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return out
}

/**
 * The icons a page offers, best first: apple-touch-icon (usually the largest), then the `icon` links largest first, then
 * /favicon.ico, which browsers request whether or not the page names it. Every address is absolute, and `<base href>` counts.
 */
export function iconCandidates(html: string, pageUrl: string): string[] {
  const base = html.match(/<base\b[^>]*>/i)
  let root = pageUrl
  const baseHref = base ? attributesOf(base[0]).href : ''
  if (baseHref) { try { root = new URL(baseHref, pageUrl).href } catch { /* a broken base is ignored */ } }
  const touch: string[] = []
  const icons: { href: string, size: number }[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attrs = attributesOf(tag)
    if (!attrs.href) continue
    let href: string
    try { href = new URL(attrs.href, root).href } catch { continue }
    const rel = (attrs.rel || '').toLowerCase().split(/\s+/)
    if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) touch.push(href)
    else if (rel.includes('icon')) {
      const size = Math.max(0, ...(attrs.sizes || '').split(/\s+/).map(s => Number.parseInt(s, 10)).filter(Number.isFinite))
      icons.push({ href, size })
    }
  }
  const favicon = new URL('/favicon.ico', pageUrl).href
  const ordered = [...touch, ...icons.sort((a, b) => b.size - a.size).map(icon => icon.href), favicon]
  return [...new Set(ordered)]
}

/** The largest PNG inside an .ico file (Windows Vista and later keep PNGs whole); null when it holds only bitmaps. */
export function pngFromIco(data: Buffer): Buffer | null {
  if (data.length < 6 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) return null
  let best: Buffer | null = null
  let bestWidth = -1
  for (let i = 0; i < data.readUInt16LE(4); i++) {
    const at = 6 + i * 16
    if (at + 16 > data.length) break
    const width = data[at] || 256
    const image = data.subarray(data.readUInt32LE(at + 12), data.readUInt32LE(at + 12) + data.readUInt32LE(at + 8))
    if (width > bestWidth && detectImageMime(image) === 'image/png') { best = image; bestWidth = width }
  }
  return best
}

/** GET a public address, following up to three redirects by hand (safeFetch refuses them); null when it does not answer with the bytes. */
async function getPublic(start: string, accept: string, maxBytes: number, timeoutMs: number): Promise<{ url: URL, body: Buffer } | null> {
  let url = new URL(start)
  for (let hop = 0; hop <= 3; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const response = await pinnedFetch(url, { timeoutMs, maxBytes, headers: { accept, 'user-agent': 'HelpBites favicon fetch' } })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      void response.body?.cancel().catch(() => {})
      url = new URL(location, url)
      continue
    }
    if (!response.ok) return null
    return { url, body: Buffer.from(await response.arrayBuffer()) }
  }
  return null
}

/** The first usable raster icon of a site, as bytes; null when the site cannot be reached or has none. Never throws. */
async function siteIcon(siteUrl: string): Promise<Buffer | null> {
  try {
    const page = await getPublic(siteUrl, 'text/html', PAGE_MAX_BYTES, 5000).catch(() => null)
    const candidates = iconCandidates(page?.body.toString('utf8') || '', page?.url.href || siteUrl)
    for (const href of candidates.slice(0, ICON_TRIES)) {
      const icon = await getPublic(href, 'image/*', ICON_MAX_BYTES, 4000).catch(() => null)
      if (!icon) continue
      const raster = detectImageMime(icon.body) ? icon.body : pngFromIco(icon.body)
      if (raster) return raster
    }
    return null
  } catch {
    return null
  }
}

/** Fetches a site's favicon and stores it under the project; its URL, or '' when there is none. A site that cannot be reached is no icon, not an error. */
export async function fetchSiteFavicon(siteUrl: string, projectId: string): Promise<string> {
  const raster = await siteIcon(siteUrl)
  if (!raster) return ''
  // Storage full or a bad bucket is an error for the save to show, so this is outside the try above.
  return (await storeAttachment(raster, projectId, 'favicon')).url
}

/**
 * Keeps the project's icon in step with its site's favicon. While `useFavicon` is on, the favicon fills the icon when the icon is
 * empty or is the favicon given before; an icon the operator uploaded is never replaced. It is fetched when the setting turns on
 * or Site URL changes, not on every save. Turning it off clears only a favicon that was filling the icon.
 */
export async function syncProjectFavicon(
  project: ParseObject,
  before: { siteUrl: string, useFavicon: boolean },
  fetcher: (siteUrl: string, projectId: string) => Promise<string> = fetchSiteFavicon
): Promise<void> {
  const siteUrl = String(project.get('siteUrl') || '')
  const previous = String(project.get('faviconUrl') || '')
  const icon = String(project.get('iconUrl') || '')
  if (project.get('useFavicon') !== true) {
    if (previous && icon === previous) project.set('iconUrl', '')
    if (previous) project.set('faviconUrl', '')
    return
  }
  if (before.useFavicon && siteUrl === before.siteUrl) return
  const found = siteUrl ? await fetcher(siteUrl, project.id || '') : ''
  project.set('faviconUrl', found)
  if (!icon || icon === previous) project.set('iconUrl', found)
}
