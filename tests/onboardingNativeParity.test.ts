import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ONBOARDING_FONTS, ONBOARDING_KEY, ONBOARDING_LIMITS, ONBOARDING_PROGRESS } from '../shared/onboarding'

// The native editor hand-ports the onboarding limits and choices; this keeps
// the copies in step with shared/onboarding.ts.

const file = join(import.meta.dir, '../helpbites-native/App/Features/Onboarding/OnboardingModels.swift')
const missing = (src: string, values: Array<string | number>) => values.filter(v => typeof v === 'number' ? !new RegExp(`\\b${v}\\b`).test(src) : !src.includes(JSON.stringify(v)))

describe('native onboarding parity', () => {
  test('OnboardingModels.swift has every limit, the key pattern, the fonts and the progress kinds', () => {
    expect(existsSync(file)).toBe(true)
    const swift = readFileSync(file, 'utf8')
    expect(missing(swift, [...Object.values(ONBOARDING_LIMITS), ONBOARDING_KEY.source, ...ONBOARDING_FONTS, ...ONBOARDING_PROGRESS])).toEqual([])
  })
})
