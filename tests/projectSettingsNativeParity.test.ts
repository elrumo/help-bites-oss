import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The native project settings are a list of pages with a search over their settings, and the tab bar has
// shortcuts of its own. Both hand-write names that the string catalog must translate, and the search
// scrolls to anchors the screen must carry.

const native = (path: string) => readFileSync(join(import.meta.dir, '../helpbites-native/App', path), 'utf8')
const index = native('Features/Projects/ProjectSettingsIndex.swift')
const screen = native('Features/Projects/ProjectSettingsScreen.swift')
const shortcuts = native('Shell/TabShortcuts.swift')
const catalog = JSON.parse(native('Localizable.xcstrings')).strings as Record<string, { localizations?: Record<string, { stringUnit?: { value?: string } }> }>
const LOCALES = ['ca', 'es', 'ja', 'ko', 'zh-Hans']

/** Every first capture group of `pattern` in `source`. */
const found = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].map(match => match[1]!)

function expectTranslated(keys: string[]) {
  for (const key of keys) {
    expect(catalog[key], `"${key}" is not in Localizable.xcstrings`).toBeDefined()
    for (const locale of LOCALES) expect(catalog[key]!.localizations?.[locale]?.stringUnit?.value, `"${key}" has no ${locale} translation`).toBeTruthy()
  }
}

test('the settings pages and their groups are translated', () => {
  // `case .general: "General"`: titles start with a capital, symbols and tints do not.
  const titles = found(index, /case \.\w+: "([A-Z][^"]*)"/g)
  expect(titles.length).toBeGreaterThanOrEqual(16)
  expectTranslated(titles)
})

test('what the settings search lists is translated', () => {
  const names = found(index, /String\(localized: "([^"]+)"\)/g)
  expect(names.length).toBeGreaterThanOrEqual(15)
  expectTranslated(names)
})

test('every setting the search scrolls to has its anchor on the screen', () => {
  const anchored = found(index, /entry\("([a-z]+\.[a-z]+)"/g)
  expect(anchored.length).toBeGreaterThanOrEqual(10)
  for (const id of anchored) expect(screen, `.id("${id}") is missing from ProjectSettingsScreen.swift`).toContain(`.id("${id}")`)
})

test('search entry ids are unique', () => {
  const ids = found(index, /entry\("([^"]+)"/g)
  expect(new Set(ids).size).toBe(ids.length)
})

test('the tab bar shortcut names are translated', () => {
  const labels = found(shortcuts, /case \.\w+: "([A-Z][^"]*)"/g)
  expect(labels.length).toBe(7)
  expectTranslated(labels)
})
