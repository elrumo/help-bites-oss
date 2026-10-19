import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, type EmailDocument } from '../shared/email/blocks'
import { applyTemplateVariables, extractTemplateVariables, fillPlaceholders, placeholderKeys } from '../shared/email/placeholders'
import { renderEmailHtml } from '../shared/email/render'
import { htmlToText, plainTextFor, resolveTemplate } from '../shared/email/resolve'

const doc = (): EmailDocument => ({
  settings: { ...DEFAULT_SETTINGS, title: 'Hi {{name}}', preheader: '{{name}} has news', text: 'Hi {{name}},\n{{{list}}}' },
  blocks: [
    { id: 'h', type: 'heading', text: 'Hello {{name}}', level: 1, align: 'left' },
    { id: 't', type: 'text', html: 'From {{name}}', align: 'left' },
    { id: 'raw', type: 'html', html: '<p>{{name}}</p><ul>{{{list}}}</ul><a href="{{url}}">Go</a>' },
    { id: 'cols', type: 'columns', columns: [[{ id: 'inner', type: 'html', html: '<b>{{name}}</b>' }], []] }
  ]
})

const vars = { name: '<b>Ada</b> & co', list: '<li>One</li>', url: 'https://x.test/?a=1&b=2' }

describe('placeholders', () => {
  test('in custom HTML, {{key}} is escaped and {{{key}}} is raw', () => {
    const out = applyTemplateVariables(doc(), vars)
    const raw = out.blocks[2] as { html: string }
    expect(raw.html).toBe('<p>&lt;b&gt;Ada&lt;/b&gt; &amp; co</p><ul><li>One</li></ul><a href="https://x.test/?a=1&amp;b=2">Go</a>')
    // Nested html blocks inside columns follow the same rule.
    expect(JSON.stringify(out.blocks[3])).toContain('&lt;b&gt;Ada')
  })

  test('other fields fill in unescaped: the renderer escapes or sanitizes them', () => {
    const out = applyTemplateVariables(doc(), vars)
    expect((out.blocks[0] as { text: string }).text).toBe('Hello <b>Ada</b> & co')
    expect(out.settings.title).toBe('Hi <b>Ada</b> & co')
    expect(out.settings.text).toBe('Hi <b>Ada</b> & co,\n<li>One</li>')
    const html = renderEmailHtml(out)
    expect(html).toContain('Hello &lt;b&gt;Ada&lt;/b&gt; &amp; co</h1>')
    expect(html).not.toContain('<b>Ada</b> &amp; co</p>')
  })

  test('unknown keys stay visible, in both forms', () => {
    expect(fillPlaceholders('{{a}} {{{b}}} {{ c }}', { c: 'C' }, { html: true })).toBe('{{a}} {{{b}}} C')
  })

  test('both forms count as variables', () => {
    expect(extractTemplateVariables(doc())).toEqual(['list', 'name', 'url'])
    expect(placeholderKeys('{{{ raw }}} and {{ plain }} and {{plain}}')).toEqual(['raw', 'plain'])
  })

  test('a value that looks like a placeholder is never expanded again', () => {
    expect(fillPlaceholders('{{a}}', { a: '{{b}}', b: 'nope' })).toBe('{{b}}')
  })
})

describe('plain-text part', () => {
  test('a template\'s own text version wins over the generated one', () => {
    const { document } = resolveTemplate({ name: 'x', document: doc(), variables: [] }, { values: vars })
    expect(plainTextFor(document, renderEmailHtml(document))).toBe('Hi <b>Ada</b> & co,\n<li>One</li>')
  })

  test('blank text version: generated from the HTML, preheader and comments left out', () => {
    const d = doc()
    d.settings.text = '  '
    const html = renderEmailHtml(applyTemplateVariables(d, { name: 'Ada', list: '', url: 'https://x.test' }))
    const text = plainTextFor(d, html)
    expect(text.startsWith('Hello Ada')).toBe(true)
    expect(text).not.toContain('has news')
  })

  test('htmlToText decodes entities, trims link labels and keeps hash URLs', () => {
    const html = '<!-- <p>old copy</p> --><span style="display: none;">Preview</span><p>Approved &#129395; &mdash; done</p><a href="https://x.test/#/u/ada">\n  View profile\n</a><a href="https://x.test">https://x.test</a>'
    expect(htmlToText(html)).toBe('Approved 🥳 — done\nView profile (https://x.test/#/u/ada)https://x.test')
  })
})
