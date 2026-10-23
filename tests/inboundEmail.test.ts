import { describe, expect, test } from 'bun:test'
import { bodyOf, cleanSubject, headerMap, isAutoReply, messageIds, mxPointsAtProvider, normalizeMessageId, providerMxRecords, replyAddress, splitAddress, threadTag } from '../shared/inboundEmail'

describe('addresses', () => {
  test('splitAddress keeps a plain, lower-case local part on a public domain', () => {
    expect(splitAddress('Support@Mail.Example.com')).toEqual({ local: 'support', domain: 'mail.example.com', address: 'support@mail.example.com' })
    expect(splitAddress('Acme <help+c_abc@example.com>')).toEqual({ local: 'help', domain: 'example.com', address: 'help@example.com' })
    for (const bad of ['', 'nope', '@example.com', 'a@localhost', 'a b@example.com', 'a@example']) expect(splitAddress(bad)).toBeNull()
  })

  test('the conversation id rides in the +tag and comes back with its case', () => {
    const sent = replyAddress('support@example.com', 'AbC123xyz9')
    expect(sent).toBe('support+c_AbC123xyz9@example.com')
    expect(threadTag(sent)).toEqual({ address: 'support@example.com', conversationId: 'AbC123xyz9' })
    expect(threadTag('Support <support@example.com>')).toEqual({ address: 'support@example.com', conversationId: '' })
    expect(replyAddress('support@example.com', 'not an id')).toBe('support@example.com')
  })
})

describe('threading ids', () => {
  test('normalizeMessageId and messageIds read angle-bracket ids', () => {
    expect(normalizeMessageId('  <abc@mail.example.com> ')).toBe('<abc@mail.example.com>')
    expect(normalizeMessageId('abc')).toBe('')
    expect(messageIds('<a@x>', '<b@x> <c@x> <a@x>')).toEqual(['a@x', 'c@x', 'b@x'].map(id => `<${id}>`))
  })
})

describe('isAutoReply', () => {
  const human = { subject: 'Help' }
  test('a person writing is not one', () => {
    expect(isAutoReply(human, 'jo@example.com')).toBe(false)
    expect(isAutoReply({ 'auto-submitted': 'no' }, 'jo@example.com')).toBe(false)
  })

  test('bounces, out-of-office, lists and bulk mail are', () => {
    expect(isAutoReply(human, 'MAILER-DAEMON@example.com')).toBe(true)
    expect(isAutoReply(human, '')).toBe(true)
    expect(isAutoReply({ 'auto-submitted': 'auto-replied' }, 'jo@example.com')).toBe(true)
    expect(isAutoReply({ precedence: 'bulk' }, 'jo@example.com')).toBe(true)
    expect(isAutoReply({ 'list-id': '<news.example.com>' }, 'jo@example.com')).toBe(true)
    expect(isAutoReply({ 'x-autoreply': 'yes' }, 'jo@example.com')).toBe(true)
    expect(isAutoReply({ 'x-auto-response-suppress': 'DR, OOF, AutoReply' }, 'jo@example.com')).toBe(true)
  })
})

describe('message parts', () => {
  test('headerMap reads Mailgun\'s [name, value] list, names lower-cased', () => {
    expect(headerMap(JSON.stringify([['Message-Id', '<a@x>'], ['In-Reply-To', '<b@x>']]))).toEqual({ 'message-id': '<a@x>', 'in-reply-to': '<b@x>' })
    expect(headerMap('not json')).toEqual({})
  })

  test('bodyOf prefers the text without the quoted reply', () => {
    expect(bodyOf({ 'stripped-text': ' Thanks! ', 'body-plain': 'Thanks!\n> old' })).toBe('Thanks!')
    expect(bodyOf({ 'stripped-text': '', 'body-plain': 'Only this\r\nline' })).toBe('Only this\nline')
  })

  test('cleanSubject drops reply prefixes', () => {
    expect(cleanSubject('Re: RE: Fwd: Billing question')).toBe('Billing question')
  })
})

test('MX hosts that reach the provider', () => {
  expect(mxPointsAtProvider(['mxa.eu.mailgun.org.', 'mxb.eu.mailgun.org'])).toBe(true)
  expect(mxPointsAtProvider(['aspmx.l.google.com'])).toBe(false)
  expect(providerMxRecords('mail.example.com', 'https://api.eu.mailgun.net').map(r => r.value)).toEqual(['mxa.eu.mailgun.org', 'mxb.eu.mailgun.org'])
  expect(providerMxRecords('mail.example.com', 'https://api.mailgun.net')[0]!.value).toBe('mxa.mailgun.org')
})
