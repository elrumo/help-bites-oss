import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANGELOG_URL, RELEASE_STAGE } from '../shared/version'

// One release number: package.json is the source; the native app (project.yml
// MARKETING_VERSION), the newest CHANGELOG.md heading and the docs agree with it.

const root = join(import.meta.dir, '..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const { version } = JSON.parse(read('package.json'))

describe('release version', () => {
  test('is a semver', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('the native app carries the same number and shows the beta tag', () => {
    expect(read('helpbites-native/project.yml')).toContain(`MARKETING_VERSION: ${version}\n`)
    // The generated Xcode project holds the number too (run `xcodegen generate` after a bump).
    expect(read('helpbites-native/HelpBitesNative.xcodeproj/project.pbxproj')).toContain(`MARKETING_VERSION = ${version};`)
    for (const plist of ['App/Info.plist', 'HelpBitesShare/Info.plist']) {
      expect(read(`helpbites-native/${plist}`)).toContain('$(MARKETING_VERSION)')
    }
    expect(read('helpbites-native/App/Features/Settings/SettingsScreen.swift').includes('· Beta')).toBe(RELEASE_STAGE === 'beta')
  })

  test('the newest CHANGELOG.md section is Unreleased or this version', () => {
    const newest = /^## (.+)$/m.exec(read('CHANGELOG.md'))![1]!
    expect(newest === 'Unreleased' || newest.startsWith(version)).toBe(true)
  })

  test('the release notes link is a public changelog page', () => {
    expect(CHANGELOG_URL).toMatch(/^https:\/\/[^/]+\/changelog\/pk_[0-9a-f]+$/)
  })
})
