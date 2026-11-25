import { deflateSync } from 'node:zlib'
import { pinnedFetch } from './outbound'
import { detectImageMime, storeAttachment } from './s3'

// The site's favicon as the project's icon (`useFavicon`). Fetched once when the setting turns on or Site URL changes, through
// pinnedFetch (no private or metadata addresses, a timeout, a size cap), and stored like any project image, so every client
// loads it from HelpBites' own bucket. Only raster images: an SVG icon is skipped, and an .ico is used through its PNG or 32-bit bitmap entry.
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

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  let crc = 0xFFFFFFFF
  for (const byte of body) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8)
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0, body.length + 4)
  return out
}

/**
 * A 32-bit bitmap entry of an .ico (what most favicon.ico files hold: 16, 32 and 48 px BMPs) as a PNG; null for any other depth.
 * ponytail: 32-bit only (alpha is in the pixels); 1/4/8/24-bit palettes and AND masks are old-Windows icons, add if one turns up.
 */
function pngFromDib(dib: Buffer): Buffer | null {
  if (dib.length < 40 || dib.readUInt32LE(0) !== 40 || dib.readUInt16LE(14) !== 32 || dib.readUInt32LE(16) !== 0) return null
  const width = dib.readInt32LE(4)
  const height = Math.abs(dib.readInt32LE(8)) / 2 // the stored height counts the AND mask too
  if (width < 1 || width > 256 || height < 1 || height > 256 || dib.length < 40 + width * height * 4) return null
  const rows: Buffer[] = []
  for (let y = height - 1; y >= 0; y--) { // bitmaps are stored bottom-up, BGRA
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x++) {
      const at = 40 + (y * width + x) * 4
      row[1 + x * 4] = dib[at + 2]!
      row[2 + x * 4] = dib[at + 1]!
      row[3 + x * 4] = dib[at]!
      row[4 + x * 4] = dib[at + 3]!
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

/** The largest image inside an .ico file as a PNG: a PNG entry as it is, a 32-bit bitmap entry converted; null when it holds neither. */
export function pngFromIco(data: Buffer): Buffer | null {
  if (data.length < 6 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) return null
  let best: Buffer | null = null
  let bestWidth = -1
  for (let i = 0; i < data.readUInt16LE(4); i++) {
    const at = 6 + i * 16
    if (at + 16 > data.length) break
    const width = data[at] || 256
    if (width <= bestWidth) continue
    const image = data.subarray(data.readUInt32LE(at + 12), data.readUInt32LE(at + 12) + data.readUInt32LE(at + 8))
    const png = detectImageMime(image) === 'image/png' ? image : pngFromDib(image)
    if (png) { best = png; bestWidth = width }
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
