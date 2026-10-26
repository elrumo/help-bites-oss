import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROADMAP_CATEGORIES } from '../shared/board'
import { ITEM_ATTACHMENTS_MAX } from '../shared/itemAttachments'
import { ATTACHMENT_MAX_BYTES, CONVERSATION_PRIORITIES } from '../shared/support'

// The iOS share sheet ("Add to Planning", helpbites-native/HelpBitesShare) hand-ports a few rules of the
// Planning item form and shares a session with the app through an App Group.

const native = join(import.meta.dir, '../helpbites-native')
const read = (path: string) => readFileSync(join(native, path), 'utf8')
const model = read('HelpBitesShare/ShareModel.swift')
const client = read('HelpBitesShare/ShareClient.swift')

test('the sheet offers the same priorities and roadmap categories, and the same attachment limits', () => {
  const priorities = /static let priorities = \[([^\]]*)\]/.exec(model)
  expect(priorities).not.toBeNull()
  expect(priorities![1]!.split(',').map(item => item.trim().replace(/"/g, '')).sort()).toEqual([...CONVERSATION_PRIORITIES].sort())

  const categories = /static let roadmapCategories = \[([^\]]*)\]/.exec(client)
  expect(categories).not.toBeNull()
  expect(categories![1]!.split(',').map(item => item.trim().replace(/"/g, ''))).toEqual(ROADMAP_CATEGORIES)

  expect(model).toContain(`static let maxImages = ${ITEM_ATTACHMENTS_MAX}`)
  expect(model).toContain(`maxImageBytes = ${ATTACHMENT_MAX_BYTES / 1024 / 1024} * 1024 * 1024`)
})

test('the app, the extension and the shared code name the same App Group', () => {
  const group = /static let group = "([^"]+)"/.exec(read('App/Core/SharedCredentials.swift'))?.[1]
  expect(group).toBeTruthy()
  for (const file of ['App/HelpBitesNative.entitlements', 'HelpBitesShare/HelpBitesShare.entitlements', 'project.yml']) {
    expect(read(file)).toContain(group!)
  }
})

test('the extension is in the Xcode project, with every source file, and activates on specific types', () => {
  const project = read('HelpBitesNative.xcodeproj/project.pbxproj')
  for (const file of readdirSync(join(native, 'HelpBitesShare'))) expect(project).toContain(file)
  expect(project).toContain('com.apple.product-type.app-extension')
  expect(project).toContain('SharedCredentials.swift in Sources')
  // A bare TRUEPREDICATE rule is rejected by App Review.
  expect(read('HelpBitesShare/Info.plist')).not.toContain('TRUEPREDICATE')
})
