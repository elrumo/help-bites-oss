import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_BRAND_CONFIG, brandAccent, googleFontsCssUrl, normalizeBrandConfig, readableOn, validateBrandConfig } from '../shared/brand'
import { detectBrandMime, guessAssetKind, imageSize, svgIsActive, type BrandAssetView } from '../server/utils/brand'
import { resolveStyle } from '../shared/projectStyle'
import { BRAND_PAGE_CSP, renderBrandPage, type BrandPageData } from '../server/utils/brandPage'

// tests/branding.test.ts is the "Powered by HelpBites" badge; this is the brand kit.

describe('brand kit config', () => {
  test('lists replace, the page merges, and bad values are reported, not applied', () => {
    const base = validateBrandConfig({ tagline: 'Old', colors: [{ name: 'Ink', hex: '#111111' }], page: { template: 'split' } }).config
    const { config, errors } = validateBrandConfig({ colors: [{ name: 'Sky', hex: '#0EA5E9' }], page: { theme: 'dark' } }, base)
    expect(errors).toEqual([])
    expect(config.tagline).toBe('Old')
    expect(config.colors).toEqual([{ name: 'Sky', hex: '#0ea5e9', usage: '' }])
    expect(config.page.template).toBe('split')
    expect(config.page.theme).toBe('dark')

    const bad = validateBrandConfig({ colors: [{ hex: 'blue' }], page: { template: 'gallery', sections: ['colors', 'nope'] } }, base)
    expect(bad.errors).toHaveLength(3)
    expect(bad.config.colors).toEqual(base.colors)
    expect(bad.config.page.template).toBe('split')
  })

  test('fonts only load from Google Fonts; other links are refused', () => {
    expect(googleFontsCssUrl('https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600')).toContain('fonts.googleapis.com/css2')
    expect(googleFontsCssUrl('https://evil.test/css2?family=x')).toBe('')
    expect(googleFontsCssUrl('http://fonts.googleapis.com/css2?family=x')).toBe('')
    const { errors } = validateBrandConfig({ fonts: [{ name: 'Inter', cssUrl: 'https://evil.test/font.css' }] })
    expect(errors[0]).toContain('cssUrl')
  })

  test('the accent falls back from the page to the first colour to the project', () => {
    expect(brandAccent(DEFAULT_BRAND_CONFIG, '#AA0000')).toBe('#aa0000')
    expect(brandAccent(normalizeBrandConfig({ colors: [{ name: 'a', hex: '#00ff00' }] }), '#aa0000')).toBe('#00ff00')
    expect(brandAccent(normalizeBrandConfig({ colors: [{ name: 'a', hex: '#00ff00' }], page: { accent: '#0000ff' } }))).toBe('#0000ff')
    expect(readableOn('#ffffff')).toBe('#000000')
    expect(readableOn('#14213d')).toBe('#ffffff')
  })
})

describe('brand kit files', () => {
  const png = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(png)
  png.writeUInt32BE(1290, 16)
  png.writeUInt32BE(2796, 20)

  test('types come from the bytes, not the name', () => {
    expect(detectBrandMime(png)).toBe('image/png')
    expect(detectBrandMime(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml')
    expect(detectBrandMime(Buffer.from([0, 0, 1, 0, 1, 0, 32, 32]))).toBe('image/x-icon')
    expect(detectBrandMime(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf')
    expect(detectBrandMime(Buffer.from('<html><svg></svg></html>'))).toBe('')
    expect(detectBrandMime(Buffer.from('MZ\x90\x00'))).toBe('')
  })

  test('SVGs that could run anything are refused', () => {
    expect(svgIsActive(Buffer.from('<svg><path d="M0 0"/></svg>'))).toBe(false)
    for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><a href="javascript:x()"/></svg>', '<svg><foreignObject/></svg>']) {
      expect(svgIsActive(Buffer.from(bad))).toBe(true)
    }
  })

  test('sizes are read from image headers', () => {
    expect(imageSize(png, 'image/png')).toEqual({ width: 1290, height: 2796 })
    const gif = Buffer.from('GIF89a\x40\x00\x20\x00', 'latin1')
    expect(imageSize(gif, 'image/gif')).toEqual({ width: 64, height: 32 })
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0xF4, 0x03, 0x20, 0x03])
    expect(imageSize(jpeg, 'image/jpeg')).toEqual({ width: 800, height: 500 })
    const webp = Buffer.alloc(30)
    webp.write('RIFF', 0, 'ascii')
    webp.write('WEBPVP8X', 8, 'ascii')
    webp.writeUIntLE(1023, 24, 3)
    webp.writeUIntLE(511, 27, 3)
    expect(imageSize(webp, 'image/webp')).toEqual({ width: 1024, height: 512 })
    expect(imageSize(Buffer.from('<svg viewBox="0 0 120 40"></svg>'), 'image/svg+xml')).toEqual({ width: 120, height: 40 })
    expect(imageSize(Buffer.from('<svg width="24px" height="24"></svg>'), 'image/svg+xml')).toEqual({ width: 24, height: 24 })
    expect(imageSize(Buffer.from('nope'), 'image/png')).toBeNull()
  })

  test('unlabelled files get a sensible kind', () => {
    expect(guessAssetKind('image/png', { width: 1290, height: 2796 })).toBe('screenshot')
    expect(guessAssetKind('image/png', { width: 1024, height: 1024 })).toBe('icon')
    expect(guessAssetKind('image/png', { width: 32, height: 32 })).toBe('favicon')
    expect(guessAssetKind('image/png', { width: 1200, height: 630 })).toBe('social')
    expect(guessAssetKind('image/svg+xml', { width: 120, height: 40 })).toBe('logo')
    expect(guessAssetKind('application/pdf', null)).toBe('other')
  })
})

describe('brand page', () => {
  const asset = (over: Partial<BrandAssetView>): BrandAssetView => ({ id: 'a1', kind: 'logo', name: 'Wordmark', description: '', url: 'https://cdn.test/w.svg', downloadUrl: '/brand/pk_x/files/a1', mime: 'image/svg+xml', size: 2048, width: 120, height: 40, background: 'dark', public: true, order: 0, createdAt: null, ...over })
  const data = (over: Partial<BrandPageData> = {}): BrandPageData => {
    const config = normalizeBrandConfig({ tagline: 'Orders, <sorted>.', colors: [{ name: 'Ink', hex: '#14213d' }], fonts: [{ name: 'Fraunces"; }', role: 'display', cssUrl: 'https://fonts.googleapis.com/css2?family=Fraunces' }], guidelines: [{ title: 'Space', body: 'Keep **room**.' }] })
    return { name: 'Acme <b>', iconUrl: '', tagline: config.tagline, about: '', accent: '#14213d', style: resolveStyle({ accent: '#14213d', radiusPx: 8, fontFamily: 'system-ui', logoUrl: '', logoDarkUrl: '', iconUrl: '' }), config, guidelines: [{ id: 'g', title: 'Space', html: '<p>Keep <strong>room</strong>.</p>' }], assets: [asset({})], ...over }
  }

  test('every template renders the kit, escaped, in its own fonts', () => {
    for (const template of ['minimal', 'editorial', 'split'] as const) {
      const html = renderBrandPage(data(), null, { template })
      expect(html).toContain(`class="t-${template}"`)
      expect(html).toContain('Acme &lt;b&gt;')
      expect(html).toContain('Orders, &lt;sorted&gt;.')
      expect(html).not.toContain('<b>')
      expect(html).toContain('data-copy="#14213D"')
      expect(html).toContain('href="https://fonts.googleapis.com/css2?family=Fraunces"')
      // A font name cannot close the CSS string it sits in.
      expect(html).toContain('"Fraunces", ')
      expect(html).not.toContain('Fraunces";')
      expect(html).toContain('href="/brand/pk_x/files/a1" download')
    }
  })

  test('sections follow the chosen order, empty ones are left out, and embeds drop the top bar', () => {
    const html = renderBrandPage(data(), null, { sections: ['guidelines', 'colors'] })
    expect(html.indexOf('id="guidelines"')).toBeLessThan(html.indexOf('id="colours"'))
    expect(html).not.toContain('id="logos"')
    expect(html).not.toContain('id="screenshots"')
    expect(renderBrandPage(data(), null, { embed: true })).not.toContain('class="bar"')
    expect(renderBrandPage(data({ assets: [], config: normalizeBrandConfig({}), guidelines: [] }), null)).toContain('Nothing has been added')
  })

  test('the CSP allows exactly the one inline script', () => {
    const html = renderBrandPage(data(), null)
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!
    expect(BRAND_PAGE_CSP).toContain(`'sha256-${createHash('sha256').update(script).digest('base64')}'`)
    expect(html.match(/<script/g)).toHaveLength(1)
  })

  test('the embed script is MIT and parses', () => {
    const source = readFileSync(join(import.meta.dir, '../public/brand.js'), 'utf8')
    expect(source.startsWith('/* SPDX-License-Identifier: MIT')).toBe(true)
    expect(() => new Function(source)).not.toThrow()
  })
})
