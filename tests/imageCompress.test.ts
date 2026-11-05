import { describe, expect, test } from 'bun:test'
import { deflateSync } from 'node:zlib'
import { COMPRESS_MAX_EDGE, compressImage, imageVariants, isTruthy, parseFormats } from '../server/utils/imageCompress'
import { pictureHtml } from '../server/utils/s3'
import { blogEmailHtml, renderBlogBody } from '../server/utils/blogRender'

// A truecolor PNG of a gradient with sensor-like noise (so lossless is large and lossy is small), built by hand.
function png(width: number, height: number): Buffer {
  const row = width * 3
  const raw = Buffer.alloc((row + 1) * height)
  let seed = 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < row; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
      raw[y * (row + 1) + 1 + x] = ((x / 3 + y) / 4 + (seed >> 16) % 24) & 255
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(Bun.hash.crc32(body) >>> 0, body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

describe('compressed uploads', () => {
  test('a large PNG becomes a smaller WebP no wider than the limit', async () => {
    const source = png(3200, 400)
    const out = await compressImage(source, 'image/png')
    expect(out.compressed).toBe(true)
    expect(out.mime).toBe('image/webp')
    expect(out.data.length).toBeLessThan(source.length)
    expect(out.data.subarray(0, 4).toString()).toBe('RIFF')
    expect((await new Bun.Image(out.data).metadata()).width).toBe(COMPRESS_MAX_EDGE)
  })

  test('what cannot be made smaller is stored as sent: a GIF, a file the codec cannot read', async () => {
    const gif = Buffer.from('GIF89a-not-really-animated')
    expect((await compressImage(gif, 'image/gif')).data).toBe(gif)
    const junk = Buffer.from('this is not an image at all')
    const out = await compressImage(junk, 'image/png')
    expect(out).toEqual({ data: junk, mime: 'image/png', compressed: false })
  })

  test('a form value says yes with true, 1, yes or on', () => {
    for (const yes of ['true', '1', 'YES', ' on ']) expect(isTruthy(yes)).toBe(true)
    for (const no of ['false', '0', '', undefined, null]) expect(isTruthy(no)).toBe(false)
  })

  test('formats: AVIF (where the runtime encodes it) and WebP come first, smaller than the PNG fallback that ends the set', async () => {
    const source = png(1200, 300)
    // Bun's Linux builds have no AV1 encoder; macOS has one.
    const avif = await new Bun.Image(source).avif({ quality: 55 }).toBuffer().then(() => true, () => false)
    const set = await imageVariants(source, 'image/png', ['webp', 'avif'])
    const formats = avif ? ['avif', 'webp', 'png'] : ['webp', 'png']
    expect(set?.map(v => v.format)).toEqual(formats)
    expect(set?.map(v => v.mime)).toEqual(formats.map(f => `image/${f}`))
    const fallback = set!.at(-1)!.data.length
    for (const v of set!.slice(0, -1)) expect(v.data.length).toBeLessThan(fallback)
    expect(fallback).toBeLessThanOrEqual(source.length)
  })

  test('formats: one the runtime cannot encode is left out, the rest of the set is kept', async () => {
    const Real = Bun.Image
    Bun.Image = class extends Real {
      resize(...args: Parameters<InstanceType<typeof Real>['resize']>) {
        const pipeline = super.resize(...args)
        pipeline.avif = () => { throw new Error('Image: format not supported on this machine') }
        return pipeline
      }
    } as typeof Real
    try {
      const set = await imageVariants(png(1200, 300), 'image/png', ['avif', 'webp'])
      expect(set?.map(v => v.format)).toEqual(['webp', 'png'])
      expect(await imageVariants(png(1200, 300), 'image/png', ['avif'])).toEqual([expect.objectContaining({ format: 'png' })])
    } finally {
      Bun.Image = Real
    }
  })

  test('formats: a GIF, an unreadable file or no format asked for is stored as sent', async () => {
    expect(await imageVariants(Buffer.from('GIF89a'), 'image/gif', ['avif'])).toBeNull()
    expect(await imageVariants(Buffer.from('not an image'), 'image/png', ['avif'])).toBeNull()
    expect(await imageVariants(png(40, 40), 'image/png', [])).toBeNull()
  })

  test('formats are read from a list, in any case, ignoring what is not a modern format', () => {
    expect(parseFormats('AVIF, webp')).toEqual(['avif', 'webp'])
    expect(parseFormats('jpeg,gif')).toEqual([])
    expect(parseFormats(undefined)).toEqual([])
  })

  test('a <picture> lists the modern files as sources and ends on the fallback image', () => {
    const html = pictureHtml([{ mime: 'image/avif', url: 'https://f.test/a.avif' }, { mime: 'image/webp', url: 'https://f.test/a.webp' }, { mime: 'image/png', url: 'https://f.test/a.png' }], 'A "chart"')
    expect(html).toBe('<picture><source type="image/avif" srcset="https://f.test/a.avif"><source type="image/webp" srcset="https://f.test/a.webp"><img src="https://f.test/a.png" alt="A &quot;chart&quot;" loading="lazy"></picture>')
  })

  test('a post keeps its <picture> on the blog and sends only the fallback image in mail', () => {
    const picture = pictureHtml([{ mime: 'image/avif', url: 'https://f.test/a.avif' }, { mime: 'image/png', url: 'https://f.test/a.png' }], 'Chart')
    const html = renderBlogBody(`Before\n\n${picture}\n\nAfter`, 'markdown')
    expect(html).toContain('<source type="image/avif" srcset="https://f.test/a.avif">')
    expect(html).toContain('src="https://f.test/a.png"')
    const mail = blogEmailHtml(html, '#4f46e5')
    expect(mail).toContain('src="https://f.test/a.png"')
    expect(mail).not.toContain('<source')
    expect(mail).not.toContain('<picture')
  })
})
