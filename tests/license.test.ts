import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

describe('licensing', () => {
  test('the core is AGPL-3.0-only', () => {
    expect(read('LICENSE')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE')
    expect(JSON.parse(read('package.json')).license).toBe('AGPL-3.0-only')
  })

  test('what customers embed or run on their machines is MIT', () => {
    expect(JSON.parse(read('cli/package.json')).license).toBe('MIT')
    expect(read('cli/LICENSE')).toContain('MIT License')
    for (const loader of ['public/widget.js', 'public/feedback.js', 'public/pricing.js']) expect(read(loader).startsWith('/* SPDX-License-Identifier: MIT')).toBe(true)
  })
})
