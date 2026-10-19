import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// The community build deletes ee/ before building, so core code that leaned
// on it would break there (or, through Nitro's shared auto-import namespace,
// silently pick up a commercial helper). These checks keep the seam clean.

const ROOT = join(import.meta.dir, '..')
const CORE = ['server', 'app', 'shared', 'scripts', 'public']
const CODE = /\.(ts|mjs|js|vue)$/

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'node_modules' || name.startsWith('.')) return []
    return statSync(path).isDirectory() ? walk(path) : CODE.test(name) ? [path] : []
  })
}

const coreFiles = CORE.flatMap(dir => walk(join(ROOT, dir)))
const exportedNames = (files: string[]) => files.flatMap(file => [...readFileSync(file, 'utf8').matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]!))

describe('edition boundary', () => {
  test('no core file imports from ee/', () => {
    const offenders = coreFiles.filter(file => /from\s+['"](?:\.\.?\/)+(?:\.\.\/)*ee\/|from\s+['"]~~\/ee\/|import\(\s*['"](?:\.\.?\/)+ee\//.test(readFileSync(file, 'utf8')))
    expect(offenders.map(file => relative(ROOT, file))).toEqual([])
  })

  test('no core file calls a helper only ee/ defines', () => {
    const eeNames = exportedNames([...walk(join(ROOT, 'ee/server/utils')), ...walk(join(ROOT, 'ee/app/utils')), ...walk(join(ROOT, 'ee/app/composables'))])
    const offenders = coreFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return eeNames.filter(name => new RegExp(`\\b${name}\\b`).test(source)).map(name => `${relative(ROOT, file)}: ${name}`)
    })
    expect(offenders).toEqual([])
  })

  test('ee/ utilities never shadow a core auto-import', () => {
    const core = new Set(exportedNames([...walk(join(ROOT, 'server/utils')), ...walk(join(ROOT, 'app/utils')), ...walk(join(ROOT, 'app/composables'))]))
    const ee = exportedNames([...walk(join(ROOT, 'ee/server/utils')), ...walk(join(ROOT, 'ee/app/utils')), ...walk(join(ROOT, 'ee/app/composables'))])
    expect(ee.filter(name => core.has(name))).toEqual([])
  })

  test('every ee/ source file carries the commercial license header', () => {
    const missing = walk(join(ROOT, 'ee')).filter(file => !/\/tests\//.test(file)).filter(file => !readFileSync(file, 'utf8').includes('LicenseRef-HelpBites-Commercial'))
    expect(missing.map(file => relative(ROOT, file))).toEqual([])
  })
})
