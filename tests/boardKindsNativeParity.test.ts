import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOARD_ITEM_KINDS, kindCanHave } from '../shared/board'

// The native board hand-ports the item kinds and the rule for which kind can have an epic or a release (a changelog release).

const swift = readFileSync(join(import.meta.dir, '..', 'helpbites-native/App/Features/Board/BoardModels.swift'), 'utf8')

describe('native board kinds parity', () => {
  test('BoardModels.swift lists the same kinds in the same order', () => {
    expect(swift).toContain(`static let all = [${BOARD_ITEM_KINDS.map(kind => JSON.stringify(kind)).join(', ')}]`)
  })

  test('the kinds are named as the panel names them', () => {
    const names = JSON.parse(readFileSync(join(import.meta.dir, '..', 'i18n/locales/en.json'), 'utf8')).board.kinds as Record<string, string>
    const naming = /static func name\(_ kind: String\) -> String \{([\s\S]*?)\n  \}/.exec(swift)
    expect(naming).not.toBeNull()
    expect(naming![1]).toContain(`case "epic": String(localized: "${names.epic}")`)
    expect(naming![1]).toContain(`default: String(localized: "${names.task}")`)
  })

  test('the epic and release menus offer only what the kinds can have', () => {
    const screen = readFileSync(join(import.meta.dir, '..', 'helpbites-native/App/Features/Board/BoardScreen.swift'), 'utf8')
    expect(screen).toContain('BoardKind.canHave(item.itemKind, parent: "epic")')
    expect(screen).toContain('BoardKind.canHave(item.itemKind, parent: "release")')
  })

  test('BoardKind.canHave is kindCanHave', () => {
    // Swift's rule, as written: an epic holds cards only, a release (a changelog release) holds cards and epics.
    const canHave = (kind: string, parent: string) => parent === 'epic' ? kind === 'task' : true
    expect(swift).toContain('parent == "epic" ? kind == "task" : true')
    for (const kind of BOARD_ITEM_KINDS) for (const parent of ['epic', 'release'] as const) expect(canHave(kind, parent)).toBe(kindCanHave(kind, parent))
  })
})
