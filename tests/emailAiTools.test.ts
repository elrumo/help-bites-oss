import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UIMessageStreamWriter } from 'ai'
import { DEFAULT_SETTINGS, findBlock, locateBlock, type EmailDocument } from '../shared/email/blocks'
import { normalizeDocument } from '../shared/email/ops'
import type { EmailComponentDef } from '../shared/email/components'
import { emailAiTools, emailSystemPrompt, type EmailAiContext, type EmailAiState } from '../server/utils/emailAi'

// The AI designer's tools against a fake model: each call is what the model
// would send, and the results are what it reads back.

const PILL: EmailComponentDef = {
  id: 'cmp_pill',
  name: 'Pill badge',
  description: 'The brand name in a pill above the card.',
  html: '<table role="presentation"><tr><td style="border-radius:999px;background:{{@background}}"><a href="{{@href}}">{{@label}}</a></td></tr></table>',
  fields: [
    { key: 'label', label: 'Label', type: 'text', group: 'content', default: 'Acme' },
    { key: 'href', label: 'Link', type: 'url', group: 'content', default: 'https://acme.test' },
    { key: 'background', label: 'Background', type: 'color', group: 'style', default: '#ffffff' }
  ],
  projectId: null
}

function setup(blocks: unknown[] = [], ctx: Partial<EmailAiContext> = {}) {
  const written: { type: string, data: unknown }[] = []
  const writer = { write: (part: { type: string, data: unknown }) => written.push(part) } as unknown as UIMessageStreamWriter
  const state: EmailAiState = {
    doc: normalizeDocument({ settings: { ...DEFAULT_SETTINGS, title: 'Hi', preheader: 'There' }, blocks }),
    variables: [],
    changed: false,
    components: [PILL],
    saved: 0
  }
  const saved: unknown[] = []
  const context: EmailAiContext = {
    scope: 'project',
    brand: { name: 'Acme' },
    saveComponent: async (input) => {
      saved.push(input)
      return { id: input.id || `cmp_${saved.length}`, name: input.name, description: input.description, html: input.html, fields: input.fields.map(f => ({ label: f.key, default: '', ...f })), projectId: 'p1' }
    },
    ...ctx
  }
  const tools = emailAiTools(state, writer, context) as Record<string, { execute: (input: any, options: any) => Promise<string> }>
  const run = (name: string, input: unknown) => tools[name]!.execute(input, { toolCallId: 'x', messages: [] })
  return { state, run, written, saved, context }
}

describe('the AI designer\'s tools', () => {
  test('set_document takes nested sections and library components by id', async () => {
    const { state, run, written } = setup()
    const out = await run('set_document', { document: { settings: { title: 'T' }, blocks: [
      { type: 'component', componentId: 'cmp_pill', values: { label: 'Acme.com' }, padding: 0 },
      { type: 'section', background: '#ffffff', radius: 24, blocks: [{ type: 'heading', text: 'Approved', level: 1 }] },
      { type: 'component', componentId: 'cmp_nope' }
    ] } })
    expect(out).toContain('Replaced the email with 2 top-level block(s).')
    expect(out).toContain('unknown component id(s) cmp_nope')
    expect(state.doc.blocks[0]).toMatchObject({ type: 'component', name: 'Pill badge', html: PILL.html, values: { label: 'Acme.com' } })
    expect(state.doc.blocks[1]).toMatchObject({ type: 'section', blocks: [{ type: 'heading', text: 'Approved' }] })
    expect(written.filter(w => w.type === 'data-document')).toHaveLength(1)
  })

  test('set_document keeps an instance\'s own HTML when the model sends it back without it', async () => {
    const custom = { id: 'blk_k', type: 'component', componentId: 'cmp_pill', name: 'Pill badge', html: '<b>{{@label}}</b>', fields: [PILL.fields[0]], values: { label: 'Mine' } }
    const { state, run } = setup([custom])
    await run('set_document', { document: { settings: { title: 'T' }, blocks: [{ id: 'blk_k', type: 'component', values: { label: 'Changed' } }] } })
    expect(state.doc.blocks[0]).toMatchObject({ html: '<b>{{@label}}</b>', values: { label: 'Changed' } })
  })

  test('a document sent as a JSON string still works', async () => {
    const { state, run } = setup()
    await run('set_document', { document: JSON.stringify({ settings: { title: 'T' }, blocks: [{ type: 'spacer', height: 4 }] }) })
    expect(state.doc.blocks[0]).toMatchObject({ type: 'spacer', height: 4 })
  })

  test('add into a section, move out of it, replace a block in place, refuse child patches', async () => {
    const { state, run } = setup([{ id: 'card', type: 'section', blocks: [{ id: 'old', type: 'html', html: '<p>Hi</p>' }] }])
    const added = await run('add_block', { type: 'button', props: { label: 'Go' }, parentId: 'card' })
    const id = added.match(/"(blk_[^"]+)"/)?.[1]!
    expect(locateBlock(state.doc.blocks, id)?.parent?.id).toBe('card')
    await run('move_block', { id, to: 0 })
    expect(locateBlock(state.doc.blocks, id)?.index).toBe(0)
    await run('replace_block', { id: 'old', blocks: [{ type: 'text', html: 'Hi', padding: 0 }, { type: 'divider' }] })
    expect((findBlock(state.doc.blocks, 'card') as any).blocks.map((b: any) => b.type)).toEqual(['button', 'text', 'divider'])
    expect(await run('update_blocks', { updates: [{ id: 'card', patch: { blocks: [] } }] })).toContain('children can\'t be patched')
    expect(await run('add_block', { type: 'component', props: { componentId: 'cmp_gone' } })).toContain('Nothing added')
  })

  test('save_component saves, swaps the block for the component, and tells the editor', async () => {
    const { state, run, written, saved } = setup([{ id: 'hdr', type: 'html', html: '<table><tr><td>Acme</td></tr></table>', padding: 8 }])
    const out = await run('save_component', {
      name: 'Brand header',
      description: 'The logo row at the top.',
      html: '<table role="presentation"><tr><td style="color:{{@tint}}">{{@name}}</td></tr></table>',
      fields: [{ key: 'name', type: 'text', group: 'content', default: 'Acme' }, { key: 'tint', type: 'color', group: 'style', default: '#111111' }],
      replaceBlockId: 'hdr'
    })
    expect(out).toContain('Saved component "Brand header" (cmp_1)')
    expect(saved).toHaveLength(1)
    expect(state.doc.blocks[0]).toMatchObject({ type: 'component', componentId: 'cmp_1', padding: 8 })
    // A section's padding and background are inside the HTML it became: not carried over again.
    const band = setup([{ id: 'band', type: 'section', background: '#bfe9fd', padding: 20, blocks: [] }])
    await band.run('save_component', { name: 'Band', description: 'x', html: '<table role="presentation"><tr><td style="background:#bfe9fd;padding:20px">{{@title}}</td></tr></table>', fields: [{ key: 'title', type: 'text', group: 'content', default: 'Hi' }], replaceBlockId: 'band' })
    expect(band.state.doc.blocks[0]).toMatchObject({ type: 'component' })
    expect((band.state.doc.blocks[0] as any).padding).toBeUndefined()
    expect((band.state.doc.blocks[0] as any).background).toBeUndefined()
    expect(written.some(w => w.type === 'data-component')).toBe(true)
    expect(state.components.map(c => c.id)).toEqual(['cmp_1', 'cmp_pill'])
    expect(await run('save_component', { id: 'cmp_other', name: 'x', description: '', html: '<b>x</b>', fields: [] })).toContain('No library component "cmp_other"')
  })

  test('while converting, every edit reports what is missing or new against the source', async () => {
    const source = '<table><tr><td><h1>Welcome aboard</h1><p>Your <a href="https://acme.test/start">first steps</a>.</p></td></tr></table>'
    const { run } = setup([], { source: { html: source } })
    const partial = await run('set_document', { document: { settings: { title: 'T' }, blocks: [{ type: 'heading', text: 'Welcome aboard', level: 1, padding: 0 }, { type: 'text', html: 'Plus an invented line.', padding: 0 }] } })
    expect(partial).toContain('Missing text: “your first steps”')
    expect(partial).toContain('Missing link or image: https://acme.test/start')
    expect(partial).toContain('Text not in the source: “plus an invented line”')
    expect(partial).toContain('settings.theme is not set')
    const fixed = await run('set_document', { document: { settings: { title: 'T', theme: { brand: '#111111' } }, blocks: [{ type: 'heading', text: 'Welcome aboard', level: 1, padding: 0 }, { type: 'text', html: 'Your <a href="https://acme.test/start">first steps</a>.', padding: 0 }] } })
    expect(fixed).toContain('Everything in the HTML being converted is in the email')
    expect(fixed).toMatch(/The email now \(id type summary\):\n0\. blk_\w+ heading h1 "Welcome aboard"/)
  })
})

describe('the AI designer\'s prompt', () => {
  test('carries the ladder, every block, the library, the conversion rules and the outline', () => {
    const { state, context } = setup([{ id: 'card', type: 'section', background: '#ffffff', radius: 24, blocks: [{ id: 'h', type: 'heading', text: 'Approved', level: 1 }] }])
    const prompt = emailSystemPrompt(state, { ...context, selectedId: 'card' })
    for (const type of ['section', 'columns', 'heading', 'text', 'button', 'image', 'divider', 'spacer', 'html', 'component']) expect(prompt).toContain(`- ${type} {`)
    expect(prompt).toContain('## Choosing how to build each part')
    expect(prompt).toContain('- cmp_pill "Pill badge" (shared)')
    expect(prompt).toContain('## Converting HTML')
    expect(prompt).toContain('0. card section on #ffffff, radius 24\n  - h heading h1 "Approved"')
    expect(prompt).toContain('Its HTML as rendered')
    expect(prompt).not.toContain('{{@label}}') // instance and library HTML stay out
  })

  test('the hand-made conversion of the sample fits the prompt\'s budget', () => {
    const target = JSON.parse(readFileSync(join(import.meta.dir, '../scripts/fixtures/submission-approved.blocks.json'), 'utf8')) as EmailDocument
    const { context } = setup()
    const state: EmailAiState = { doc: normalizeDocument(target), variables: [], changed: false, components: [], saved: 0 }
    expect(emailSystemPrompt(state, context)).not.toContain('TRUNCATED')
  })
})

test('a stringified document missing its last brackets is closed; other damage is not guessed at', async () => {
  const { closeBrackets, parseStringifiedArgs } = await import('../server/utils/emailAi')
  expect(closeBrackets('{"a": [{"b": "x}"}, {"c": 1}')).toBe('{"a": [{"b": "x}"}, {"c": 1}]}')
  expect(closeBrackets('{"a": [1}')).toBe('{"a": [1}')
  expect(parseStringifiedArgs({ document: '{"settings": {}, "blocks": [{"type": "spacer"}]' })).toEqual({ document: { settings: {}, blocks: [{ type: 'spacer' }] } })
})

describe('drafts while a call is being written', () => {
  const state = (): EmailAiState => ({ doc: normalizeDocument({ settings: { title: 'T' }, blocks: [{ id: 'old', type: 'html', html: '<p>x</p>' }] }), variables: [], changed: false, components: [PILL], saved: 0 })

  test('a set_document cut off mid-block already shows the blocks so far', async () => {
    const { draftDocument } = await import('../server/utils/emailAi')
    const text = JSON.stringify({ document: { settings: { title: 'Approved' }, blocks: [{ type: 'heading', text: 'Your submission has been approved', level: 1 }, { type: 'text', html: 'Hi {{userFirstName}}, your submission' }] } })
    expect(await draftDocument(state(), 'set_document', text.slice(0, 40))).toBeNull()
    const partial = await draftDocument(state(), 'set_document', text.slice(0, text.indexOf('your submission') + 9))
    expect(partial?.blocks.map(b => b.type)).toEqual(['heading', 'text'])
    expect((partial?.blocks[1] as any).html).toBe('Hi {{userFirstName}}, your subm')
  })

  test('a stringified document, a replace_block and an add_block draft too', async () => {
    const { draftDocument } = await import('../server/utils/emailAi')
    const inner = JSON.stringify({ settings: {}, blocks: [{ type: 'component', componentId: 'cmp_pill', values: { label: 'Hi' } }, { type: 'spacer', height: 8 }] })
    const stringified = await draftDocument(state(), 'set_document', JSON.stringify({ document: inner }).slice(0, -12))
    expect(stringified?.blocks[0]).toMatchObject({ type: 'component', html: PILL.html, values: { label: 'Hi' } })
    const replaced = await draftDocument(state(), 'replace_block', '{"id": "old", "blocks": [{"type": "section", "blocks": [{"type": "text", "html": "Rebuil')
    expect(replaced?.blocks[0]).toMatchObject({ type: 'section', blocks: [{ type: 'text', html: 'Rebuil' }] })
    const added = await draftDocument(state(), 'add_block', '{"type": "button", "props": {"label": "Go')
    expect(added?.blocks.at(-1)).toMatchObject({ type: 'button', label: 'Go' })
  })

  test('drafts go out as transient parts, at most a few a second, never twice the same', async () => {
    const { emailAiDrafts } = await import('../server/utils/emailAi')
    const written: any[] = []
    const onChunk = emailAiDrafts(state(), { write: (part: unknown) => written.push(part) } as unknown as UIMessageStreamWriter)
    await onChunk({ chunk: { type: 'tool-input-start', id: 'c1', toolName: 'set_document' } })
    await onChunk({ chunk: { type: 'tool-input-delta', id: 'c1', delta: '{"document": {"settings": {}, "blocks": [{"type": "spacer", "height": 4}' } })
    await onChunk({ chunk: { type: 'tool-input-delta', id: 'c1', delta: ', {"type": "divider"}' } }) // too soon: skipped
    await onChunk({ chunk: { type: 'tool-input-start', id: 'c2', toolName: 'check_email' } })
    await onChunk({ chunk: { type: 'tool-input-delta', id: 'c2', delta: '{}' } })
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ type: 'data-draft', transient: true, data: { blocks: [{ type: 'spacer', height: 4 }] } })
  })
})
