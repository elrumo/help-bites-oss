import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_PALETTES, STYLE_FONTS, STYLE_PALETTE_KEYS, STYLE_RADIUS_MAX, STYLE_SCHEMES, STYLE_SHADOWS, STYLE_SHADOW_CSS } from '../shared/projectStyle'

// The native style editor hand-ports the project style's lists, defaults and
// shadows; this keeps the copies in step with shared/projectStyle.ts.

const file = join(import.meta.dir, '../helpbites-native/App/Features/Brand/ProjectStyleModels.swift')
const missing = (src: string, values: Array<string | number>) => values.filter(v => !src.includes(typeof v === 'number' ? String(v) : JSON.stringify(v)))

describe('native project style parity', () => {
  test('ProjectStyleModels.swift has every scheme, shadow, font, colour key, default and the radius limit', () => {
    expect(existsSync(file)).toBe(true)
    const swift = readFileSync(file, 'utf8')
    const defaults = Object.values(DEFAULT_PALETTES).flatMap(palette => Object.values(palette))
    expect(missing(swift, [...STYLE_SCHEMES, ...STYLE_SHADOWS, ...STYLE_FONTS, ...defaults])).toEqual([])
    expect(swift).toContain(`static let radiusMax = ${STYLE_RADIUS_MAX}`)
  })

  test('the native shadow layers are the CSS ones (y, blur, opacity; CSS blur is twice SwiftUI radius)', () => {
    const swift = readFileSync(file, 'utf8')
    for (const [name, css] of Object.entries(STYLE_SHADOW_CSS)) {
      const layers = [...css.matchAll(/0 (\d+)px (\d+)px rgb\(0 0 0 \/ ([\d.]+)\)|0 (\d+) (\d+)px rgb\(0 0 0 \/ ([\d.]+)\)/g)]
      const native = layers.map(m => `(${m[1] ?? m[4]}, ${m[2] ?? m[5]}, ${m[3] ?? m[6]})`)
      if (name === 'none') expect(swift).toContain('"none": []')
      else expect(native.length).toBeGreaterThan(0)
      for (const layer of native) expect(swift).toContain(layer)
    }
  })
})
