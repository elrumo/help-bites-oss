import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BRAND_RADII, BRAND_THEMES } from '../shared/brand'
import {
  CMS_ANIM_EASINGS, CMS_ANIM_EFFECTS, CMS_ANIM_TRIGGERS, CMS_FIELD_TYPES, CMS_LIMITS, CMS_SLUG, CMS_WIDTHS, DEFAULT_ANIMATION, DEFAULT_STYLE, EMPTY_BRIEF
} from '../shared/cms/content'
import { CMS_ICON_NAMES } from '../shared/cms/icons'
import { projectSections } from '../app/utils/projectSections'

// The native Pages screens hand-port the CMS's lists, defaults and limits; this keeps
// the copies in step with shared/cms/content.ts and shared/cms/icons.ts.

const root = join(import.meta.dir, '..')
const feature = join(root, 'helpbites-native/App/Features/Pages')
const modelsPath = join(feature, 'PagesModels.swift')
const swift = existsSync(modelsPath) ? readFileSync(modelsPath, 'utf8') : ''

/** The Swift from `header` to the closing brace at column 0. */
function block(header: string): string {
  const start = swift.indexOf(header)
  expect(start, `${header} is in PagesModels.swift`).toBeGreaterThanOrEqual(0)
  return swift.slice(start, swift.indexOf('\n}\n', start))
}
/** The ids of `static let name: [(id: String, label: String)] = [("id", "Label"), …]`. */
function ids(src: string, name: string): string[] {
  const start = src.indexOf(`static let ${name}`)
  expect(start, `${name} is declared`).toBeGreaterThanOrEqual(0)
  const next = src.indexOf('\n  static let', start + 1)
  const list = src.slice(start, next === -1 ? undefined : next)
  return [...list.matchAll(/\("([^"]+)",\s*"[^"]*"\)/g)].map(m => m[1]!)
}
/** `var key = value` defaults of a struct, as the JavaScript value they stand for. */
function defaults(src: string): Record<string, string | number | boolean> {
  return Object.fromEntries([...src.matchAll(/^\s*var (\w+) = ("[^"]*"|-?\d+|true|false)$/gm)].map(m => [m[1]!, JSON.parse(m[2]!)]))
}

describe('native pages parity', () => {
  test('PagesModels.swift exists and the screens are registered', () => {
    expect(swift.length).toBeGreaterThan(0)
    expect(projectSections.map(s => s.path)).toContain('pages')
    const workspace = readFileSync(join(root, 'helpbites-native/App/Shell/Workspace.swift'), 'utf8')
    expect(workspace).toContain('case pageEntry')
    for (const file of ['PagesScreen', 'PageEntryScreen', 'PageInspector', 'PageFieldInput', 'PagesFilesView', 'PagesSettingsView']) expect(existsSync(join(feature, `${file}.swift`))).toBe(true)
  })

  test('the field types are the same, in order', () => {
    const cases = block('enum CmsFieldKind').match(/case ([\w, ]+)/)![1]!.split(',').map(s => s.trim())
    expect(cases).toEqual([...CMS_FIELD_TYPES])
  })

  test('animation effects, triggers, easings and defaults', () => {
    const animation = block('struct CmsAnimation')
    expect(ids(animation, 'effects')).toEqual([...CMS_ANIM_EFFECTS])
    expect(ids(animation, 'triggers')).toEqual([...CMS_ANIM_TRIGGERS])
    expect(ids(animation, 'easings')).toEqual([...CMS_ANIM_EASINGS])
    expect(defaults(animation)).toEqual({ ...DEFAULT_ANIMATION })
  })

  test('page style defaults, widths, colour schemes and corners', () => {
    expect(defaults(block('struct CmsStyle'))).toEqual({ ...DEFAULT_STYLE })
    const options = block('enum CmsOptions')
    expect(ids(options, 'widths')).toEqual([...CMS_WIDTHS])
    expect(ids(options, 'modes')).toEqual([...BRAND_THEMES])
    // The corners picker reuses the brand kit's list.
    const brand = readFileSync(join(root, 'helpbites-native/App/Features/Brand/BrandModels.swift'), 'utf8')
    expect(ids(brand.slice(brand.indexOf('enum BrandOptions')), 'radii')).toEqual([...BRAND_RADII])
  })

  test('the icon field offers every icon', () => {
    const options = block('enum CmsOptions')
    const start = options.indexOf('static let icons')
    const names = [...options.slice(start, options.indexOf('\n  ]', start)).matchAll(/"([^"]+)"/g)].map(m => m[1]!)
    expect(names).toEqual(CMS_ICON_NAMES)
  })

  test('limits and the slug pattern', () => {
    const limits = block('enum CmsLimits')
    const numbers = Object.fromEntries([...limits.matchAll(/static let (\w+) = ([\d_ *]+)$/gm)].map(m => [m[1]!, m[2]!.replace(/_/g, '').split('*').reduce((n, x) => n * Number(x), 1)]))
    expect(Object.keys(numbers).length).toBeGreaterThan(5)
    for (const [name, value] of Object.entries(numbers)) expect(value, `CMS_LIMITS.${name}`).toBe((CMS_LIMITS as Record<string, number>)[name]!)
    expect(limits).toContain(`static let slugPattern = ${JSON.stringify(CMS_SLUG.source.replace(/\\\//g, '/'))}`)
  })

  test('the brief has the same parts', () => {
    const fields = [...block('struct CmsBrief').matchAll(/^\s*var (\w+)\b/gm)].map(m => m[1]!)
    expect(fields.sort()).toEqual(Object.keys(EMPTY_BRIEF).sort())
  })
})
