import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GUEST_SURFACES } from '../shared/guest'

// The native settings screen hand-ports the surfaces an admin can open to guests.

const swift = readFileSync(join(import.meta.dir, '../helpbites-native/App/Features/Projects/ProjectSettingsScreen.swift'), 'utf8')

test('the native settings screen lists the same guest surfaces, in the same order', () => {
  const list = /enum GuestSurfaces \{\s*static let all = \[([^\]]*)\]/.exec(swift)
  expect(list).not.toBeNull()
  expect(list![1]!.split(',').map(item => item.trim().replace(/"/g, ''))).toEqual([...GUEST_SURFACES])
})

test('each surface has a switch on the native settings screen', () => {
  for (const surface of GUEST_SURFACES) expect(swift).toContain(`guest("${surface}")`)
})
