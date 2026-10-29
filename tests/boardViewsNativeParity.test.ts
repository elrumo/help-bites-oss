import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOARD_ESTIMATE_MAX, BOARD_VIEWS_MAX, BOARD_VIEW_GROUPS, BOARD_VIEW_NAME_MAX, BOARD_VIEW_ORDERS, EMPTY_BOARD_VIEW_FILTERS } from '../shared/board'

// The native board hand-ports the saved-view limits, the orders and groups a view can name, and the estimate range.

const dir = join(import.meta.dir, '..', 'helpbites-native/App/Features/Board')
const models = readFileSync(join(dir, 'BoardModels.swift'), 'utf8')
const screen = readFileSync(join(dir, 'BoardScreen.swift'), 'utf8')

describe('native saved views and estimates parity', () => {
  test('the view limits match', () => {
    expect(models).toContain(`static let maxCount = ${BOARD_VIEWS_MAX}`)
    expect(models).toContain(`static let maxNameLength = ${BOARD_VIEW_NAME_MAX}`)
  })

  test('the orders the screen offers are the orders a view may name', () => {
    expect(screen).toContain(`private static let orders = [${BOARD_VIEW_ORDERS.map(order => JSON.stringify(order)).join(', ')}]`)
  })

  test('the list grouping a view may name is the one the screen applies', () => {
    expect(screen).toContain(`["${BOARD_VIEW_GROUPS.join('", "')}"].contains(saved.group)`)
  })

  test('a view stores the same filters, under the same names', () => {
    for (const key of Object.keys(EMPTY_BOARD_VIEW_FILTERS)) expect(models).toContain(`"${key}"`)
  })

  test('applying a view sets every filter it stores, and saving one keeps every filter', () => {
    const saving = /BoardViewFilters\((search:[^\n]*)/.exec(screen)
    expect(saving).not.toBeNull()
    for (const key of Object.keys(EMPTY_BOARD_VIEW_FILTERS)) {
      expect(screen, `applyView ignores filters.${key}`).toContain(`saved.filters.${key}`)
      expect(saving![1], `saveCurrentView drops ${key}`).toContain(`${key}:`)
    }
  })

  test('the estimate range is the server\'s', () => {
    expect(models).toContain(`value <= ${BOARD_ESTIMATE_MAX}`)
  })
})
