import { describe, expect, test } from 'bun:test'
import { redactSecrets, REDACTED } from '../server/utils/mcp/redact'
import { withoutSubscribing } from '../server/utils/mcp/consent'
import { handleMcpBody, type McpCall } from '../server/utils/mcp/protocol'

describe('what a tool answer never carries', () => {
  test('credential keys are cut wherever they sit', () => {
    const answer = redactSecrets({
      templates: [{ id: 'T1', subject: 'Hi', shareToken: 'abc123', share: { mode: 'view', shareToken: 'def456' } }],
      webhook: { url: 'https://x.example/hook', token: 'kept: the tool asked for it' },
      assistant: { hasApiKey: true, apiKey: 'sk-live-xyz' },
      dsn: 'https://pub@errors.example/1'
    }) as any
    expect(answer.templates[0].shareToken).toBe(REDACTED)
    expect(answer.templates[0].share.shareToken).toBe(REDACTED)
    expect(answer.assistant).toEqual({ hasApiKey: true, apiKey: REDACTED })
    expect(answer.dsn).toBe(REDACTED)
    expect(answer.templates[0].subject).toBe('Hi')
  })

  test('a credential inside a URL is blanked, the rest of the URL stays', () => {
    const url = redactSecrets('https://help.example/v1/webhooks/bugsink/p1?token=9f8e7d6c5b4a&mode=alert') as string
    expect(url).toBe(`https://help.example/v1/webhooks/bugsink/p1?token=${REDACTED}&mode=alert`)
    expect(redactSecrets('see https://x.example/a?page=2&q=token')).toBe('see https://x.example/a?page=2&q=token')
  })

  test('values that are not credentials pass through unchanged', () => {
    const value = { n: 3, ok: true, none: null, list: ['a', { b: 1 }], secret: { nested: 'object kept: only strings and numbers are cut' } }
    expect(redactSecrets(value)).toEqual(value)
    expect(redactSecrets(undefined)).toBeUndefined()
  })

  test('a very deep answer is not walked forever', () => {
    let deep: unknown = 'x'
    for (let i = 0; i < 500; i++) deep = { child: deep }
    expect(() => redactSecrets(deep)).not.toThrow()
  })

  test('a signing secret in any answer never reaches the assistant', async () => {
    const call: McpCall = async () => ({ status: 200, data: { endpoint: { id: 'W1', url: 'https://hook.example/in', events: ['*'], secret: 'whsec_9f8e7d6c5b4a3210' } } })
    const answer = await handleMcpBody({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects' } }, call) as any
    const text = answer.result.content[0].text as string
    expect(text).not.toContain('whsec_')
    expect(JSON.parse(text).endpoint).toMatchObject({ id: 'W1', url: 'https://hook.example/in', secret: REDACTED })
  })

  test('the protocol applies it to every successful answer', async () => {
    const call: McpCall = async () => ({ status: 200, data: { template: { id: 'T1', shareToken: 'abc123' }, alertWebhookUrl: 'https://h.example/v1/webhooks/bugsink/p?token=abcdef' } })
    const answer = await handleMcpBody({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects' } }, call) as any
    const text = answer.result.content[0].text as string
    expect(text).not.toContain('abc123')
    expect(text).not.toContain('abcdef')
    expect(text).toContain(REDACTED)
  })
})

describe('an assistant never subscribes anyone', () => {
  test('a single contact keeps unsubscribed and loses the rest', () => {
    expect(withoutSubscribing({ email: 'a@x.example', subscription: 'subscribed', resubscribe: true, unsubscribedTopics: ['news'] })).toEqual({ email: 'a@x.example' })
    expect(withoutSubscribing({ email: 'a@x.example', subscription: 'unsubscribed' })).toEqual({ email: 'a@x.example', subscription: 'unsubscribed' })
    expect(withoutSubscribing({ email: 'a@x.example', subscription: 'none' })).toEqual({ email: 'a@x.example' })
  })

  test('every item of a batch is cleaned, whatever else is in it', () => {
    const body = withoutSubscribing({ contacts: [{ email: 'a@x.example', subscription: 'subscribed' }, { email: 'b@x.example', resubscribe: true, tags: ['vip'] }, 'junk', null, { email: 'c@x.example', subscription: 'unsubscribed' }], fillOnly: true })
    expect(body.contacts).toEqual([{ email: 'a@x.example' }, { email: 'b@x.example', tags: ['vip'] }, 'junk', null, { email: 'c@x.example', subscription: 'unsubscribed' }])
    expect(body.fillOnly).toBe(true)
  })

  test('a body without contacts, or with the wrong shape, does not throw', () => {
    expect(() => withoutSubscribing({})).not.toThrow()
    expect(() => withoutSubscribing({ contacts: 'nope' })).not.toThrow()
    expect(() => withoutSubscribing({ contacts: { 0: { subscription: 'subscribed' } } })).not.toThrow()
  })
})

describe('a read-only connection', () => {
  const ok: McpCall = async request => ({ status: 200, data: { seen: request.url } })

  test('is offered only the tools that read', async () => {
    const all = await handleMcpBody({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ok) as any
    const some = await handleMcpBody({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ok, { readOnly: true }) as any
    expect(some.result.tools.length).toBeGreaterThan(20)
    expect(some.result.tools.length).toBeLessThan(all.result.tools.length)
    expect(some.result.tools.every((t: any) => t.annotations.readOnlyHint === true)).toBe(true)
  })

  test('cannot call a tool that changes something, and is told why', async () => {
    let called = false
    const call: McpCall = async () => { called = true; return { status: 200, data: {} } }
    const refused = await handleMcpBody({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'reply_to_conversation', arguments: { id: 'c1', body: 'Hi' } } }, call, { readOnly: true }) as any
    expect(called).toBe(false)
    expect(refused.result.isError).toBe(true)
    expect(refused.result.content[0].text).toContain('read-only')
    const read = await handleMcpBody({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_conversation', arguments: { id: 'c1' } } }, call, { readOnly: true }) as any
    expect(called).toBe(true)
    expect(read.result.isError).toBe(false)
  })

  test('says so in its instructions, and a normal connection does not', async () => {
    const some = await handleMcpBody({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, ok, { readOnly: true }) as any
    const all = await handleMcpBody({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, ok) as any
    expect(some.result.instructions).toContain('read-only')
    expect(all.result.instructions).not.toContain('read-only')
  })
})
