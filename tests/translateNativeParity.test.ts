import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMMON_LOCALES, normalizeLocale } from '../shared/locales'
import { ONBOARDING_MAX_LOCALES } from '../shared/onboarding'
import { TRANSLATE_LIMITS } from '../shared/translate'

// ContentLocale.swift hand-ports these constants; this keeps the copies in step.

const root = join(import.meta.dir, '..')
const swift = readFileSync(join(root, 'helpbites-native/App/Core/ContentLocale.swift'), 'utf8')
// server/utils/emails.ts needs the server's auto-imports, so its limit is read from the source.
const EMAIL_MAX_TRANSLATIONS = Number(/export const EMAIL_MAX_TRANSLATIONS = (\d+)/.exec(readFileSync(join(root, 'server/utils/emails.ts'), 'utf8'))?.[1])
const swiftNumber = (name: string) => Number(new RegExp(`static let ${name} = (\\d+)`).exec(swift)?.[1])

describe('native content-language parity', () => {
  test('ContentLocale.common lists COMMON_LOCALES, in order', () => {
    const list = /static let common = \[([^\]]*)\]/.exec(swift)?.[1] || ''
    expect([...list.matchAll(/"([^"]+)"/g)].map(m => m[1])).toEqual([...COMMON_LOCALES])
  })

  test('the limits match', () => {
    expect(swiftNumber('translateRequest')).toBe(TRANSLATE_LIMITS.locales)
    expect(swiftNumber('onboardingTranslations')).toBe(ONBOARDING_MAX_LOCALES)
    expect(EMAIL_MAX_TRANSLATIONS).toBeGreaterThan(0)
    expect(swiftNumber('emailTranslations')).toBe(EMAIL_MAX_TRANSLATIONS)
  })

  test('the default tag is the one the server falls back to', () => {
    expect(/static let defaultTag = "([^"]+)"/.exec(swift)?.[1]).toBe(normalizeLocale('en'))
  })
})
