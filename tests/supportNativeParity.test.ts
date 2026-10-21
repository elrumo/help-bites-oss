import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { billingFromAttributes } from '../shared/conversationHub'
import { eventLabel } from '../shared/conversations'
import {
  REPLY_FALLBACK_NAME,
  SAVED_REPLIES_PER_PROJECT,
  SAVED_REPLY_BODY_MAX_LENGTH,
  SAVED_REPLY_PLACEHOLDERS,
  SAVED_REPLY_SHORTCUT_MAX_LENGTH,
  SAVED_REPLY_TITLE_MAX_LENGTH,
  fillSavedReply
} from '../shared/savedReplies'
import type { Message } from '../shared/support'

// The native inbox hand-ports the saved-reply fill rule, the limits, the timeline
// wording and the shapes of the customer panel. There is no Swift compiler in CI, so this
// keeps the copies in step: the Swift regex is lifted out of the source and run here.

const root = join(import.meta.dir, '..')
const inbox = (name: string) => readFileSync(join(root, 'helpbites-native/App/Features/Inbox', name), 'utf8')
const replies = inbox('SavedReplies.swift')
const hub = inbox('InboxHub.swift')

/** The value of a Swift string constant, with its escapes read back (`"\\s"` is `\s`). */
function swiftString(source: string, declaration: string): string {
  const match = source.match(new RegExp(`${declaration}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`))
  if (!match) throw new Error(`${declaration} not found in the Swift source`)
  return match[1]!.replace(/\\(.)/g, '$1')
}

describe('native saved replies', () => {
  test('the fill rule: same regex, same fallback, same first word', () => {
    expect(swiftString(replies, 'static let fallbackName')).toBe(REPLY_FALLBACK_NAME)
    for (const placeholder of SAVED_REPLY_PLACEHOLDERS) expect(replies).toContain(JSON.stringify(placeholder))
    expect(replies).toContain('split(whereSeparator: \\.isWhitespace)')

    // Swift's NSRegularExpression with .caseInsensitive, run here as the JS equivalent.
    const pattern = new RegExp(swiftString(replies, 'private static let pattern'), 'gi')
    const swiftFill = (body: string, name: string | null) => {
      const first = (name ?? '').trim().split(/\s+/)[0] || REPLY_FALLBACK_NAME
      const full = (name ?? '').trim() || REPLY_FALLBACK_NAME
      return body.replace(pattern, (_whole, key: string) => key.toLowerCase() === 'firstname' ? first : full)
    }
    const bodies = ['Hi {{firstName}}, I am {{name}}.', '{{ FIRSTNAME }}{{name}}', 'Use {{code}} and {name} and {{firstName}}', '{{firstName', 'no placeholders', '{{name}}{{name}}', '{{ first Name }}']
    const names: (string | null)[] = ['Ada Lovelace', '  Mary  Jane ', '', '   ', null, 'Cher']
    for (const body of bodies) for (const name of names) expect(swiftFill(body, name)).toBe(fillSavedReply(body, { name }))
  })

  test('the limits are the server\'s', () => {
    const limits = replies.slice(replies.indexOf('enum SavedReplyLimits'), replies.indexOf('}', replies.indexOf('enum SavedReplyLimits')))
    expect(limits).toMatch(new RegExp(`title = ${SAVED_REPLY_TITLE_MAX_LENGTH}\\b`))
    expect(limits).toMatch(new RegExp(`body = ${SAVED_REPLY_BODY_MAX_LENGTH}\\b`))
    expect(limits).toMatch(new RegExp(`shortcut = ${SAVED_REPLY_SHORTCUT_MAX_LENGTH}\\b`))
    expect(limits).toMatch(new RegExp(`perProject = ${SAVED_REPLIES_PER_PROJECT}\\b`))
  })
})

describe('native customer panel', () => {
  test('the timeline says the same about feedback links', () => {
    const event = (type: string) => ({ kind: 'event', event: { type, number: 12, title: 'Export CSV' } }) as unknown as Message
    const conversation = inbox('InboxConversation.swift')
    for (const [type, wording] of [['feedback.linked', 'Linked to feedback post'], ['feedback.unlinked', 'Unlinked from feedback post']] as const) {
      expect(eventLabel(event(type))).toStartWith(wording)
      expect(conversation).toContain(JSON.stringify(type))
      expect(conversation).toContain(wording)
    }
  })

  test('the Swift models carry every field of the server\'s billing and post shapes', () => {
    const billing = billingFromAttributes({ stripe_customer: 'cus_1' }, 'usd')!
    for (const key of Object.keys(billing)) expect(hub).toContain(key)
    for (const key of ['id', 'number', 'title', 'status', 'statusLabel', 'statusCategory', 'following', 'feedbackPosts', 'pastConversations', 'faqModels', 'defaultModelId', 'feedbackPostIds', 'draft', 'sources', 'faqId']) expect(hub).toContain(key)
    expect(readFileSync(join(root, 'helpbites-native/App/Core/Models.swift'), 'utf8')).toContain('feedbackPostIds')
  })

  test('every route the native app calls exists', () => {
    const swift = [hub, replies, inbox('InboxStore.swift'), inbox('FeedbackLinksSection.swift')].join('\n')
    const routes: [string, string][] = [
      ['/context', 'server/routes/v1/admin/conversations/[id]/context.get.ts'],
      ['/feedback-posts', 'server/routes/v1/admin/conversations/[id]/feedback-posts.post.ts'],
      ['/faq', 'server/routes/v1/admin/conversations/[id]/faq.post.ts'],
      ['/draft', 'server/routes/v1/admin/conversations/[id]/draft.post.ts'],
      ['/suggestions', 'server/routes/v1/admin/conversations/[id]/suggestions.get.ts'],
      ['/v1/admin/saved-replies', 'server/routes/v1/admin/saved-replies/index.get.ts']
    ]
    for (const [path, file] of routes) {
      expect(swift).toContain(path)
      expect(existsSync(join(root, file))).toBe(true)
    }
  })
})
