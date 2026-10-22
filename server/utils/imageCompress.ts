import { getQuery, readMultipartFormData, type H3Event } from 'h3'

// Smaller uploads on request, using Bun's own image codec (the server runs on Bun), so there is no package to
// install. Two modes:
//   compress            one file: WebP at quality 80, scaled down to 2560 px when larger (`compressImage`).
//   formats=avif,webp   a set for a <picture>: each modern format asked for, and a fallback every browser,
//                       app and mail client reads (JPEG for a JPEG, PNG for anything else, so transparency
//                       and sharp edges survive) (`imageVariants`).
// Neither makes a file bigger or breaks an upload: a GIF (it may be animated), a file the codec can't read, a
// runtime without the codec, or a result that is not smaller is stored as it was sent.
export const COMPRESS_MAX_EDGE = 2560
export const COMPRESS_QUALITY = 80
const QUALITY = { avif: 55, webp: COMPRESS_QUALITY, jpeg: 82 } as const

export type ModernFormat = 'avif' | 'webp'
export type ImageFormat = ModernFormat | 'jpeg' | 'png'
export const MODERN_FORMATS: readonly ModernFormat[] = ['avif', 'webp']
export const FORMAT_MIME: Record<ImageFormat, string> = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' }

export type CompressedImage = { data: Buffer, mime: string, compressed: boolean }
export type ImageVariant = { format: ImageFormat, mime: string, data: Buffer }

type Encoder = { toBuffer: () => Promise<Uint8Array> }
type Pipeline = { avif: (o: { quality: number }) => Encoder, webp: (o: { quality: number }) => Encoder, jpeg: (o: { quality: number }) => Encoder, png: () => Encoder }
type BunImage = new (data: Buffer) => { resize: (w: number, h: number, o: { fit: string, withoutEnlargement: boolean }) => Pipeline }

const codec = () => (globalThis as { Bun?: { Image?: BunImage } }).Bun?.Image

async function encode(Image: BunImage, data: Buffer, format: ImageFormat): Promise<Buffer> {
  const pipeline = new Image(data).resize(COMPRESS_MAX_EDGE, COMPRESS_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
  const out = format === 'png' ? pipeline.png() : pipeline[format]({ quality: QUALITY[format] })
  return Buffer.from(await out.toBuffer())
}

export async function compressImage(data: Buffer, mime: string): Promise<CompressedImage> {
  const original = { data, mime, compressed: false }
  const Image = codec()
  if (!Image || mime === 'image/gif') return original
  try {
    const out = await encode(Image, data, 'webp')
    return out.length && out.length < data.length ? { data: out, mime: FORMAT_MIME.webp, compressed: true } : original
  } catch {
    return original
  }
}

/**
 * The files of a <picture>: the modern `formats` that came out smaller than the fallback, most efficient first
 * (AVIF, then WebP), then the fallback last. `null` when the image can't be processed (a GIF, an unreadable
 * file, no codec): store it as sent.
 */
export async function imageVariants(data: Buffer, mime: string, formats: readonly ModernFormat[]): Promise<ImageVariant[] | null> {
  const Image = codec()
  if (!Image || mime === 'image/gif' || !formats.length) return null
  try {
    const format: ImageFormat = mime === 'image/jpeg' ? 'jpeg' : 'png'
    const encoded = await encode(Image, data, format)
    // The fallback is the re-encoded copy when that is smaller, else the file as sent.
    const fallback: ImageVariant = encoded.length && encoded.length < data.length ? { format, mime: FORMAT_MIME[format], data: encoded } : { format, mime, data }
    const modern: ImageVariant[] = []
    for (const f of MODERN_FORMATS.filter(f => formats.includes(f))) {
      const out = await encode(Image, data, f)
      if (out.length && out.length < fallback.data.length) modern.push({ format: f, mime: FORMAT_MIME[f], data: out })
    }
    return [...modern, fallback]
  } catch {
    return null
  }
}

const TRUE = new Set(['1', 'true', 'yes', 'on'])
/** A form value that says yes: true, 1, yes or on. */
export const isTruthy = (value: unknown) => TRUE.has(String(value ?? '').trim().toLowerCase())

/** `avif,webp` (any order, any case, junk ignored) as the modern formats it names. */
export function parseFormats(value: unknown): ModernFormat[] {
  const names = String(value ?? '').toLowerCase().split(/[\s,]+/)
  return MODERN_FORMATS.filter(f => names.includes(f))
}

/** An upload option from `?name=` or the multipart field `name` (the query wins). */
async function uploadOption(event: H3Event, name: string): Promise<string | undefined> {
  const query = getQuery(event)[name]
  if (query !== undefined) return String(query)
  const parts = await readMultipartFormData(event).catch(() => undefined)
  return parts?.find(part => part.name === name && !part.filename)?.data?.toString('utf8')
}

/** Whether an upload asks for compression. Off by default. */
export const wantsCompression = async (event: H3Event) => isTruthy(await uploadOption(event, 'compress'))

/** The modern formats an upload asks for (`formats=avif,webp`); asking for any implies compression. */
export const requestedFormats = async (event: H3Event) => parseFormats(await uploadOption(event, 'formats'))
