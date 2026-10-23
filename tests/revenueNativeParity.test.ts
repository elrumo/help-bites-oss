import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REVENUE_SOURCES } from '../shared/revenue'

// The native app hand-ports the revenue source catalog; this keeps the copy in step with
// shared/revenue.ts. Swift string literals are double-quoted like JSON, so JSON.stringify gives the exact literal.

const root = join(import.meta.dir, '..')
const swift = (name: string) => readFileSync(join(root, 'helpbites-native/App/Features/Revenue', name), 'utf8')
const lines = (src: string) => src.split('\n')
const q = (value: string) => JSON.stringify(value)

describe('native revenue parity', () => {
  const catalog = swift('RevenueSources.swift')

  test('RevenueSources.swift lists every source once, with its name, kind and subscriptions flag', () => {
    expect(catalog.match(/RevenueSource\(id: "/g)?.length).toBe(REVENUE_SOURCES.length)
    for (const source of REVENUE_SOURCES) {
      const header = lines(catalog).filter(line => line.includes(`RevenueSource(id: ${q(source.id)}`))
      expect(header).toHaveLength(1)
      expect(header[0]).toContain(`name: ${q(source.name)}`)
      expect(header[0]).toContain(`kind: .${source.kind}`)
      expect(header[0]).toContain(`subscriptions: ${source.subscriptions}`)
    }
  })

  test('RevenueSources.swift has every credential field, with its placeholder and flags', () => {
    for (const source of REVENUE_SOURCES) {
      // A source's fields sit between its header and the next one.
      const from = catalog.indexOf(`RevenueSource(id: ${q(source.id)}`)
      const rest = catalog.slice(from + 1)
      const next = rest.search(/RevenueSource\(id: "/)
      const block = lines(next < 0 ? rest : rest.slice(0, next)).filter(line => line.includes('.init(key: '))
      expect(block).toHaveLength(source.fields.length)
      for (const field of source.fields) {
        const line = block.find(l => l.includes(`key: ${q(field.key)}`))
        expect(line).toBeDefined()
        if (field.placeholder) expect(line).toContain(`placeholder: ${q(field.placeholder)}`)
        for (const flag of ['secret', 'multiline', 'optional'] as const) {
          expect(line!.includes(`${flag}: true`)).toBe(Boolean(field[flag]))
        }
      }
    }
  })

  test('the screen and the connect flow call the /v1/admin/revenue routes, not the Stripe-only ones', () => {
    const screen = swift('RevenueScreen.swift')
    const connect = swift('RevenueConnect.swift')
    for (const path of ['/v1/admin/revenue/sources', '/v1/admin/revenue/report', '/v1/admin/revenue/sync', '/v1/admin/revenue?project=']) expect(screen).toContain(path)
    expect(connect).toContain('/v1/admin/revenue/connect')
    expect(connect).toContain('/v1/admin/revenue/payments')
    expect(screen + connect).not.toContain('/v1/admin/stripe')
  })
})
