import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONVERSATION_CHANNELS } from '../shared/support'
import { INBOUND_KINDS } from '../shared/inboundEmail'

// The native app hand-ports what an inbound address and a conversation's channel look like.

const native = (path: string) => readFileSync(join(import.meta.dir, '../helpbites-native/App', path), 'utf8')
const addresses = native('Features/Email/InboundAddresses.swift')

describe('native inbound email parity', () => {
  test('the Swift address decodes every field the server sends', () => {
    for (const key of ['id', 'kind', 'address', 'publicAddress', 'fromName', 'state', 'mxRecords', 'forwardingDomain']) expect(addresses).toContain(key)
    expect(addresses).toContain('struct InboundMxRecord: Decodable, Equatable, Sendable { let type, host, value: String; let priority: Int }')
  })

  test('it offers the same kinds', () => {
    for (const kind of INBOUND_KINDS) expect(addresses).toContain(`"${kind}"`)
  })

  test('the Conversation model knows its channel, and the inbox filters by each', () => {
    expect(native('Core/Models.swift')).toContain('let channel: String?')
    const store = native('Features/Inbox/InboxStore.swift')
    expect(store).toContain('query["channel"] = channelFilter')
    const screen = native('Features/Inbox/InboxScreen.swift')
    for (const channel of CONVERSATION_CHANNELS) expect(screen).toContain(`.tag("${channel}")`)
  })
})
