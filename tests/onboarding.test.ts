import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ONBOARDING_LIMITS, onboardingKeyFrom, starterSteps, validateOnboardingOptions, validateOnboardingStyle, validateOnboardingSteps
} from '../shared/onboarding'

describe('onboarding flows', () => {
  test('steps are cleaned, keep unique ids and refuse empty or oversized ones', () => {
    const { steps, errors } = validateOnboardingSteps([
      { id: 'a', title: '  Hello ', body: 'World', imageUrl: 'https://cdn.test/a.png' },
      { id: 'a', title: 'Second' },
      { title: '', body: '' }
    ])
    expect(steps[0]).toEqual({ id: 'a', title: 'Hello', body: 'World', imageUrl: 'https://cdn.test/a.png', imageAlt: '', buttonLabel: '' })
    expect(steps[1]!.id).not.toBe('a')
    expect(errors).toEqual(['Step 3 is empty'])

    expect(validateOnboardingSteps([{ title: 'x', imageUrl: 'javascript:alert(1)' }]).errors).toEqual(['Step 1: imageUrl must be an http(s) URL'])
    expect(validateOnboardingSteps([{ title: 'x'.repeat(ONBOARDING_LIMITS.title + 1) }]).errors[0]).toContain('up to')
    expect(validateOnboardingSteps(Array.from({ length: ONBOARDING_LIMITS.steps + 1 }, () => ({ title: 'x' }))).errors[0]).toContain(`at most ${ONBOARDING_LIMITS.steps}`)
    expect(validateOnboardingSteps('nope').errors).toEqual(['steps must be a list'])
  })

  test('style and options merge onto their base and report bad values without applying them', () => {
    const base = validateOnboardingStyle({}).style
    const { style, errors } = validateOnboardingStyle({ accent: '#FF0066', radius: 40, font: 'comic' }, base)
    expect(style.accent).toBe('#ff0066')
    expect(style.radius).toBe(base.radius)
    expect(style.font).toBe(base.font)
    expect(errors).toHaveLength(2)
    expect(validateOnboardingStyle({ background: '' }).errors).toEqual([])
    expect(validateOnboardingOptions({ progress: 'dots', skippable: false }).options).toEqual({ progress: 'dots', skippable: false })
    expect(validateOnboardingOptions({ progress: 'wheel' }).errors).toHaveLength(1)
  })

  test('keys come from names, and a new flow starts with three valid steps', () => {
    expect(onboardingKeyFrom('Welcome tour!')).toBe('welcome-tour')
    expect(onboardingKeyFrom('Été 2026')).toBe('ete-2026')
    expect(onboardingKeyFrom('***')).toBe('welcome')
    const steps = starterSteps('Acme')
    expect(steps).toHaveLength(3)
    expect(validateOnboardingSteps(steps).errors).toEqual([])
    expect(steps[0]!.title).toBe('Welcome to Acme')
  })

  test('the web script is MIT, has no dependencies and parses', () => {
    const source = readFileSync(join(import.meta.dir, '../public/onboarding.js'), 'utf8')
    expect(source.startsWith('/* SPDX-License-Identifier: MIT')).toBe(true)
    expect(source).not.toMatch(/\bimport\s|require\(/)
    expect(() => new Function(source)).not.toThrow()
  })
})
