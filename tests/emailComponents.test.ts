import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, type ComponentBlock, type EmailDocument } from '../shared/email/blocks'
import { fillComponent, renderEmailHtml } from '../shared/email/render'
import { extractTemplateVariables } from '../shared/email/placeholders'
import { applyProjectAccent, resolveTemplate } from '../shared/email/resolve'
import { lintEmail } from '../shared/email/lint'
import { normalizeDocument } from '../shared/email/ops'
import {
  componentCatalog,
  componentInstance,
  componentOutdated,
  detachComponent,
  expandComponentRefs,
  fieldLabel,
  normalizeComponentInput,
  refreshComponent,
  type EmailComponentDef
} from '../shared/email/components'

const PILL: EmailComponentDef = {
  id: 'cmp_pill',
  name: 'Pill badge',
  description: 'The brand name in a white pill above the card.',
  html: '<a href="{{@href}}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:{{@background}};color:{{@color}};font-size:{{@size}}px">{{@label}}</a>',
  fields: [
    { key: 'label', label: 'Label', type: 'text', group: 'content', default: 'Acme' },
    { key: 'href', label: 'Link', type: 'url', group: 'content', default: 'https://acme.test' },
    { key: 'background', label: 'Background', type: 'color', group: 'style', default: '#2563eb' },
    { key: 'color', label: 'Text colour', type: 'color', group: 'style', default: '#ffffff' },
    { key: 'size', label: 'Text size', type: 'number', group: 'style', default: '13' }
  ],
  projectId: null
}

const instance = (values: Record<string, string> = {}): ComponentBlock => ({ id: 'blk_pill', ...componentInstance(PILL, values) })
const doc = (blocks: EmailDocument['blocks']): EmailDocument => ({ settings: { ...DEFAULT_SETTINGS, title: 'Hi', preheader: 'There' }, blocks })

describe('fillComponent', () => {
  test('each field type is escaped or checked its own way', () => {
    const fields = [
      { key: 't', label: 'T', type: 'text', group: 'content', default: '' },
      { key: 'r', label: 'R', type: 'richtext', group: 'content', default: '' },
      { key: 'u', label: 'U', type: 'url', group: 'content', default: '' },
      { key: 'c', label: 'C', type: 'color', group: 'style', default: '' },
      { key: 'n', label: 'N', type: 'number', group: 'style', default: '' }
    ] as const
    const html = '{{@t}}|{{@r}}|{{@u}}|{{@c}}|{{@n}}|{{@nope}}|{{ @t }}'
    expect(fillComponent(html, [...fields], { t: '<b>A&B</b>', r: '<b>bold</b><script>x</script>', u: 'javascript:alert(1)', c: 'red;position:fixed', n: '14px' }))
      .toBe('&lt;b&gt;A&amp;B&lt;/b&gt;|<b>bold</b>x|#||14||&lt;b&gt;A&amp;B&lt;/b&gt;')
    expect(fillComponent('{{@u}} {{@c}}', [...fields], { u: 'https://a.test/?a=1&b="2"', c: 'rgba(0, 0, 0, .5)' })).toBe('https://a.test/?a=1&amp;b=&quot;2&quot; rgba(0, 0, 0, .5)')
  })

  test('a missing value falls back to the field default', () => {
    expect(renderEmailHtml(doc([instance({ label: 'Acme.com' })]))).toContain('background:#2563eb;color:#ffffff;font-size:13px">Acme.com</a>')
  })
})

describe('components and variables', () => {
  test('fields are never variables; variables inside values and HTML are', () => {
    const block = { ...instance({ href: 'https://acme.test/u/{{userName}}' }), html: `${PILL.html}<p>{{greeting}}</p>` }
    expect(extractTemplateVariables(doc([block]))).toEqual(['greeting', 'userName'])
  })

  test('a value fills in raw and is escaped once, by the renderer; markup variables are escaped', () => {
    const block = { ...instance({ label: 'Hi {{name}}' }), html: `${PILL.html}<p>{{name}}</p>` }
    const { document } = resolveTemplate({ name: 'x', document: doc([block]), variables: [] }, { values: { name: '<b>Ada</b>' } })
    const html = renderEmailHtml(document)
    expect(html).toContain('>Hi &lt;b&gt;Ada&lt;/b&gt;</a>')
    expect(html).toContain('<p>&lt;b&gt;Ada&lt;/b&gt;</p>')
  })

  test('a master\'s brand colour on a colour field follows the project accent', () => {
    const master = doc([{ id: 'b', type: 'button', label: 'Go', href: 'https://x.test', align: 'center', backgroundColor: '#2563eb', color: '#fff' }, instance()])
    const next = applyProjectAccent(master, '#16a34a').blocks[1] as ComponentBlock
    expect(next.values.background).toBe('#16a34a')
    expect(next.values.color).toBeUndefined()
  })
})

describe('the library', () => {
  test('input is validated and fields follow the slots', () => {
    expect(normalizeComponentInput({ name: '', html: '<p>x</p>' })).toEqual({ ok: false, error: 'A component needs a name' })
    expect(normalizeComponentInput({ name: 'X', html: '<iframe src="x"></iframe>' }).ok).toBe(false)
    const res = normalizeComponentInput({
      name: ' Badge ',
      html: '<a href="{{@linkUrl}}" style="color:{{@tint}}">{{@label}} {{@label}}</a>',
      fields: [{ key: 'tint', type: 'color' }, { key: 'gone', type: 'text' }, { key: 'bad.key', type: 'text' }, { key: 'linkUrl', type: 'url', label: 'Where it goes', default: 'https://a.test' }]
    })
    expect(res.ok && res.value.name).toBe('Badge')
    expect(res.ok && res.value.fields).toEqual([
      { key: 'linkUrl', label: 'Where it goes', type: 'url', group: 'content', default: 'https://a.test' },
      { key: 'tint', label: 'Tint', type: 'color', group: 'style', default: '' },
      { key: 'label', label: 'Label', type: 'text', group: 'content', default: '' }
    ])
    expect(fieldLabel('buttonLabel')).toBe('Button label')
  })

  test('a slot nobody described gets its type from where it sits', () => {
    const html = '<a href="{{@link}}" style="color:{{@tint}};font-size:{{@size}}px"><img src="{{ @logo }}">{{@label}}</a><td bgcolor="{{@fill}}">'
    expect(normalizeComponentInput({ name: 'x', html, fields: [{ key: 'label', type: 'richtext' }] }).ok && (normalizeComponentInput({ name: 'x', html }) as any).value.fields.map((f: any) => `${f.key}:${f.type}:${f.group}`))
      .toEqual(['link:url:content', 'tint:color:style', 'size:number:style', 'logo:image:content', 'label:text:content', 'fill:color:style'])
  })

  test('the AI\'s shorthand becomes a copy; unknown ids are dropped and reported', () => {
    const { blocks, unknown } = expandComponentRefs([
      { type: 'section', blocks: [{ type: 'component', componentId: 'cmp_pill', values: { label: 'Hi', extra: 'x' } }] },
      { type: 'component', componentId: 'cmp_missing' }
    ], [PILL])
    expect(unknown).toEqual(['cmp_missing'])
    const out = normalizeDocument({ settings: {}, blocks })
    const pill = (out.blocks[0] as any).blocks[0] as ComponentBlock
    expect(out.blocks).toHaveLength(1)
    expect(pill).toMatchObject({ type: 'component', componentId: 'cmp_pill', name: 'Pill badge', html: PILL.html, values: { label: 'Hi' } })
  })

  test('an instance knows when the library moved on, and refreshing keeps its values', () => {
    const block = instance({ label: 'Mine', size: '15' })
    expect(componentOutdated(block, PILL)).toBe(false)
    const edited = { ...PILL, html: `${PILL.html}!`, fields: PILL.fields.filter(f => f.key !== 'size') }
    expect(componentOutdated(block, edited)).toBe(true)
    expect(refreshComponent(block, edited).values).toEqual({ label: 'Mine' })
  })

  test('detaching keeps the look and the variables', () => {
    const block = instance({ href: 'https://acme.test/u/{{userName}}' })
    const html = detachComponent(block)
    expect(html.type).toBe('html')
    expect(html.html).toContain('href="https://acme.test/u/{{userName}}"')
    expect(renderEmailHtml(doc([html]))).toBe(renderEmailHtml(doc([block])))
  })

  test('checks look inside components', () => {
    const issues = lintEmail(doc([instance({ href: 'https://example.com' })]))
    expect(issues.map(i => i.message)).toEqual(['component “Pill badge”: “Link” is a placeholder'])
  })

  test('the catalog lists ids, scope and fields', () => {
    const text = componentCatalog([PILL, { ...PILL, id: 'cmp_mine', projectId: 'p1', name: 'Mine' }])
    expect(text).toContain('- cmp_pill "Pill badge" (shared): The brand name in a white pill above the card.')
    expect(text).toContain('(this project)')
    expect(text).toContain('label (text, content, default "Acme")')
    expect(componentCatalog([])).toBe('(none yet)')
  })
})
