import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS } from '../shared/email/blocks'
import {
  checkAttachments,
  composeEmail,
  parseAddressList,
  parseEmailHeaders,
  parseEmailMetadata,
  parseEmailRecipients,
  parseEmailSendRequest,
  parseEmailTags,
  parseJsonAttachments,
  parseMailbox,
  parseSendAt,
  resolveEmailContent,
  safeAttachmentName,
  type ResolvedContent
} from '../server/utils/emailSend'
import { projectEmailSender, redactEmailVariables, summarizeDeliveries } from '../server/utils/emailDelivery'

// Enough of a Parse row for brand lookups.
const row = (id: string, fields: Record<string, unknown>) => ({ id, get: (key: string) => fields[key], updatedAt: new Date(0) }) as any
const project = row('p1', { name: 'Acme', siteUrl: 'https://example.com', brandLogoUrl: 'https://example.com/logo.png', fromName: 'Acme team', fromEmail: 'hello@mail.example.com', mailDomain: 'mail.example.com', replyTo: 'hello@example.com' })
const sender = { fromName: 'Elias', fromEmail: 'hello@mail.example.com', domain: 'mail.example.com', replyTo: '' }
const status = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return (error as { statusCode?: number }).statusCode
  }
  return 0
}

describe('addresses', () => {
  test('bare and named mailboxes', () => {
    expect(parseMailbox('ada@example.com')).toEqual({ email: 'ada@example.com', name: '' })
    expect(parseMailbox('Ada Lovelace <ada@example.com>')).toEqual({ email: 'ada@example.com', name: 'Ada Lovelace' })
    expect(parseMailbox('"Doe, John" <j@example.com>')).toEqual({ email: 'j@example.com', name: 'Doe, John' })
    expect(parseMailbox('not an email')).toBeNull()
  })

  test('recipients: strings, objects with their own variables, deduplicated by address', () => {
    const list = parseEmailRecipients(['ada@example.com', 'ADA@example.com', { email: 'Bob <bob@example.com>', variables: { code: '42' } }])
    expect(list).toEqual([
      { email: 'ada@example.com', name: '', variables: {} },
      { email: 'bob@example.com', name: 'Bob', variables: { code: '42' } }
    ])
    expect(parseEmailRecipients('ada@example.com')).toHaveLength(1)
  })

  test('recipients: none, too many or a bad one is a 400', () => {
    expect(status(() => parseEmailRecipients(undefined))).toBe(400)
    expect(status(() => parseEmailRecipients(['ok@example.com', 'nope']))).toBe(400)
    expect(status(() => parseEmailRecipients(Array.from({ length: 51 }, (_, i) => `u${i}@example.com`)))).toBe(400)
  })

  test('cc and bcc keep names, as one string or a list', () => {
    expect(parseAddressList('a@example.com, Bo <b@example.com>', 'cc')).toEqual(['a@example.com', 'Bo <b@example.com>'])
    expect(status(() => parseAddressList(['x'], 'bcc'))).toBe(400)
  })
})

describe('headers, tags, metadata, schedule, attachments', () => {
  test('headers: custom ones pass, the ones HelpBites owns or broken ones do not', () => {
    expect(parseEmailHeaders({ 'List-Unsubscribe': '<{{unsubscribeUrl}}>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })).toEqual({ 'List-Unsubscribe': '<{{unsubscribeUrl}}>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
    expect(status(() => parseEmailHeaders({ From: 'x' }))).toBe(400)
    expect(status(() => parseEmailHeaders({ 'Reply-To': 'x@example.com' }))).toBe(400)
    expect(status(() => parseEmailHeaders({ 'X-Mailgun-Tag': 'x' }))).toBe(400)
    expect(status(() => parseEmailHeaders({ 'X-Evil': 'a\r\nBcc: victim@example.com' }))).toBe(400)
    expect(status(() => parseEmailHeaders({ 'bad header': 'x' }))).toBe(400)
  })

  test('tags and metadata', () => {
    expect(parseEmailTags('welcome, onboarding')).toEqual(['welcome', 'onboarding'])
    expect(status(() => parseEmailTags(['a', 'b', 'c', 'd']))).toBe(400)
    expect(parseEmailMetadata({ userId: 42, plan: 'pro', beta: true })).toEqual({ userId: '42', plan: 'pro', beta: 'true' })
    expect(status(() => parseEmailMetadata({ hb_batch: 'x' }))).toBe(400)
    expect(status(() => parseEmailMetadata({ 'a.b': 'x' }))).toBe(400)
    expect(status(() => parseEmailMetadata({ nested: { a: 1 } }))).toBe(400)
  })

  test('sendAt: past means now, more than three days ahead is refused', () => {
    const now = Date.parse('2026-10-03T12:00:00Z')
    expect(parseSendAt('2026-10-03T11:00:00Z', now)).toBeNull()
    expect(parseSendAt('2026-10-04T12:00:00Z', now)?.toISOString()).toBe('2026-10-04T12:00:00.000Z')
    expect(parseSendAt(String(now / 1000 + 3600), now)?.getTime()).toBe(now + 3600_000)
    expect(status(() => parseSendAt('2026-10-07T12:00:01Z', now))).toBe(400)
    expect(status(() => parseSendAt('tomorrow', now))).toBe(400)
  })

  test('attachments: base64 decoded, names made safe, size capped', () => {
    const [file] = parseJsonAttachments([{ filename: '../../etc/passwd.pdf', content: Buffer.from('hello').toString('base64') }])
    expect(file!.filename).toBe('passwd.pdf')
    expect(file!.contentType).toBe('application/pdf')
    expect(new TextDecoder().decode(file!.data)).toBe('hello')
    expect(safeAttachmentName('')).toBe('attachment')
    expect(status(() => parseJsonAttachments([{ filename: 'a.txt', content: 'not base64!' }]))).toBe(400)
    expect(status(() => checkAttachments([{ filename: 'big.bin', contentType: 'application/octet-stream', data: new Uint8Array(11 * 1024 * 1024) }]))).toBe(413)
  })
})

describe('parseEmailSendRequest', () => {
  test('exactly one kind of content', () => {
    expect(status(() => parseEmailSendRequest({ to: 'a@example.com' }, []))).toBe(400)
    expect(status(() => parseEmailSendRequest({ to: 'a@example.com', template: 'welcome', html: '<p>x</p>' }, []))).toBe(400)
    expect(parseEmailSendRequest({ to: 'a@example.com', template: 'welcome' }, []).content).toEqual({ type: 'template', ref: 'welcome' })
  })

  test('from accepts a name, a mailbox or an object; reply-to must be an address', () => {
    expect(parseEmailSendRequest({ to: 'a@example.com', html: 'x', from: 'Elias' }, []).from).toEqual({ name: 'Elias' })
    expect(parseEmailSendRequest({ to: 'a@example.com', html: 'x', from: 'Elias <noreply@mail.example.com>' }, []).from).toEqual({ name: 'Elias', email: 'noreply@mail.example.com' })
    expect(parseEmailSendRequest({ to: 'a@example.com', html: 'x', from: { email: 'x@mail.example.com' } }, []).from).toEqual({ email: 'x@mail.example.com' })
    expect(status(() => parseEmailSendRequest({ to: 'a@example.com', html: 'x', replyTo: 'nope' }, []))).toBe(400)
  })

  test('variables may be long (a pre-rendered list); recipient.* and project.* are not the caller\'s', () => {
    const req = parseEmailSendRequest({ to: 'a@example.com', html: 'x', variables: { list: 'x'.repeat(5000), 'recipient.email': 'spoof', 'project.name': 'spoof' } }, [])
    expect(req.variables.list).toHaveLength(5000)
    expect(Object.keys(req.variables)).toEqual(['list'])
  })
})

describe('composeEmail', () => {
  const base = (body: Record<string, unknown>) => parseEmailSendRequest({ to: { email: 'ada@example.com', name: 'Ada', variables: { unsubscribeUrl: 'https://x.test/u/ada' } }, ...body }, [])

  test('html: escaped and raw placeholders, brand and recipient values, per-recipient headers, title as subject', () => {
    const request = base({ html: '<title>Hi {{name}}</title><p>{{name}} from {{project.name}} to {{recipient.email}}</p><ul>{{{list}}}</ul>', variables: { name: '<Ada>', list: '<li>1</li>' }, headers: { 'List-Unsubscribe': '<{{unsubscribeUrl}}>' } })
    const content: ResolvedContent = { type: 'html', html: request.content.type === 'html' ? request.content.html : '' }
    const out = composeEmail(project, content, request, request.recipients[0]!, sender)
    expect(out.subject).toBe('Hi <Ada>')
    expect(out.html).toContain('<p>&lt;Ada&gt; from Acme to ada@example.com</p><ul><li>1</li></ul>')
    // The fragment's <title> moves into the document head instead of staying in the body.
    expect(out.html.match(/<title>/g)).toHaveLength(1)
    expect(out.html).toContain('<title>Hi &lt;Ada&gt;</title>')
    expect(out.headers).toEqual({ 'List-Unsubscribe': '<https://x.test/u/ada>' })
    expect(out.text).toContain('<Ada> from Acme to ada@example.com')
    expect(out.kind).toBe('html')
  })

  test('html: a fragment gets a document around it; no subject at all is a 400', () => {
    const request = base({ html: '<p>Hello</p>', subject: 'Hello {{recipient.name}}' })
    const out = composeEmail(project, { type: 'html', html: '<p>Hello</p>' }, request, request.recipients[0]!, sender)
    expect(out.subject).toBe('Hello Ada')
    expect(out.html).toContain('<meta charset="utf-8">')
    expect(out.html).toContain('<title>Hello Ada</title>')
    const bare = base({ html: '<p>Hello</p>' })
    expect(status(() => composeEmail(project, { type: 'html', html: '<p>Hello</p>' }, bare, bare.recipients[0]!, sender))).toBe(400)
  })

  test('document: the editor\'s blocks, with the project brand', () => {
    const document = { settings: { ...DEFAULT_SETTINGS, title: 'Welcome to {{project.name}}', text: 'Hi {{recipient.name}}' }, blocks: [{ id: 'h', type: 'heading', text: 'Hi {{recipient.name}}', level: 1, align: 'left' }] }
    const request = base({ document })
    const out = composeEmail(project, { type: 'document', document: document as any }, request, request.recipients[0]!, sender)
    expect(out.subject).toBe('Welcome to Acme')
    expect(out.html).toContain('Hi Ada</h1>')
    expect(out.text).toBe('Hi Ada')
  })

  test('document: a partial one from a caller is filled out, sections and components included', async () => {
    const document = { settings: { title: 'Hi' }, blocks: [{ type: 'section', background: '#111111', blocks: [{ type: 'component', html: '<b>{{@who}}</b>', fields: [{ key: 'who' }], values: { who: '{{recipient.name}}' } }] }, { type: 'marquee' }] }
    const request = base({ document })
    const content = await resolveEmailContent(project, { type: 'document', document } as any)
    const out = composeEmail(project, content, request, request.recipients[0]!, sender)
    expect(out.html).toContain('font-family:-apple-system')
    expect(out.html).toContain('background-color:#111111;')
    expect(out.html).toContain('<b>Ada</b>')
  })

  test('message: plain text in the project layout, escaped', () => {
    const request = base({ message: { subject: 'About your icon', body: 'Thanks <3\n\nIt is live.', ctaUrl: 'https://example.com/u/{{recipient.name}}' } })
    const content: ResolvedContent = request.content.type === 'message' ? request.content : (null as any)
    const out = composeEmail(project, content, request, request.recipients[0]!, sender)
    expect(out.subject).toBe('About your icon')
    expect(out.html).toContain('Thanks &lt;3')
    expect(out.html).toContain('https://example.com/u/Ada')
    expect(out.html).toContain('Acme')
    expect(out.text).toContain('Hi Ada,')
  })
})

describe('sender and log hygiene', () => {
  test('the project\'s sender, with name and reply-to overridable and the address held to its domain', () => {
    expect(projectEmailSender(project)).toEqual({ fromName: 'Acme team', fromEmail: 'hello@mail.example.com', domain: 'mail.example.com', replyTo: 'hello@example.com' })
    expect(projectEmailSender(project, { fromName: 'Elías', fromEmail: 'noreply@mail.example.com' })).toMatchObject({ fromName: 'Elías', fromEmail: 'noreply@mail.example.com' })
    expect(status(() => projectEmailSender(project, { fromEmail: 'ceo@bank.example' }))).toBe(400)
  })

  test('values that unlock something never reach the log; long ones are cut', () => {
    expect(redactEmailVariables({ link: 'https://x.test/reset?t=1', inviteCode: 'ABCD', firstName: 'Ada', resetUrl: 'u', bodyHtml: 'x'.repeat(400) })).toEqual([
      { key: 'link', value: '[redacted]' },
      { key: 'inviteCode', value: '[redacted]' },
      { key: 'firstName', value: 'Ada' },
      { key: 'resetUrl', value: '[redacted]' },
      { key: 'bodyHtml', value: `${'x'.repeat(300)}…` }
    ])
  })

  test('a batch summary keeps the old { sent, failed } shape', () => {
    const summary = summarizeDeliveries('eb_1', [
      { to: 'a@example.com', status: 'sent', logId: 'l1', messageId: 'm1', error: '' },
      { to: 'b@example.com', status: 'failed', logId: 'l2', messageId: '', error: 'Mailgun 400' },
      { to: 'c@example.com', status: 'suppressed', logId: 'l3', messageId: '', error: 'On the suppression list (bounce)' }
    ])
    expect(summary).toMatchObject({ id: 'eb_1', sent: 1, failed: ['b@example.com'], suppressed: ['c@example.com'] })
    expect(summary.results[0]).toEqual({ to: 'a@example.com', status: 'sent', logId: 'l1', messageId: 'm1' })
  })
})
