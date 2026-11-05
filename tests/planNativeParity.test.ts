import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COUNTERS, FEATURE_LABELS, FEATURES, GAUGES, STORAGE_TYPES } from '../shared/entitlements'
import { projectSections } from '../app/utils/projectSections'

// The native app hand-ports the plan's feature keys and labels (Plan & usage,
// and the lock notices); this keeps them in step with shared/entitlements.ts.

const swift = (path: string) => readFileSync(join(import.meta.dir, '../helpbites-native/App', path), 'utf8')

describe('native plan parity', () => {
  test('PlanFeature has every feature with its label', () => {
    const src = swift('Features/Settings/UsageScreen.swift')
    expect(FEATURES.filter(feature => !src.includes(`(${JSON.stringify(feature)}, ${JSON.stringify(FEATURE_LABELS[feature])})`))).toEqual([])
  })

  test('StorageKind has every storage type with the web\'s label', () => {
    const src = swift('Features/Settings/UsageScreen.swift')
    const labels = JSON.parse(readFileSync(join(import.meta.dir, '../i18n/locales/en.json'), 'utf8')).workspaceSettings.usage.types
    expect(STORAGE_TYPES.filter(type => !src.includes(`(${JSON.stringify(type)}, ${JSON.stringify(labels[type])})`))).toEqual([])
  })

  test('every section the web marks as locked has its notice in the native screen', () => {
    const screens: Record<string, string> = { legal: 'Features/Legal/LegalScreen.swift' }
    const gated = projectSections.filter(section => section.feature)
    expect(gated.map(section => section.path).sort()).toEqual(Object.keys(screens).sort())
    for (const section of gated) expect(swift(screens[section.path]!)).toContain(JSON.stringify(section.feature))
  })

  // The Billing section's side-by-side table copies the hosted edition's short limit names (ee/app/utils/cloudPlanCards.ts),
  // in the order the web lists them. ee/ is laid over this checkout in a cloud build, or sits in the cloud repo next to it.
  test('the Billing section names every limit as the web\'s Billing tab does', () => {
    const web = ['ee/app/utils/cloudPlanCards.ts', '../help-bites-cloud/ee/app/utils/cloudPlanCards.ts'].map(path => join(import.meta.dir, '..', path)).find(existsSync)
    const src = swift('Features/Settings/BillingSection.swift')
    const native = [...src.matchAll(/\("(\w+)", "([^"]+)"\)/g)].filter(m => (COUNTERS as readonly string[]).includes(m[1]!) || (GAUGES as readonly string[]).includes(m[1]!)).map(m => m[1])
    expect(native).toEqual([...COUNTERS, ...GAUGES])
    if (!web) return
    const block = readFileSync(web, 'utf8').split('const SHORT_LABELS')[1]!.split('}')[0]!
    const labels = Object.fromEntries([...block.matchAll(/(\w+): '([^']+)'/g)].map(m => [m[1], m[2]]))
    expect([...COUNTERS, ...GAUGES].filter(metric => !src.includes(`(${JSON.stringify(metric)}, ${JSON.stringify(labels[metric])})`))).toEqual([])
  })

  // Campaigns and sequences are tabs of Email now, so the lock sits on those tabs in both apps.
  test('the campaigns and sequences tabs are locked in the web bar and the native screen', () => {
    const tabs = readFileSync(join(import.meta.dir, '../app/components/email/EmailTabs.vue'), 'utf8')
    expect(tabs.match(/locked\('campaigns'\)/g)).toHaveLength(2)
    expect(swift('Features/Campaigns/CampaignsScreen.swift')).toContain(JSON.stringify('campaigns'))
  })
})
