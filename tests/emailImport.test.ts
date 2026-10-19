import { describe, expect, test } from 'bun:test'
import { extractPreheader, htmlToEmailDocument } from '../shared/email/import'
import { lintEmail } from '../shared/email/lint'
import { renderEmailHtml } from '../shared/email/render'

const fragment = `<section class="message-content" style="margin: 0; padding: 0; background-color: #eef2f7">
  <span
    style="display: none; font-size: 1px; max-height: 0; opacity: 0; overflow: hidden;"
  >
    Your icons have been approved &#129395;
  </span>

  <div style="display: none; overflow: hidden; max-height: 0;">
    Your icons have been approved &#129395;
  </div>

  <table width="100%" bgcolor="#EEF2F7"><tr><td><span style="display:none">kept: inside the design</span>Hi {{userFirstName}}</td></tr></table>
</section>`

describe('htmlToEmailDocument', () => {
  test('a fragment: preheader lifted out (every copy), page colour carried over, markup kept', () => {
    const doc = htmlToEmailDocument(fragment, { title: 'Your macOS submission' })
    expect(doc.settings).toMatchObject({ title: 'Your macOS submission', preheader: 'Your icons have been approved 🥳', backgroundColor: '#eef2f7', contentBackground: '#eef2f7', contentWidth: 672 })
    expect(doc.blocks).toHaveLength(1)
    const html = (doc.blocks[0] as { html: string }).html
    expect(html).not.toContain('approved &#129395;')
    expect(html).toContain('kept: inside the design')
    expect(html).toContain('Hi {{userFirstName}}')
    expect(html.startsWith('<section')).toBe(true)
  })

  test('a full document: title, body only, head styles kept, body colour', () => {
    const doc = htmlToEmailDocument('<!doctype html><html><head><title>Welcome &amp; hello</title><style>p{color:red}</style></head><body style="background-color:#101010"><p>Hi</p></body></html>')
    expect(doc.settings.title).toBe('Welcome & hello')
    expect(doc.settings.backgroundColor).toBe('#101010')
    expect((doc.blocks[0] as { html: string }).html).toBe('<style>p{color:red}</style>\n<p>Hi</p>')
  })

  test('explicit options win, and a text version is kept', () => {
    const doc = htmlToEmailDocument(fragment, { preheader: 'Custom', text: 'Plain\r\nversion', settings: { contentWidth: 600 } })
    expect(doc.settings.preheader).toBe('Custom')
    expect(doc.settings.text).toBe('Plain\nversion')
    expect(doc.settings.contentWidth).toBe(600)
    // An explicit preheader leaves the markup alone.
    expect((doc.blocks[0] as { html: string }).html).toContain('approved &#129395;')
  })

  test('it renders: the imported design sits inside the editor\'s wrapper unchanged', () => {
    const html = renderEmailHtml(htmlToEmailDocument(fragment, { title: 'T' }))
    expect(html).toContain('Your icons have been approved 🥳</div>')
    expect(html).toContain('<section class="message-content"')
  })

  test('the width check leaves imported HTML alone (it sizes itself) but not block layouts', () => {
    const imported = htmlToEmailDocument(fragment, { title: 'T' })
    expect(lintEmail(imported).some(i => i.message.includes('px wide'))).toBe(false)
    const blocks = { ...imported, blocks: [{ id: 'h', type: 'heading', text: 'Hi', level: 1, align: 'left' }] } as any
    expect(lintEmail(blocks).some(i => i.message.includes('px wide'))).toBe(true)
  })

  test('no hidden preview text: nothing removed', () => {
    expect(extractPreheader('<p>Hello</p>')).toEqual({ preheader: '', html: '<p>Hello</p>' })
  })
})
