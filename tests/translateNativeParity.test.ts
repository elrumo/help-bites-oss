import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMMON_LOCALES } from '../shared/locales'
import { ONBOARDING_MAX_LOCALES } from '../shared/onboarding'
import { TRANSLATE_LIMITS } from '../shared/translate'

// The native app hand-ports the content-language helpers and limits of the translations
// feature to one Swift file; this keeps that copy in step with the TypeScript.

const file = join(import.meta.dir, '../helpbites-native/App/Core/ContentLocale.swift')
// EMAIL_MAX_TRANSLATIONS lives in server/utils/emails.ts, which needs Nitro globals to import.
const emailMax = Number(/export const EMAIL_MAX_TRANSLATIONS = (\d+)/.exec(readFileSync(join(import.meta.dir, '../server/utils/emails.ts'), 'utf8'))?.[1])

/** The Swift constant `static let <name> = <number>`. */
const constant = (swift: string, name: string) => Number(new RegExp(`static let ${name} = (\\d+)`).exec(swift)?.[1])

describe('native translations parity', () => {
  test('ContentLocale.swift has the common languages and the limits', () => {
    expect(existsSync(file)).toBe(true)
    const swift = readFileSync(file, 'utf8')
    const list = /static let common = \[([^\]]*)\]/.exec(swift)?.[1] ?? ''
    expect([...list.matchAll(/"([^"]+)"/g)].map(m => m[1])).toEqual([...COMMON_LOCALES])
    expect(constant(swift, 'translateRequest')).toBe(TRANSLATE_LIMITS.locales)
    expect(constant(swift, 'onboardingTranslations')).toBe(ONBOARDING_MAX_LOCALES)
    expect(emailMax).toBeGreaterThan(0)
    expect(constant(swift, 'emailTranslations')).toBe(emailMax)
  })

  test('the tag pattern and length limit are the same', () => {
    const swift = readFileSync(file, 'utf8')
    expect(swift).toContain('[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}')
    expect(swift).toContain('<= 20')
  })
})
