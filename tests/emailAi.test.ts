import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, type EmailDocument } from '../shared/email/blocks'
import { contrastRatio, lintEmail } from '../shared/email/lint'
import { addBlock, moveBlock, normalizeDocument, removeBlock, setDocument, updateBlock } from '../shared/email/ops'
import { findBlock, locateBlock } from '../shared/email/blocks'
import { renderEmailHtml } from '../shared/email/render'
import { emailAiTier, EMAIL_AI_TIERS } from '../shared/email/ai'

const doc = (blocks: unknown[], settings: Partial<EmailDocument['settings']> = {}) => ({ settings: { ...DEFAULT_SETTINGS, title: 'Hello', preheader: 'Hi there', ...settings }, blocks }) as EmailDocument

describe('normalizeDocument', () => {
  test('a sloppy AI document still renders: unknown blocks dropped, fields filled, ids unique', () => {
    const { doc: out } = setDocument(doc([]), {
      settings: { title: 'X', contentWidth: '600' },
      blocks: [
        { type: 'heading', text: 'Hi', level: 7 },
        { type: 'marquee', text: 'nope' },
        { id: 'dup', type: 'columns', columns: [[{ id: 'dup', type: 'text' }], 'junk'] },
        { type: 'button', label: 42, padding: '12' }
      ]
    } as any)
    expect(out.blocks.map(b => b.type)).toEqual(['heading', 'columns', 'button'])
    expect(out.blocks[0]).toMatchObject({ level: 3 })
    const cols = (out.blocks[1] as any).columns
    expect(cols).toHaveLength(2)
    expect(cols[0][0].id).not.toBe('dup')
    expect(cols[0][0].html).toBe('Some text.')
    expect(out.blocks[2]).toMatchObject({ label: '42', padding: 12, href: 'https://example.com' })
    expect(out.settings.contentWidth).toBe(600)
    expect(() => renderEmailHtml(out)).not.toThrow()
  })

  test('garbage in, empty email out', () => {
    expect(normalizeDocument(null).blocks).toEqual([])
    expect(normalizeDocument({ blocks: 'x' }).settings.title).toBe(DEFAULT_SETTINGS.title)
  })

  test('addBlock rejects unknown types and keeps ids unique', () => {
    const base = doc([{ id: 'a', type: 'text', html: 'x', align: 'left' }])
    expect(addBlock(base, 'marquee' as any).ok).toBe(false)
    const res = addBlock(base, 'columns', { columns: [[{ id: 'a', type: 'text' }]] })
    expect((res.doc.blocks[1] as any).columns[0][0].id).not.toBe('a')
  })
})

describe('sections and components in the ops', () => {
  const nested = () => normalizeDocument({
    settings: { title: 'x' },
    blocks: [
      { id: 'card', type: 'section', background: '#ffffff', blocks: [
        { id: 'hero', type: 'section', blocks: [{ id: 'h', type: 'heading', text: 'Hi' }] },
        { id: 'p', type: 'text', html: 'Body' }
      ] },
      { id: 'cols', type: 'columns', columns: [[{ id: 'c1', type: 'text', html: 'a' }], []] }
    ]
  })

  test('normalize keeps sections (bare by default) and components with only declared values', () => {
    const doc = normalizeDocument({ blocks: [
      { type: 'section', blocks: [{ type: 'component', html: '<b>{{@label}}</b>', fields: [{ key: 'label' }], values: { label: 'Hi', junk: 'x' } }, { type: 'marquee' }] }
    ] })
    const section = doc.blocks[0] as any
    expect(section).toMatchObject({ type: 'section', blocks: [{ type: 'component', values: { label: 'Hi' } }] })
    expect(section.background).toBeUndefined()
    expect(section.padding).toBeUndefined()
    expect(section.blocks).toHaveLength(1)
  })

  test('add into a section or a column; remove and update anywhere', () => {
    let doc = nested()
    const inSection = addBlock(doc, 'button', { label: 'Go' }, 1, { id: 'hero' })
    expect(inSection.ok).toBe(true)
    expect(locateBlock(inSection.doc.blocks, inSection.id)).toMatchObject({ index: 1, parent: { id: 'hero' } })
    const inColumn = addBlock(inSection.doc, 'text', {}, undefined, { id: 'cols', column: 1 })
    expect(locateBlock(inColumn.doc.blocks, inColumn.id)).toMatchObject({ column: 1, parent: { id: 'cols' } })
    expect(addBlock(doc, 'text', {}, 0, { id: 'p' }).ok).toBe(false)
    expect(addBlock(doc, 'text', {}, 0, { id: 'cols', column: 5 }).ok).toBe(false)
    doc = removeBlock(inColumn.doc, 'h').doc
    expect(findBlock(doc.blocks, 'h')).toBeNull()
    expect(updateBlock(doc, 'c1', { html: 'b' }).doc).toMatchObject({ blocks: [{}, { columns: [[{ html: 'b' }], [{}]] }] })
  })

  test('move within its own list, into another container, never into itself', () => {
    const doc = nested()
    expect(moveBlock(doc, 'p', 0).doc.blocks[0]).toMatchObject({ blocks: [{ id: 'p' }, { id: 'hero' }] })
    const moved = moveBlock(doc, 'c1', 0, { id: 'hero' })
    expect(locateBlock(moved.doc.blocks, 'c1')?.parent?.id).toBe('hero')
    expect(moveBlock(doc, 'card', 0, { id: 'hero' }).ok).toBe(false)
    expect(moveBlock(doc, 'card', 0, { id: 'card' }).ok).toBe(false)
  })

  test('a component patch changes one value and keeps the rest', () => {
    const doc = normalizeDocument({ blocks: [{ id: 'k', type: 'component', html: '{{@a}}{{@b}}', fields: [{ key: 'a' }, { key: 'b' }], values: { a: '1', b: '2' } }] })
    expect(updateBlock(doc, 'k', { values: { b: '3', c: '4' } }).doc.blocks[0]).toMatchObject({ values: { a: '1', b: '3' } })
  })
})

describe('lintEmail', () => {
  test('a clean email has no issues', () => {
    const clean = doc([
      { id: 'h', type: 'heading', text: 'Welcome', level: 1, align: 'center', color: '#111111' },
      { id: 'i', type: 'image', src: 'https://cdn.acme.test/hero.png', alt: 'Hero', align: 'center' },
      { id: 'b', type: 'button', label: 'Start', href: 'https://acme.test', align: 'center', backgroundColor: '#1d4ed8', color: '#ffffff' }
    ])
    expect(lintEmail(clean)).toEqual([])
  })

  test('flags the inbox killers, each pointing at its block', () => {
    const bad = doc([
      { id: 'i', type: 'image', src: 'https://dummyimage.com/600x200', alt: '', align: 'center' },
      { id: 'b', type: 'button', label: 'Go', href: 'https://example.com', align: 'center', backgroundColor: '#fde047', color: '#ffffff' },
      { id: 't', type: 'text', html: 'faint', align: 'left', color: '#dddddd' },
      { id: 'x', type: 'html', html: '<form><input></form>' }
    ], { title: 'Untitled email', preheader: '' })
    const issues = lintEmail(bad)
    const at = (id?: string) => issues.filter(i => i.blockId === id).map(i => i.message)
    expect(at(undefined)).toEqual(['No subject line', 'No preheader'])
    expect(at('i')).toEqual(['Placeholder image', 'Image has no alt text'])
    expect(at('b')).toHaveLength(2) // placeholder link + contrast
    expect(at('t')[0]).toContain('hard to read')
    expect(issues.find(i => i.blockId === 'x')?.level).toBe('error')
  })

  test('contrast is measured against the section behind a block', () => {
    const dark = doc([{ id: 'hero', type: 'section', background: '#0b0b16', blocks: [
      { id: 'w', type: 'heading', text: 'Light on dark', level: 1, align: 'center', color: '#ffffff' },
      { id: 'd', type: 'text', html: 'Dark on dark', align: 'left', color: '#111111' }
    ] }])
    expect(lintEmail(dark).map(i => i.blockId)).toEqual(['d'])
    const gradient = doc([{ id: 'g', type: 'section', gradientTo: '#5e92f2', blocks: [] }])
    expect(lintEmail(gradient).map(i => i.message)).toEqual(['Gradient section has no solid colour for Outlook'])
  })

  test('masters are nudged towards the project brand', () => {
    const plain = doc([{ id: 'h', type: 'heading', text: 'Welcome to Acme', level: 1, align: 'center' }])
    expect(lintEmail(plain, { master: true }).some(i => i.message.includes('project brand'))).toBe(true)
    const branded = doc([{ id: 'h', type: 'heading', text: 'Welcome to {{project.name}}', level: 1, align: 'center' }])
    expect(lintEmail(branded, { master: true })).toEqual([])
  })

  test('contrast ratio matches WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
    expect(contrastRatio('{{c}}', '#fff')).toBeNull()
  })
})

test('model tiers: high is the default, ultra is the pro model', () => {
  expect(emailAiTier('nonsense')).toBe('high')
  expect(EMAIL_AI_TIERS[emailAiTier('ultra')].model).toBe('openai/mimo-v2.6-pro')
  expect(EMAIL_AI_TIERS.high.model).toBe('openai/mimo-v2.6-flash')
})
