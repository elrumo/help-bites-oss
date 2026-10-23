import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeBlogConfig, validateBlogConfig } from '../shared/blog'
import { BRAND_RADIUS_PX, normalizeBrandConfig, validateBrandConfig } from '../shared/brand'
import { normalizeLegalConfig, validateLegalConfig } from '../shared/legal/config'
import { blogStyleOf } from '../server/utils/blog'
import { brandStyleOf } from '../server/utils/brand'
import { renderBrandPage, type BrandPageData } from '../server/utils/brandPage'
import { legalLook, renderLegalIndex } from '../server/utils/legalPage'

// The blog, the legal pages and the brand page wear the project style, with their
// own accent, font, scheme and corners kept as a layer over it.

const row = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] }) as unknown as ParseObject
const custom = { source: 'custom', custom: { shadow: 'none', radius: 3, dark: { background: '#101820' } } }

describe('config style choices', () => {
  test('blog, legal and brand take a style choice, partially, and report bad values', () => {
    expect(normalizeBlogConfig({}).style).toMatchObject({ source: 'project' })
    const blog = validateBlogConfig({ style: custom })
    expect(blog.errors).toEqual([])
    expect(blog.config.style.custom).toMatchObject({ shadow: 'none', radius: 3, dark: { background: '#101820' } })
    // Only the keys sent change, and design is untouched by a style update.
    expect(validateBlogConfig({ style: { custom: { radius: 9 } } }, blog.config).config).toMatchObject({ style: { source: 'custom', custom: { shadow: 'none', radius: 9 } } })
    expect(validateBlogConfig({ style: { source: 'nope' } }).errors).toHaveLength(1)

    expect(validateLegalConfig({ style: custom }).config.style.custom.radius).toBe(3)
    expect(validateLegalConfig({ style: { custom: { radius: 99 } } }).errors).toEqual(['style.custom: radius is a whole number from 0 to 32, or null'])
    expect(normalizeLegalConfig(undefined).style.source).toBe('project')

    const brand = validateBrandConfig({ page: { style: custom, accent: '#112233' } })
    expect(brand.errors).toEqual([])
    expect(brand.config.page).toMatchObject({ accent: '#112233', style: { source: 'custom', custom: { radius: 3 } } })
    expect(validateBrandConfig({ page: { style: { source: 'x' } } }).errors).toEqual(['page.style.source is one of project, custom'])
    expect(normalizeBrandConfig(undefined).page.style.source).toBe('project')
  })
})

describe('the blog', () => {
  test('wears the project style, with its design accent, font and scheme over it', () => {
    const project = row({ name: 'Acme', style: { light: { accent: '#00aa00' }, dark: { background: '#001100' }, font: 'mono', radius: 4 } })
    const style = blogStyleOf(project, normalizeBlogConfig({}))
    expect(style).toMatchObject({ radius: 4, dark: { background: '#001100' } })
    expect(style.light.accent).toBe('#00aa00')
    // Sans (the default) follows the project's font; serif is the blog's own choice.
    expect(style.fontFamily).toContain('mono')
    const designed = blogStyleOf(project, normalizeBlogConfig({ design: { font: 'serif', accent: '#ff0000', colorScheme: 'dark' } }))
    expect(designed).toMatchObject({ scheme: 'dark', fontFamily: expect.stringContaining('serif') })
    expect(designed.light.accent).toBe('#ff0000')
    expect(designed.dark.accent).toBe('#ff0000')
  })

  test('without any style it looks as it did: the blog\'s type stack and the kit\'s corners', () => {
    const style = blogStyleOf(row({ name: 'Acme' }), normalizeBlogConfig({}))
    expect(style).toMatchObject({ scheme: 'auto', radius: 8, fontFamily: expect.stringContaining('-apple-system') })
    expect(blogStyleOf(row({}), normalizeBlogConfig({ style: custom }))).toMatchObject({ radius: 3, shadow: 'none' })
  })
})

describe('the legal pages', () => {
  test('their accent and font stay theirs over the project style', () => {
    const project = row({ name: 'Acme', style: { light: { accent: '#00aa00' }, font: 'serif' }, legal: { accent: '#7c3aed' } })
    const look = legalLook(project)
    expect(look.accent).toBe('#7c3aed')
    expect(look.style.dark.accent).toBe('#7c3aed')
    // A font left at "system" follows the style's.
    expect(look.font).toContain('serif')
    expect(legalLook(row({ name: 'Acme', legal: { font: 'mono' }, style: { font: 'serif' } })).font).toContain('mono')
  })

  test('the page carries both palettes, or the one a style fixes', () => {
    const auto = renderLegalIndex(row({ name: 'Acme', style: { light: { surface: '#fefefe' }, dark: { surface: '#202020' } } }), [], null)
    expect(auto).toContain('--card:#fefefe')
    expect(auto).toContain('@media (prefers-color-scheme:dark){:root{')
    expect(auto).toContain('--card:#202020')
    const fixed = renderLegalIndex(row({ name: 'Acme', legal: { style: { source: 'custom', custom: { scheme: 'dark' } } } }), [], null)
    expect(fixed).not.toContain('@media (prefers-color-scheme')
    expect(fixed).toContain('--bg:#0c0a09')
  })
})

describe('the brand page', () => {
  const config = (page: Record<string, unknown> = {}) => normalizeBrandConfig({ colors: [{ name: 'Ink', hex: '#14213d' }], page })
  const data = (project: ParseObject, cfg = config()): BrandPageData => {
    const style = brandStyleOf(project, cfg)
    return { name: 'Acme', iconUrl: '', tagline: '', about: '', accent: style.light.accent, style, config: cfg, guidelines: [], assets: [] }
  }

  test('its theme, radius and accent stay the page\'s over the project style', () => {
    const project = row({ name: 'Acme', style: { radius: 12, shadow: 'strong', light: { accent: '#00aa00' } } })
    // The project's corners apply while the page's radius is the default (soft)...
    expect(brandStyleOf(project, config())).toMatchObject({ radius: 12, shadow: 'strong' })
    // ...and the page's own pick wins when it is not.
    expect(brandStyleOf(project, config({ radius: 'round', theme: 'dark', accent: '#ff0000' }))).toMatchObject({ radius: BRAND_RADIUS_PX.round, scheme: 'dark', light: { accent: '#ff0000' } })
    // Without the page's own accent the project style's outranks the first colour.
    expect(brandStyleOf(project, config()).light.accent).toBe('#00aa00')
    expect(brandStyleOf(row({ name: 'Acme' }), config()).light.accent).toBe('#14213d')
  })

  test('renders both palettes, or the fixed one, and keeps the named corners as they were', () => {
    const plain = renderBrandPage(data(row({ name: 'Acme' })), null)
    expect(plain).toContain('@media (prefers-color-scheme:dark)')
    expect(plain).toContain('--r: 12px; --r-sm: 8px')
    const dark = renderBrandPage(data(row({ name: 'Acme' }), config({ theme: 'dark' })), null)
    expect(dark).not.toContain('@media (prefers-color-scheme')
    expect(dark).toContain('--bg:#0c0a09')
    // A project radius scales the corners from it.
    expect(renderBrandPage(data(row({ name: 'Acme', style: { radius: 20 } })), null)).toContain('--r: 30px; --r-sm: 20px')
  })

  test('the query lies over the finished style: theme, accent, radius (named or pixels) and shadow', () => {
    const html = renderBrandPage(data(row({ name: 'Acme' })), null, { theme: 'light', accent: '#ff0066', radius: 'sharp', shadow: 'none' })
    expect(html).toContain('--accent:#ff0066')
    expect(html).toContain('--r: 0px; --r-sm: 0px')
    expect(html).toContain('--shadow:none')
    expect(html).not.toContain('@media (prefers-color-scheme')
    expect(renderBrandPage(data(row({ name: 'Acme' })), null, { radius: '10' })).toContain('--r: 15px; --r-sm: 10px')
    // Junk is ignored.
    expect(renderBrandPage(data(row({ name: 'Acme' })), null, { radius: '99', accent: 'red', shadow: 'huge' as never })).toContain('--r: 12px; --r-sm: 8px')
  })
})

describe('the embeds', () => {
  const source = (name: string) => readFileSync(join(import.meta.dir, `../public/${name}`), 'utf8')

  test('blog.js wears the blog\'s style and takes data-shadow; brand.js passes it on', () => {
    const blog = source('blog.js')
    expect(() => new Function(blog)).not.toThrow()
    expect(blog).toContain("shadow: attr('shadow')")
    expect(blog).toContain('state.blog.style')
    expect(source('brand.js')).toContain("'shadow'")
  })
})
