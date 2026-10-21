import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_SECTION_GROUPS, SECTION_GROUPS } from '../shared/projectSections'

// The native app hand-ports the sidebar's groups and each section's label
// (Shell/Workspace.swift); this keeps them in step with shared/projectSections.ts
// and the web's labels in en.json.

const root = join(import.meta.dir, '..')
const source = readFileSync(join(root, 'helpbites-native/App/Shell/Workspace.swift'), 'utf8')
// The group enum comes first and the section enum after it; each has its own `label`.
const groupSource = source.slice(source.indexOf('enum SectionGroup'), source.indexOf('enum ProjectSection'))
const swift = source.slice(source.indexOf('enum ProjectSection'))
const en = JSON.parse(readFileSync(join(root, 'i18n/locales/en.json'), 'utf8'))
const webPath = (name: string) => (name === 'tickets' ? 'types' : name)

const cases = /enum ProjectSection[^{]*\{\s*case ([^\n]+)/.exec(swift)?.[1]?.split(',').map(c => c.trim()) || []
/** `case .a, .b: "text"` lines inside the body of `var <name>`. */
function switchOf(name: string, from = swift): [string[], string][] {
  const body = new RegExp(`var ${name}[^{]*\\{\\s*switch self \\{([\\s\\S]*?)\\n  \\}\\n`).exec(from)?.[1] || ''
  return [...body.matchAll(/case ((?:\.\w+(?:, )?)+): (nil|\.\w+|"[^"]*")/g)].map(m => [m[1]!.split(',').map(c => c.trim().slice(1)), m[2]!])
}

describe('native sidebar parity', () => {
  test('the sections are the web\'s, in its order', () => {
    expect(cases.length).toBeGreaterThan(10)
    expect(cases.map(webPath)).toEqual(Object.keys(PROJECT_SECTION_GROUPS))
  })

  test('each section sits under the same group as on the web', () => {
    const native: Record<string, string | null> = {}
    for (const [names, group] of switchOf('group')) for (const name of names) native[webPath(name)] = group === 'nil' ? null : group.slice(1)
    for (const path of cases.map(webPath)) expect(native[path]).toBe(PROJECT_SECTION_GROUPS[path]!)
  })

  test('the groups and their headings are the web\'s', () => {
    const enumGroups = /enum SectionGroup[^{]*\{\s*case ([^\n]+)/.exec(groupSource)?.[1]?.split(',').map(c => c.trim())
    expect(enumGroups).toEqual([...SECTION_GROUPS])
    const headings = Object.fromEntries(switchOf('label', groupSource).map(([names, text]) => [names[0], JSON.parse(text)]))
    for (const group of SECTION_GROUPS) expect(headings[group]).toBe(en.nav.groups[group])
  })

  test('every section is labelled as in the web panel', () => {
    const labels = Object.fromEntries(switchOf('label').map(([names, text]) => [webPath(names[0]!), JSON.parse(text)]))
    for (const path of cases.map(webPath)) expect(labels[path]).toBe(en.sections[path])
  })
})
