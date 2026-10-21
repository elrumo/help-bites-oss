import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOMAIN_EVENTS } from '../shared/domainEvents'

// The native app hand-ports the event catalogue its webhook endpoint editor offers.

const swift = readFileSync(join(import.meta.dir, '../helpbites-native/App/Features/Projects/WebhookEndpoints.swift'), 'utf8')

describe('native webhook endpoint parity', () => {
  test('WebhookEndpoints.swift offers every event and group, with the same labels', () => {
    const missing = DOMAIN_EVENTS.filter(e => !swift.includes(`("${e.type}", "${e.label}")`)).map(e => e.type)
    expect(missing).toEqual([])
    const groups = [...new Set(DOMAIN_EVENTS.map(e => e.group))]
    expect(groups.filter(g => !swift.includes(`Group(key: "${g}"`))).toEqual([])
  })

  test('the Swift catalogue names no event the server does not publish', () => {
    const types = new Set(DOMAIN_EVENTS.map(e => e.type))
    const named = [...swift.matchAll(/\("([a-z_]+(?:\.[a-z_]+)+)", "/g)].map(m => m[1]!)
    expect(named.filter(t => !types.has(t))).toEqual([])
  })
})
