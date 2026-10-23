import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOMAIN_TARGETS } from '../shared/domains'
import en from '../i18n/locales/en.json'

// The native app hand-ports the targets a custom domain can open on, with the panel's labels.

const swift = readFileSync(join(import.meta.dir, '../helpbites-native/App/Features/Projects/ProjectDomains.swift'), 'utf8')

describe('native custom domain parity', () => {
  test('ProjectDomains.swift offers every target with the panel\'s label', () => {
    const labels = en.projectDomains.target as Record<string, string>
    expect(DOMAIN_TARGETS.filter(key => !swift.includes(`("${key}", "${labels[key]}")`))).toEqual([])
  })

  test('it names no target the server does not know', () => {
    const named = [...swift.matchAll(/\("([a-z]+)", "[A-Z][^"]*"\)/g)].map(m => m[1]!)
    expect(named.filter(key => !(DOMAIN_TARGETS as readonly string[]).includes(key))).toEqual([])
  })

  test('the DNS record keys the server sends are the ones it decodes', () => {
    for (const key of ['purpose', 'type', 'host', 'value', 'valid']) expect(swift).toContain(key)
  })
})
