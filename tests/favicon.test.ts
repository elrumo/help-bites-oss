import { inflateSync } from 'node:zlib'
import { describe, expect, test } from 'bun:test'
import { detectImageMime } from '../server/utils/s3'
import { iconCandidates, pngFromIco, syncProjectFavicon } from '../server/utils/favicon'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('not really a picture')])

/** An .ico with a 16 px bitmap entry and a 32 px PNG entry, as Windows writes them. */
function icoWithPng(): Buffer {
  const bitmap = Buffer.from('BITMAPINFOHEADER-ish bytes')
  const header = Buffer.alloc(6 + 16 * 2)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(2, 4)
  header[6] = 16; header.writeUInt32LE(bitmap.length, 14); header.writeUInt32LE(header.length, 18)
  header[22] = 32; header.writeUInt32LE(PNG.length, 30); header.writeUInt32LE(header.length + bitmap.length, 34)
  return Buffer.concat([header, bitmap, PNG])
}

function fakeProject(values: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...values }
  return { id: 'pk-project', get: (key: string) => data[key], set: (key: string, value: unknown) => { data[key] = value }, data }
}

describe('which icons a site offers', () => {
  test('apple-touch-icon first, then icon links largest first, then /favicon.ico, all absolute', () => {
    const html = `<html><head>
      <link rel="icon" href="/fav-16.png" sizes="16x16">
      <link rel="shortcut icon" href="favicon.ico">
      <link rel="icon" href="https://cdn.example.com/fav-192.png" sizes="192x192">
      <link rel="apple-touch-icon" href="touch.png">
      <link rel="mask-icon" href="mask.svg">
      <link rel="stylesheet" href="site.css">
    </head></html>`
    expect(iconCandidates(html, 'https://example.com/app/')).toEqual([
      'https://example.com/app/touch.png',
      'https://cdn.example.com/fav-192.png',
      'https://example.com/fav-16.png',
      'https://example.com/app/favicon.ico',
      'https://example.com/favicon.ico'
    ])
  })

  test('a <base href> is the root of relative links, and a page with no icons still gets /favicon.ico', () => {
    expect(iconCandidates('<base href="https://static.example.com/assets/"><link rel=icon href=i.png>', 'https://example.com/')[0]).toBe('https://static.example.com/assets/i.png')
    expect(iconCandidates('', 'https://example.com/some/page')).toEqual(['https://example.com/favicon.ico'])
  })
})

describe('an .ico file', () => {
  test('gives its PNG entry, and nothing when it holds only bitmaps or is not an .ico', () => {
    expect(pngFromIco(icoWithPng())?.equals(PNG)).toBe(true)
    expect(pngFromIco(Buffer.from('<html>not an icon</html>'))).toBeNull()
    const bitmapOnly = icoWithPng().subarray(0, 6 + 16)
    bitmapOnly.writeUInt16LE(1, 4)
    bitmapOnly.writeUInt32LE(0, 14)
    expect(pngFromIco(bitmapOnly)).toBeNull()
  })
})

describe('an .ico with a 32-bit bitmap, as favicon.ico usually is', () => {
  test('becomes a PNG with the same pixels, top row first', () => {
    // 2x1 image: a red pixel and a half-transparent blue one, stored BGRA, bottom-up, plus the 1-bit AND mask rows
    const dib = Buffer.alloc(40 + 8 + 8)
    dib.writeUInt32LE(40, 0); dib.writeInt32LE(2, 4); dib.writeInt32LE(2, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14)
    dib.set([0, 0, 255, 255, 255, 0, 0, 128], 40)
    const header = Buffer.alloc(22)
    header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header[6] = 2; header.writeUInt32LE(dib.length, 14); header.writeUInt32LE(22, 18)
    const png = pngFromIco(Buffer.concat([header, dib]))!
    expect(detectImageMime(png)).toBe('image/png')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2, 1])
    const idat = png.indexOf('IDAT')
    expect([...inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)))]).toEqual([0, 255, 0, 0, 255, 0, 0, 255, 128])
  })
})

describe('the project icon follows the site favicon', () => {
  const fetched = 'https://bucket.example.com/pk/favicon/new.png'
  const fetcher = (calls: string[]) => async (siteUrl: string) => { calls.push(siteUrl); return fetched }

  test('turning it on fills an empty icon and remembers the favicon', async () => {
    const calls: string[] = []
    const project = fakeProject({ siteUrl: 'https://webbites.io', useFavicon: true, iconUrl: '' })
    await syncProjectFavicon(project as any, { siteUrl: 'https://webbites.io', useFavicon: false }, fetcher(calls))
    expect(calls).toEqual(['https://webbites.io'])
    expect(project.data).toMatchObject({ iconUrl: fetched, faviconUrl: fetched })
  })

  test('an icon someone uploaded is kept, and turning the setting off leaves it alone', async () => {
    const project = fakeProject({ siteUrl: 'https://webbites.io', useFavicon: true, iconUrl: 'https://bucket.example.com/mine.png', faviconUrl: 'https://bucket.example.com/old.png' })
    await syncProjectFavicon(project as any, { siteUrl: 'https://webbites.io', useFavicon: false }, fetcher([]))
    expect(project.data).toMatchObject({ iconUrl: 'https://bucket.example.com/mine.png', faviconUrl: fetched })
    project.data.useFavicon = false
    await syncProjectFavicon(project as any, { siteUrl: 'https://webbites.io', useFavicon: true })
    expect(project.data).toMatchObject({ iconUrl: 'https://bucket.example.com/mine.png', faviconUrl: '' })
  })

  test('turning it off clears the favicon that was filling the icon, and fetches nothing', async () => {
    const calls: string[] = []
    const project = fakeProject({ siteUrl: 'https://webbites.io', useFavicon: false, iconUrl: 'https://bucket.example.com/old.png', faviconUrl: 'https://bucket.example.com/old.png' })
    await syncProjectFavicon(project as any, { siteUrl: 'https://webbites.io', useFavicon: true }, fetcher(calls))
    expect(calls).toEqual([])
    expect(project.data).toMatchObject({ iconUrl: '', faviconUrl: '' })
  })

  test('a save that changes nothing about the setting or the Site URL does not fetch again', async () => {
    const calls: string[] = []
    const project = fakeProject({ siteUrl: 'https://webbites.io', useFavicon: true, iconUrl: fetched, faviconUrl: fetched })
    await syncProjectFavicon(project as any, { siteUrl: 'https://webbites.io', useFavicon: true }, fetcher(calls))
    expect(calls).toEqual([])
  })

  test('changing the Site URL fetches the new site, and a site with no favicon leaves no icon behind', async () => {
    const project = fakeProject({ siteUrl: 'https://other.example.com', useFavicon: true, iconUrl: fetched, faviconUrl: fetched })
    await syncProjectFavicon(project as any, { siteUrl: 'https://webbites.io', useFavicon: true }, async () => '')
    expect(project.data).toMatchObject({ iconUrl: '', faviconUrl: '' })
  })

  test('no Site URL means no fetch', async () => {
    const calls: string[] = []
    const project = fakeProject({ siteUrl: '', useFavicon: true, iconUrl: '' })
    await syncProjectFavicon(project as any, { siteUrl: '', useFavicon: false }, fetcher(calls))
    expect(calls).toEqual([])
    expect(project.data.iconUrl).toBe('')
  })
})
