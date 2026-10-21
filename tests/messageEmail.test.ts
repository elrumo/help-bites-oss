/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'
import {
  buildPreheader,
  escapeHtml,
  normalizeSubject,
  renderCtaBlock,
  renderMessageBodyHtml,
  renderMessageEmail,
  resolveGreeting
} from '../server/utils/messageEmail'

describe('escapeHtml', () => {
  test('escapes every character that can break out of HTML context', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    )
  })

  test('escapes ampersands before the entities it introduces', () => {
    // Ordering regression: escaping `<` first would turn `&lt;` into `&amp;lt;`.
    expect(escapeHtml('a & b < c')).toBe('a &amp; b &lt; c')
  })

  test('renders null and undefined as an empty string', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('renderMessageBodyHtml', () => {
  test('splits blank-line separated text into paragraphs', () => {
    const html = renderMessageBodyHtml('First para.\n\nSecond para.')
    expect(html.match(/<p /g)?.length).toBe(2)
    expect(html).toContain('First para.')
    expect(html).toContain('Second para.')
  })

  test('turns single newlines into line breaks inside one paragraph', () => {
    const html = renderMessageBodyHtml('line one\nline two')
    expect(html.match(/<p /g)?.length).toBe(1)
    expect(html).toContain('line one<br />line two')
  })

  test('escapes markup in the body', () => {
    expect(renderMessageBodyHtml('<b>hi</b>')).toContain('&lt;b&gt;hi&lt;/b&gt;')
    expect(renderMessageBodyHtml('<b>hi</b>')).not.toContain('<b>hi</b>')
  })

  test('normalizes CRLF so Windows-authored replies do not double-space', () => {
    const html = renderMessageBodyHtml('a\r\nb')
    expect(html).toContain('a<br />b')
  })

  test('returns an empty string for blank input', () => {
    expect(renderMessageBodyHtml('   \n  ')).toBe('')
    expect(renderMessageBodyHtml(undefined)).toBe('')
  })
})

describe('renderCtaBlock', () => {
  test('renders a button for an https url', () => {
    const block = renderCtaBlock('https://example.com/messages', 'Open your inbox')
    expect(block).toContain('href="https://example.com/messages"')
    expect(block).toContain('Open your inbox')
  })

  test('drops non-http(s) schemes', () => {
    expect(renderCtaBlock('javascript:alert(1)', 'Click')).toBe('')
    expect(renderCtaBlock('mailto:hi@example.com', 'Click')).toBe('')
    expect(renderCtaBlock('data:text/html,<h1>x</h1>', 'Click')).toBe('')
  })

  test('drops unparseable and empty urls', () => {
    expect(renderCtaBlock('not a url', 'Click')).toBe('')
    expect(renderCtaBlock('', 'Click')).toBe('')
    expect(renderCtaBlock(undefined, undefined)).toBe('')
  })

  test('falls back to a default label', () => {
    expect(renderCtaBlock('https://example.com', '', 'WebBites')).toContain('Open WebBites')
  })

  test('escapes the label', () => {
    const block = renderCtaBlock('https://example.com', '<b>go</b>')
    expect(block).toContain('&lt;b&gt;go&lt;/b&gt;')
  })
})

describe('resolveGreeting', () => {
  test('uses the first name only', () => {
    expect(resolveGreeting('Ada Lovelace')).toBe('Hi Ada,')
  })

  test('falls back when there is no name', () => {
    expect(resolveGreeting('')).toBe('Hi there,')
    expect(resolveGreeting(undefined)).toBe('Hi there,')
    expect(resolveGreeting('   ')).toBe('Hi there,')
  })
})

describe('normalizeSubject', () => {
  test('collapses whitespace', () => {
    expect(normalizeSubject('  Re:   your    report ')).toBe('Re: your report')
  })

  test('falls back for an empty subject', () => {
    expect(normalizeSubject('', 'Elías')).toBe('A message from Elías')
  })

  test('caps the length', () => {
    expect(normalizeSubject('x'.repeat(500)).length).toBe(200)
  })
})

describe('buildPreheader', () => {
  test('flattens the body', () => {
    expect(buildPreheader('one\n\ntwo')).toBe('one two')
  })

  test('truncates long bodies with an ellipsis', () => {
    const preheader = buildPreheader('y'.repeat(400))
    expect(preheader.length).toBe(140)
    expect(preheader.endsWith('…')).toBe(true)
  })

  test('falls back for an empty body', () => {
    expect(buildPreheader('', 'Elías')).toBe('You have a new message from Elías')
  })
})

describe('renderMessageEmail', () => {
  test('fills every placeholder in the template', () => {
    const { html } = renderMessageEmail({
      recipientName: 'Ada',
      subject: 'Re: your report',
      body: 'The icon has been removed.',
      ctaUrl: 'https://example.com/messages',
      ctaLabel: 'Open your inbox'
    })

    expect(html).not.toMatch(/\{\{\w+\}\}/)
    expect(html).toContain('Re: your report')
    expect(html).toContain('Hi Ada,')
    expect(html).toContain('The icon has been removed.')
    expect(html).toContain('https://example.com/messages')
  })

  test('renders without a call to action when no url is given', () => {
    const { html } = renderMessageEmail({ body: 'No link here.' })
    expect(html).not.toMatch(/\{\{\w+\}\}/)
    expect(html).not.toContain('background-color: #2563eb')
  })

  test('never re-expands a placeholder that appears inside substituted text', () => {
    // Single-pass substitution regression: a subject containing a token must
    // survive verbatim (escaped) rather than pulling the body in twice.
    const { html } = renderMessageEmail({
      subject: '{{bodyHtml}}',
      body: 'unique-body-marker'
    })

    // The token in the subject is emitted verbatim rather than expanded, so the
    // body renders exactly once as a paragraph (it also appears once more in
    // the hidden preheader, which is derived from the body by design).
    expect(html).toContain('{{bodyHtml}}')
    expect(html.match(/<p [^>]*>unique-body-marker<\/p>/g)?.length).toBe(1)
    expect(html.match(/unique-body-marker/g)?.length).toBe(2)
  })

  test('returns the normalized subject alongside the html', () => {
    const { subject } = renderMessageEmail({ body: 'hi' })
    expect(subject).toBe('A message from the team')
  })

  test('builds a plain-text alternative that keeps the raw body', () => {
    const { text } = renderMessageEmail({
      recipientName: 'Ada Lovelace',
      body: '<not escaped here>',
      ctaUrl: 'https://example.com/messages',
      ctaLabel: 'Open your inbox'
    })

    expect(text).toContain('Hi Ada,')
    expect(text).toContain('<not escaped here>')
    expect(text).toContain('Open your inbox: https://example.com/messages')
  })

  test('the greeting and the small print are a conversation reply\'s unless the mail says otherwise', () => {
    const plain = renderMessageEmail({ appName: 'Acme <Co>', body: 'Hello' })
    expect(plain.html).toContain('You can reply to this conversation from your Acme &lt;Co&gt; inbox.')
    expect(plain.html).toContain('You are receiving this because you have a Acme &lt;Co&gt; account.')
    const own = renderMessageEmail({ appName: 'Acme', recipientName: 'Ana', body: 'Confirma', greeting: 'Hola, Ana:', note: '', reason: 'Recibes este <correo>.' })
    expect(own.html).toContain('Hola, Ana:')
    expect(own.html).not.toContain('Hi Ana')
    expect(own.html).not.toContain('reply to this conversation')
    expect(own.html).toContain('Recibes este &lt;correo&gt;.')
    expect(own.text.startsWith('Hola, Ana:')).toBe(true)
  })
})
