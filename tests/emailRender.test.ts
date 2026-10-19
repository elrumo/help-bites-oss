import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, type EmailDocument, type ImageBlock } from '../shared/email/blocks'
import { renderEmailHtml } from '../shared/email/render'
import { htmlToText } from '../shared/email/resolve'

const image = (align: ImageBlock['align']): ImageBlock => ({ id: `img-${align}`, type: 'image', src: 'https://x.test/a.png', alt: 'A', align, width: 120 })
const doc = (blocks: EmailDocument['blocks']): EmailDocument => ({ settings: { ...DEFAULT_SETTINGS, contentWidth: 560, title: 'T' }, blocks })

describe('renderEmailHtml', () => {
  test('the card is fluid up to the content width, with a fixed width for Outlook', () => {
    const html = renderEmailHtml(doc([{ id: 't', type: 'text', html: 'Hi', align: 'left' }]))
    expect(html).toContain('width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;')
    expect(html).not.toContain('style="width:560px;')
    expect(html).toContain('<!--[if mso]><table role="presentation" width="560" align="center"')
    // The Outlook-only table is a comment everywhere else, plain text included.
    expect(htmlToText(html)).not.toContain('mso')
  })

  test('a centred or right-aligned image is placed by its margins', () => {
    const html = renderEmailHtml(doc([image('center'), image('right'), image('left')]))
    expect(html).toContain('<div align="center" style="text-align:center;"><img src="https://x.test/a.png" alt="A" width="120" style="display:block;margin:0 auto;width:120px;')
    expect(html).toContain('<div align="right" style="text-align:right;"><img src="https://x.test/a.png" alt="A" width="120" style="display:block;margin:0 0 0 auto;width:120px;')
    expect(html).toContain('<div align="left" style="text-align:left;"><img src="https://x.test/a.png" alt="A" width="120" style="display:block;width:120px;')
  })
})

describe('sections, sizes and inline styles', () => {
  test('a section draws its surface and clips its children to its corners', () => {
    const html = renderEmailHtml(doc([{
      id: 'card',
      type: 'section',
      background: '#ffffff',
      radius: 24,
      shadow: '0 10px 30px rgba(0,0,0,.1); position:fixed',
      padding: 0,
      blocks: [
        { id: 'band', type: 'section', background: '#bfe9fd', gradientTo: '#5e92f2', gradientAngle: 183, padding: { top: 20, right: 28, bottom: 20, left: 28 }, blocks: [{ ...image('center'), width: undefined }] }
      ]
    }]))
    expect(html).toContain('<td style="padding:0px 0px 0px 0px;background-color:#ffffff;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,.1) position:fixed;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-radius:24px;overflow:hidden;">')
    expect(html).toContain('background-color:#bfe9fd;background-image:linear-gradient(183deg, #bfe9fd, #5e92f2);')
    // Children lay out inside the padding: 560 - 28 - 28.
    expect(html).toContain('width="504"')
  })

  test('an empty section still has a row, and padding wider than the radius needs no clip', () => {
    const html = renderEmailHtml(doc([{ id: 's', type: 'section', radius: 8, padding: 16, blocks: [] }]))
    expect(html).toContain('style="width:100%;"><tr><td>&nbsp;</td></tr></table>')
  })

  test('default buttons and headings render as before; sizes scale the padding', () => {
    const base = renderEmailHtml(doc([
      { id: 'b', type: 'button', label: 'Go', href: 'https://x.test', align: 'center', backgroundColor: '#111111', color: '#ffffff' },
      { id: 'h', type: 'heading', text: 'Hi', level: 2, align: 'left' }
    ]))
    expect(base).toContain('style="background-color:#111111;border-radius:6px;"><a href="https://x.test" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 24px;font-size:15px;')
    expect(base).toContain('font-size:22px;')
    const sized = renderEmailHtml(doc([
      { id: 'b', type: 'button', label: 'Go', href: 'https://x.test', align: 'center', backgroundColor: '#fff', color: '#000', fontSize: 13, radius: 999, shadow: '0 2px 4px rgba(0,0,0,.1)' },
      { id: 'h', type: 'heading', text: 'Hi', level: 1, align: 'center', fontSize: 34 }
    ]))
    expect(sized).toContain('border-radius:999px;box-shadow:0 2px 4px rgba(0,0,0,.1);"><a')
    expect(sized).toContain('padding:10px 21px;font-size:13px;')
    expect(sized).toContain('font-size:34px;')
  })

  test('links and spans keep their colour and weight, nothing else', () => {
    const html = renderEmailHtml(doc([{ id: 't', type: 'text', align: 'left', html: '<a href="https://x.test" style="color: #2563eb; text-decoration: none; font-weight: 600; position: absolute">x</a> <a href="https://y.test">y</a> <span style="background-color:#ff0;background-image:url(x)">z</span> <span onclick="x">w</span>' }]))
    expect(html).toContain('<a href="https://x.test" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;">x</a>')
    expect(html).toContain('<a href="https://y.test" target="_blank" rel="noopener noreferrer" style="color:inherit;">y</a>')
    expect(html).toContain('<span style="background-color:#ff0;">z</span> <span>w</span>')
  })

  test('ids only in the preview; a melted card is not clipped', () => {
    const d = doc([{ id: 'blk_a', type: 'section', blocks: [{ id: 'blk_b', type: 'spacer', height: 8 }] }])
    expect(renderEmailHtml(d)).not.toContain('data-block-id')
    const tagged = renderEmailHtml(d, { ids: true })
    expect(tagged).toContain('<td data-block-id="blk_a"')
    expect(tagged).toContain('<td data-block-id="blk_b"')
    expect(renderEmailHtml(d)).toContain('border-radius:8px;overflow:hidden;')
    expect(renderEmailHtml({ ...d, settings: { ...d.settings, backgroundColor: '#EEF2F7', contentBackground: '#eef2f7' } })).not.toContain('border-radius:8px;overflow:hidden;')
  })
})

test('links that start with a placeholder keep it until it is filled; unsafe ones become #', () => {
  const html = renderEmailHtml(doc([
    { id: 'b', type: 'button', label: 'Reset', href: '{{resetUrl}}', align: 'center', backgroundColor: '#111111', color: '#ffffff' },
    { id: 't', type: 'text', align: 'left', html: '<a href="{{resetUrl}}">{{resetUrl}}</a> <a href="javascript:alert(1)">x</a>' },
    { id: 'i', type: 'image', src: 'https://x.test/a.png', alt: 'A', align: 'left', href: '{{ profileUrl }}/edit' }
  ]))
  expect(html).toContain('<a href="{{resetUrl}}" target="_blank" rel="noopener noreferrer" style="display:inline-block;')
  expect(html).toContain('<a href="{{resetUrl}}" target="_blank" rel="noopener noreferrer" style="color:inherit;">{{resetUrl}}</a> <a href="#"')
  expect(html).toContain('<a href="{{ profileUrl }}/edit" target="_blank"')
})
