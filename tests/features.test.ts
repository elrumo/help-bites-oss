import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectSections } from '../app/utils/projectSections'

// features.json is the source of truth CLAUDE.md tells every change to update;
// this fails when it names something that no longer exists, or when a panel
// section or native area has no feature.

const root = join(import.meta.dir, '..')
const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const { features } = read('features.json') as { features: Array<Record<string, any>> }
const has = (path: string) => existsSync(join(root, path))
const panelPaths = features.flatMap(f => f.web?.panel ?? []) as string[]
// The cloud repo sits next to this one and is not always checked out.
const here = (path: string) => path.startsWith('../') && !has('../help-bites-cloud') ? true : has(path)

describe('features.json', () => {
  test('ids are unique and every feature names an edition', () => {
    const ids = features.map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of features) expect(f.editions.length).toBeGreaterThan(0)
  })

  test('every named file, doc, snippet and native folder exists', () => {
    const missing = features.flatMap(f => [
      ...(f.web?.panel ?? []),
      ...(f.native?.folders ?? []),
      f.native?.parity, f.api?.docs, f.embed?.web
    ].filter(Boolean).filter((p: string) => !here(p)).map((p: string) => `${f.id}: ${p}`))
    expect(missing).toEqual([])
  })

  test('every API prefix has a route file', () => {
    const missing = features.flatMap(f => (f.api?.prefixes ?? []).map((p: string) => {
      const [, v1, a, b] = p.split('/')
      const under = (parts: string[]) => {
        const dir = join(root, 'server/routes', ...parts.slice(0, -1))
        return existsSync(dir) && readdirSync(dir).some(n => n === parts.at(-1) || n.startsWith(parts.at(-1) + '.'))
      }
      // A top-level route such as /mcp has no second segment.
      if (!a) return under([v1]) ? null : `${f.id}: ${p}`
      return under([v1, a]) || (a === 'admin' && b && !b.startsWith(':') && under([v1, a, b])) ? null : `${f.id}: ${p}`
    }).filter(Boolean))
    expect(missing).toEqual([])
  })

  // The landing page is the hosted edition's (ee/app/pages/index.vue), with its words in ee/i18n/locales: assembled
  // (ee/ laid over this checkout) or in the cloud repo next to it. With neither there is nothing to check against.
  test('every landing key is in the landing page\'s en.json', () => {
    const source = ['ee/i18n/locales/en.json', '../help-bites-cloud/ee/i18n/locales/en.json'].find(has)
    if (!source) return
    const words = read(source)
    const get = (key: string) => key.split('.').reduce((o: any, k) => o?.[k], words)
    const missing = features.filter(f => f.landing?.listed).filter(f => get(f.landing.key) === undefined).map(f => `${f.id}: ${f.landing.key}`)
    expect(missing).toEqual([])
  })

  test('every project section and native feature folder belongs to a feature', () => {
    expect(projectSections.map(s => s.path).filter(path => !panelPaths.some(p => p.includes(`[id]/${path}.vue`) || p.includes(`[id]/${path}/`)))).toEqual([])
    const folders = features.flatMap(f => f.native?.folders ?? []) as string[]
    const native = readdirSync(join(root, 'helpbites-native/App/Features')).filter(n => !n.startsWith('.')).map(n => `helpbites-native/App/Features/${n}`)
    expect(native.filter(n => !folders.includes(n))).toEqual([])
  })
})
