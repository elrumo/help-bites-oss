import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, type EmailDocument } from '../shared/email/blocks'
import { applyProjectAccent, htmlToText, resolveTemplate, type ResolvableTemplate } from '../shared/email/resolve'

const doc = (): EmailDocument => ({
  settings: { ...DEFAULT_SETTINGS, title: 'Hi {{name}}', theme: { brand: '#2563eb', onBrand: '#ffffff', background: '#fff', surface: '#fff', heading: '#000', text: '#333', muted: '#eee', fontFamily: 'sans-serif', radius: 6 } },
  blocks: [
    { id: 'h', type: 'heading', text: 'Welcome to {{project.name}}', level: 1, align: 'center', color: '#000000' },
    { id: 'logo', type: 'image', src: '{{project.logoUrl}}', alt: '', align: 'center' },
    { id: 'cta', type: 'button', label: 'Go', href: 'https://x.test', align: 'center', backgroundColor: '#2563EB', color: '#ffffff' },
    { id: 'alt', type: 'button', label: 'Other', href: 'https://x.test', align: 'center', backgroundColor: '#ff0000', color: '#ffffff' },
    { id: 'foot', type: 'text', html: '{{footer}} {{unknown}}', align: 'left' }
  ]
})

const master: ResolvableTemplate = {
  name: 'Welcome',
  document: doc(),
  variables: [
    { key: 'name', defaultValue: 'there' },
    { key: 'footer', defaultValue: 'Default footer' },
    { key: 'project.name', defaultValue: 'Sample' }
  ]
}
const brand = { name: 'Acme', brandLogoUrl: 'https://acme.test/logo.png', siteUrl: 'https://acme.test', theme: { accent: '#fde047' } }
const linked: ResolvableTemplate = { name: 'welcome', document: null, variables: [], variableValues: { footer: 'Acme Inc, Paris' } }

const block = (d: EmailDocument, id: string) => d.blocks.find(b => b.id === id) as any

describe('resolveTemplate', () => {
  test('defaults < brand < project values < call-time values', () => {
    const { subject, document } = resolveTemplate(linked, { master, brand, values: { name: 'Ada' } })
    expect(subject).toBe('Hi Ada')
    expect(block(document, 'h').text).toBe('Welcome to Acme') // brand beats the master's sample default
    expect(block(document, 'logo').src).toBe('https://acme.test/logo.png')
    expect(block(document, 'foot').html).toBe('Acme Inc, Paris {{unknown}}') // unknown placeholders stay
    expect(resolveTemplate(linked, { master, brand, values: { footer: 'Override' } }).document.blocks.at(-1)).toMatchObject({ html: 'Override {{unknown}}' })
  })

  test('without a project the master previews with its own defaults', () => {
    const { subject, document } = resolveTemplate(master)
    expect(subject).toBe('Hi there')
    expect(block(document, 'h').text).toBe('Welcome to Sample')
    expect(block(document, 'cta').backgroundColor).toBe('#2563EB')
  })

  test('linked rows take the project accent on brand-coloured buttons only', () => {
    const { document } = resolveTemplate(linked, { master, brand })
    expect(block(document, 'cta')).toMatchObject({ backgroundColor: '#fde047', color: '#111111' }) // light accent, dark label
    expect(block(document, 'alt').backgroundColor).toBe('#ff0000')
    expect(block(document, 'h').color).toBe('#000000')
  })

  test('own and detached templates keep their colours', () => {
    const own: ResolvableTemplate = { ...master, variableValues: {} }
    const { document } = resolveTemplate(own, { brand })
    expect(block(document, 'cta').backgroundColor).toBe('#2563EB')
    expect(block(document, 'h').text).toBe('Welcome to Acme') // brand variables still fill in
  })

  test('the master document is never mutated', () => {
    resolveTemplate(linked, { master, brand, values: { name: 'Ada' } })
    expect(block(master.document!, 'cta').backgroundColor).toBe('#2563EB')
    expect(block(master.document!, 'h').text).toBe('Welcome to {{project.name}}')
  })
})

describe('helpers', () => {
  test('a bad accent is ignored', () => {
    const d = doc()
    expect(applyProjectAccent(d, 'teal')).toBe(d)
    expect(block(applyProjectAccent(d, '#0f172a'), 'cta').color).toBe('#ffffff')
  })

  test('htmlToText keeps words, links and line breaks', () => {
    expect(htmlToText('<head><title>T</title></head><h1>Hi</h1><div>One<br>Two &amp; <a href="https://x.test">link</a></div>')).toBe('Hi\nOne\nTwo & link (https://x.test)')
  })
})

test('senderVariables: project values become the fallback; brand keys are not the sender\'s to pass', async () => {
  const { senderVariables } = await import('../shared/email/resolve')
  expect(senderVariables(linked, master)).toEqual([{ key: 'name', defaultValue: 'there' }, { key: 'footer', defaultValue: 'Acme Inc, Paris' }])
  expect(senderVariables(master).map(v => v.key)).toEqual(['name', 'footer'])
})
