import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BRAND_ASSET_BACKGROUNDS, BRAND_ASSET_KIND_LABELS, BRAND_FONT_ROLES, BRAND_LIMITS, BRAND_RADII, BRAND_SECTION_LABELS, BRAND_TEMPLATE_INFO, BRAND_THEMES
} from '../shared/brand'

// The native brand screen hand-ports the kit's lists and labels; this keeps
// the copies in step with shared/brand.ts.

const file = join(import.meta.dir, '../helpbites-native/App/Features/Brand/BrandModels.swift')
const missing = (src: string, values: Array<string | number>) => values.filter(v => typeof v === 'number' ? !new RegExp(`\\b${v}\\b`).test(src) : !src.includes(JSON.stringify(v)))

describe('native brand parity', () => {
  test('BrandModels.swift has every template, section, kind and choice with its label', () => {
    expect(existsSync(file)).toBe(true)
    const swift = readFileSync(file, 'utf8')
    const templates = Object.entries(BRAND_TEMPLATE_INFO).flatMap(([id, info]) => [id, info.label, info.description])
    const sections = Object.entries(BRAND_SECTION_LABELS).flat()
    const kinds = Object.entries(BRAND_ASSET_KIND_LABELS).flat()
    expect(missing(swift, [...templates, ...sections, ...kinds, ...BRAND_THEMES, ...BRAND_RADII, ...BRAND_ASSET_BACKGROUNDS, ...BRAND_FONT_ROLES, BRAND_LIMITS.colors, BRAND_LIMITS.fonts, BRAND_LIMITS.guidelines])).toEqual([])
  })
})
