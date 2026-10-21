import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { revenueChange } from '../shared/overview'
import { demoApi } from '../app/utils/demoApi'

describe('workspace overview', () => {
  test('the change is a fraction of the period before, and nothing without one', () => {
    expect(revenueChange(112, 100)).toBe(0.12)
    expect(revenueChange(0, 250)).toBe(-1)
    expect(revenueChange(1, 3)).toBe(-0.667)
    expect(revenueChange(50, 0)).toBeNull()
    expect(revenueChange(50, null)).toBeNull()
  })

  // The native app decodes the same response by hand (OverviewModels.swift).
  test('the Swift models declare every field the overview returns', async () => {
    const keys = new Set<string>()
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { keys.add(key); walk(child) }
    }
    walk(await demoApi('/admin/overview', { query: { range: '90d' } }))
    const swift = readFileSync(join(import.meta.dir, '..', 'helpbites-native/App/Features/Overview/OverviewModels.swift'), 'utf8')
    expect(keys.size).toBeGreaterThan(20)
    expect([...keys].filter(key => !new RegExp(`\\b${key}\\b`).test(swift))).toEqual([])
  })
})

describe('project overview', () => {
  // The panel translates the server's rows by key; a key with no words shows its English in every language.
  test('every key the project overview sends has words in every panel language', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'server/utils/overview.ts'), 'utf8')
    const body = source.slice(source.indexOf('export async function projectOverview'), source.indexOf('// ---- the workspace overview'))
    const keysIn = (text: string, field: string) => [...text.matchAll(new RegExp(`\\b${field}: '(\\w+)'`, 'g'))].map(m => m[1]!)
    // The setup rows and attention items carry codes the clients word themselves (tests/setup.test.ts, tests/attention.test.ts).
    const keys = [
      ...keysIn(body.slice(body.indexOf('const stats'), body.indexOf('const activity')), 'key').map(key => `stats.${key}`),
      ...keysIn(body, 'titleKey').map(key => `activityTitle.${key}`)
    ]
    expect(keys.length).toBeGreaterThan(5)
    for (const locale of ['en', 'es', 'ca', 'ja', 'ko', 'zh']) {
      const words = JSON.parse(readFileSync(join(import.meta.dir, '..', `i18n/locales/${locale}.json`), 'utf8')).projectPages.overview
      expect(keys.filter(key => typeof key.split('.').reduce((node: any, part) => node?.[part], words) !== 'string').map(key => `${locale}: ${key}`)).toEqual([])
    }
  })
})
