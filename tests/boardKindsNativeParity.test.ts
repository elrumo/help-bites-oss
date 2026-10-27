import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOARD_ITEM_KINDS, kindCanHave } from '../shared/board'

// The native board hand-ports the item kinds and the rule for which kind can have an epic or a release.

const swift = readFileSync(join(import.meta.dir, '..', 'helpbites-native/App/Features/Board/BoardModels.swift'), 'utf8')

describe('native board kinds parity', () => {
  test('BoardModels.swift lists the same kinds in the same order', () => {
    expect(swift).toContain(`static let all = [${BOARD_ITEM_KINDS.map(kind => JSON.stringify(kind)).join(', ')}]`)
  })

  test('BoardKind.canHave is kindCanHave', () => {
    // Swift's rule, as written: epic holds cards only, a release holds anything but a release.
    const canHave = (kind: string, parent: string) => parent === 'epic' ? kind === 'task' : kind !== 'release'
    expect(swift).toContain('parent == "epic" ? kind == "task" : kind != "release"')
    for (const kind of BOARD_ITEM_KINDS) for (const parent of ['epic', 'release'] as const) expect(canHave(kind, parent)).toBe(kindCanHave(kind, parent))
  })
})
