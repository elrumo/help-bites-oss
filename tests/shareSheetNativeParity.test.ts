import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROADMAP_CATEGORIES } from '../shared/board'
import { BOARD_PUBLIC_MAX, BOARD_PUBLIC_RULES, BOARD_TITLE_DEBOUNCE_MS, BOARD_TITLE_INPUT_MAX, BOARD_TITLE_MAX, BOARD_TITLE_RULES, boardPublicPrompt, fallbackBoardTitle } from '../shared/boardTitle'
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

test('the native title helpers match shared/boardTitle.ts', () => {
  const swift = read('App/Core/BoardTitle.swift')
  expect(swift).toContain(`static let maxLength = ${BOARD_TITLE_MAX}`)
  expect(swift).toContain(`static let debounce = ${BOARD_TITLE_DEBOUNCE_MS / 1000}`)
  // The fallback cuts at 80 characters, not before the 40th, and ends with an ellipsis: the same as the TypeScript one.
  expect(swift).toContain('line.count <= 80')
  expect(swift).toContain('max(space, 40)')
  expect(fallbackBoardTitle('word '.repeat(40)).endsWith('…')).toBe(true)
  const project = read('HelpBitesNative.xcodeproj/project.pbxproj')
  expect(project.match(/BoardTitle\.swift in Sources/g)?.length).toBe(4) // the app and the extension, each a build file and a phase entry
  expect(read('project.yml')).toContain('App/Core/BoardTitle.swift')
})

test('Apple Intelligence on the device writes titles by the server\'s rules', () => {
  const swift = read('App/Core/BoardTitle.swift')
  // Swift string literals escape quotes as JSON does.
  for (const rule of BOARD_TITLE_RULES) expect(swift).toContain(JSON.stringify(rule))
  expect(swift).toContain(`static let inputMax = ${BOARD_TITLE_INPUT_MAX}`)
})

test('Apple Intelligence on the device writes public descriptions by the server\'s rules and prompt', () => {
  const swift = read('App/Core/BoardTitle.swift')
  for (const rule of BOARD_PUBLIC_RULES) expect(swift).toContain(JSON.stringify(rule))
  expect(swift).toContain(`static let publicMax = ${BOARD_PUBLIC_MAX}`)
  // The prompt's shape: "Title: …\nDescription:\n…", as boardPublicPrompt writes it.
  expect(boardPublicPrompt('T', 'D')).toBe('Title: T\nDescription:\nD')
  expect(swift).toContain('"Title: \\(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxLength))\\nDescription:\\n"')
})

test('the share sheet compiles the offline outbox and response cache the app reads', () => {
  const project = read('HelpBitesNative.xcodeproj/project.pbxproj')
  for (const file of ['JSONValue.swift', 'PlanningOutbox.swift', 'ResponseCache.swift']) {
    expect(read('project.yml')).toContain(`App/Core/${file}`)
    expect(project.match(new RegExp(`${file.replace('.', '\\.')} in Sources`, 'g'))?.length).toBe(4)
  }
})

test('the public description AI strings are in both string catalogs, translated', () => {
  const sources = { 'App/Localizable.xcstrings': ['App/Features/Board/BoardItemEditor.swift', 'App/Features/Board/BoardScreen.swift'], 'HelpBitesShare/Localizable.xcstrings': ['HelpBitesShare/ShareView.swift', 'HelpBitesShare/ShareModel.swift'] }
  const keys = ['Write the public description with AI', 'Writing the public description…', 'The server can\'t be reached, and Apple Intelligence isn\'t available on this device to write the public description.']
  for (const [catalog, files] of Object.entries(sources)) {
    const strings = JSON.parse(read(catalog)).strings
    const code = files.map(read).join('\n')
    for (const key of keys) {
      expect(code, `${key} is no longer in ${files.join(', ')}`).toContain(`"${key}"`)
      for (const locale of ['ca', 'es', 'ja', 'ko', 'zh-Hans']) expect(strings[key]?.localizations?.[locale]?.stringUnit?.value, `${catalog}: "${key}" has no ${locale}`).toBeTruthy()
    }
  }
})
