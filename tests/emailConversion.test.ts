import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { walkBlocks, type EmailBlock, type EmailDocument } from '../shared/email/blocks'
import { normalizeDocument } from '../shared/email/ops'
import { renderEmailHtml } from '../shared/email/render'
import { lintEmail } from '../shared/email/lint'
import { extractTemplateVariables } from '../shared/email/placeholders'
import { conversionGaps, sourceHtmlOf } from '../shared/email/convert'

// The Acme "submission approved" email, and the blocks a faithful
// conversion produces. It proves the block model can say everything the
// original says, and anchors the conversion check the AI designer gets.
const fixture = (name: string) => readFileSync(join(import.meta.dir, '../scripts/fixtures', name), 'utf8')
const source = fixture('submission-approved.html')
const target = normalizeDocument(JSON.parse(fixture('submission-approved.blocks.json')))

const all = (doc: EmailDocument) => {
  const out: EmailBlock[] = []
  walkBlocks(doc.blocks, b => out.push(b))
  return out
}

describe('the submission-approved conversion', () => {
  test('keeps every visible word and link, adds nothing', () => {
    expect(conversionGaps(source, target)).toEqual([])
  })

  test('is real blocks: a pill, a card with a gradient hero, styled links', () => {
    const blocks = all(target)
    expect(blocks.some(b => b.type === 'html' || b.type === 'component')).toBe(false)
    expect(target.blocks.map(b => b.type)).toEqual(['button', 'section', 'spacer'])
    const html = renderEmailHtml(target)
    expect(html).toContain('background-image:linear-gradient(183deg, #bfe9fd, #5e92f2);')
    expect(html).toContain('border-radius:24px;box-shadow:0 10px 30px rgba(20, 35, 60, 0.08);')
    expect(html).toContain('font-size:34px')
    expect(html).toContain('style="color: #2563eb;text-decoration: none;font-weight: 600;"'.replace(/: /g, ':'))
    expect(html).toContain('padding:10px 21px;font-size:13px')
  })

  test('declares its variables; the checks only flag the original\'s faint footer', () => {
    expect(extractTemplateVariables(target)).toEqual(['userFirstName', 'userName'])
    expect(lintEmail(target).map(i => i.blockId)).toEqual(['footer'])
  })
})

describe('conversionGaps', () => {
  test('names what was dropped, invented, or left out of the links', () => {
    const lossy = normalizeDocument({
      settings: target.settings,
      blocks: [{ type: 'text', html: 'Hi {{userFirstName}}, your submission is now live and ready to be shared.' }]
    })
    const gaps = conversionGaps(source, lossy)
    expect(gaps.some(g => g.startsWith('Missing text') && g.includes('buy me a coffee'))).toBe(true)
    expect(gaps.some(g => g.includes('https://github.com/sponsors/elrumo'))).toBe(true)
    expect(gaps.some(g => g.startsWith('Text not in the source') && g.includes('now live'))).toBe(true)
  })

  test('finds HTML pasted into a message', () => {
    expect(sourceHtmlOf(`Convert this plain html into components:\n${source}`)?.startsWith('<section')).toBe(true)
    expect(sourceHtmlOf('Make the <b>heading</b> bigger')).toBeNull()
  })
})

test('accented entities read as letters; the rest of an email isn\'t "new" when one block was converted', () => {
  const doc = normalizeDocument({ settings: target.settings, blocks: [{ type: 'text', html: 'Elías' }, { type: 'text', html: 'Kept' }] })
  expect(conversionGaps('<p>El&iacute;as&zwnj;</p>', doc).filter(g => !g.includes('kept'))).toEqual([])
  const keep = normalizeDocument({ settings: target.settings, blocks: [{ type: 'text', html: 'Kept' }] })
  expect(conversionGaps('<p>El&iacute;as</p>', doc, keep)).toEqual([])
})

test('images drawn at another size than the source are named, with the fix', () => {
  const resized = JSON.parse(JSON.stringify(target))
  resized.blocks[1].blocks[0].blocks[0].width = undefined // the 62px logo, now full width
  resized.blocks[1].blocks[0].blocks[0].height = 62
  const coffee = resized.blocks[1].blocks[1].blocks[2]
  coffee.width = undefined // sized by height in the source; no size here
  const gaps = conversionGaps(source, normalizeDocument(resized))
  expect(gaps).toContain('Image size: logo (https://acme.dev/images/logos/acme-logo-256px.png) is 62px wide in the source but 62px tall here; set width 62')
  expect(gaps).toContain('Image size: coffee (https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png) is 40px tall in the source but full width here; set height 40')
})
