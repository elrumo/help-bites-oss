import { describe, expect, test } from 'bun:test'
import { CHANGELOG_IMAGE_WIDTHS, CHANGELOG_IMAGE_WIDTH_PERCENT, DEFAULT_CHANGELOG_CONFIG, validateChangelogConfig } from '../shared/changelog'
import { IMAGE_WIDTH_PERCENT, renderChangelog } from '../public/ssr.mjs'

describe('image width of the public changelog', () => {
  test('the default is the full column, and only full, medium and small are accepted', () => {
    expect(DEFAULT_CHANGELOG_CONFIG.imageWidth).toBe('full')
    expect(validateChangelogConfig({ imageWidth: 'medium' }).config.imageWidth).toBe('medium')
    const bad = validateChangelogConfig({ imageWidth: 'huge' })
    expect(bad.errors).toEqual(['imageWidth must be one of full, medium, small'])
    expect(bad.config.imageWidth).toBe('full')
  })

  test('the plug-and-play snapshot uses the same widths as the shared model', () => {
    expect(IMAGE_WIDTH_PERCENT).toEqual(CHANGELOG_IMAGE_WIDTH_PERCENT)
    expect(Object.keys(IMAGE_WIDTH_PERCENT)).toEqual([...CHANGELOG_IMAGE_WIDTHS])
  })

  test('the snapshot sizes its images by the project setting', () => {
    const entry = { id: 'e1', title: 'Export', tag: 'new', publishedAt: '2026-10-01T00:00:00.000Z', bodyHtml: '<p>x</p>', images: [{ url: 'https://cdn.example/a.png', name: 'a' }] }
    expect(renderChangelog({ entries: [entry], imageWidth: 'small' })).toContain('width:35%')
    expect(renderChangelog({ entries: [entry] })).toContain('width:100%')
  })
})
