import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FEATURE_LABELS, FEATURES } from '../shared/entitlements'
import { projectSections } from '../app/utils/projectSections'

// The native app hand-ports the plan's feature keys and labels (Plan & usage,
// and the lock notices); this keeps them in step with shared/entitlements.ts.

const swift = (path: string) => readFileSync(join(import.meta.dir, '../helpbites-native/App', path), 'utf8')

describe('native plan parity', () => {
  test('PlanFeature has every feature with its label', () => {
    const src = swift('Features/Settings/UsageScreen.swift')
    expect(FEATURES.filter(feature => !src.includes(`(${JSON.stringify(feature)}, ${JSON.stringify(FEATURE_LABELS[feature])})`))).toEqual([])
  })

  test('every section the web marks as locked has its notice in the native screen', () => {
    const screens: Record<string, string> = { legal: 'Features/Legal/LegalScreen.swift' }
    const gated = projectSections.filter(section => section.feature)
    expect(gated.map(section => section.path).sort()).toEqual(Object.keys(screens).sort())
    for (const section of gated) expect(swift(screens[section.path]!)).toContain(JSON.stringify(section.feature))
  })

  // Campaigns and sequences are tabs of Email now, so the lock sits on those tabs in both apps.
  test('the campaigns and sequences tabs are locked in the web bar and the native screen', () => {
    const tabs = readFileSync(join(import.meta.dir, '../app/components/email/EmailTabs.vue'), 'utf8')
    expect(tabs.match(/locked\('campaigns'\)/g)).toHaveLength(2)
    expect(swift('Features/Campaigns/CampaignsScreen.swift')).toContain(JSON.stringify('campaigns'))
  })
})
