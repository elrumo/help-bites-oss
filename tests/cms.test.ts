import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { UIMessageStreamWriter } from 'ai'
import {
  EMPTY_BRIEF, addBlock, duplicateBlock, findBlock, moveBlock, newBlock, normalizeComponentInput, normalizeContent, normalizeStyle, removeBlock, type CmsBlock, type CmsComponentDef
} from '../shared/cms/content'
import { BUILTIN_COMPONENTS, BUILTIN_KEYS, CMS_TEMPLATES, libraryOf, templateContent, wizardPrompt } from '../shared/cms/library'
import { PAGE_RUNTIME, pageCsp, renderBlocks, renderMarkdown, renderPage } from '../shared/cms/render'
import { cmsAiTools, type CmsAiContext, type CmsAiState } from '../server/utils/cmsAi'

const ctx = (library = libraryOf()) => ({ library, pk: 'pk_test', host: 'https://hb.test' })
const custom = (over: Partial<CmsComponentDef>): CmsComponentDef => ({ id: 'c1', key: 'card', name: 'Card', description: '', root: false, nestable: true, fields: [], html: '', css: '', ...over })

describe('components', () => {
  test('every built-in passes the same checks as a project\'s own component', () => {
    for (const def of BUILTIN_COMPONENTS) expect(normalizeComponentInput(def)).toMatchObject({ ok: true })
  })

  test('templates never carry anything that runs, and built-in keys stay reserved', () => {
    const base = { key: 'card', name: 'Card' }
    for (const html of ['<div><script>alert(1)</script></div>', '<div onclick="x()">hi</div>', '<a href="javascript:alert(1)">x</a>', '<div><iframe srcdoc="<b>x</b>"></iframe></div>', '<div><link rel="stylesheet" href="https://evil.test/x.css"></div>']) {
      expect(normalizeComponentInput({ ...base, html })).toMatchObject({ ok: false })
    }
    expect(normalizeComponentInput({ ...base, html: '<div>x</div>', css: '@import url(https://evil.test/x.css);' })).toMatchObject({ ok: false })
    expect(normalizeComponentInput({ ...base, html: 'loose text' })).toMatchObject({ ok: false })
    expect(normalizeComponentInput({ key: 'hero', name: 'Mine' }, BUILTIN_KEYS)).toMatchObject({ ok: false })
    expect(normalizeComponentInput({ ...base, fields: [{ key: 'size', type: 'select' }] })).toMatchObject({ ok: false })
    // Data-only components (a dev's own app renders them) need no template.
    expect(normalizeComponentInput({ ...base, fields: [{ key: 'title', type: 'text' }] })).toMatchObject({ ok: true })
  })
})

describe('content', () => {
  const library = libraryOf([custom({ fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'count', label: 'Count', type: 'number' }, { key: 'kind', label: 'Kind', type: 'select', options: ['a', 'b'] }], html: '<div class="card">{{@title}}</div>' })])

  test('values fit their field types, unknown keys and deleted components keep their data, ids are unique', () => {
    const { content, issues } = normalizeContent({
      component: 'page',
      body: [
        { _uid: 'same-id-1', component: 'card', title: 42, count: '7', kind: 'z', oldField: 'kept' },
        { _uid: 'same-id-1', component: 'gone', text: 'still here' },
        { component: 'page' }
      ]
    }, library, 'page')
    const [card, gone] = content.body as CmsBlock[]
    expect(card).toMatchObject({ component: 'card', title: '42', count: 7, oldField: 'kept' })
    expect(card!.kind).toBeUndefined()
    expect(gone).toMatchObject({ component: 'gone', text: 'still here' })
    expect(gone!._uid).not.toBe(card!._uid)
    expect((content.body as CmsBlock[]).length).toBe(2)
    expect(issues.join(' ')).toContain('does not take')
  })

  test('a blocks field takes only what it allows, and the root is always the entry type', () => {
    const { content } = normalizeContent({ component: 'page', body: [{ component: 'nav', links: [{ component: 'link', label: 'A' }, { component: 'hero' }] }] }, libraryOf(), 'page')
    expect(((content.body as CmsBlock[])[0]!.links as CmsBlock[]).map(b => b.component)).toEqual(['link'])
    expect(normalizeContent({ component: 'nav' }, libraryOf(), 'page').content.component).toBe('page')
  })

  test('tree operations add, move, duplicate and remove without touching the input', () => {
    const lib = libraryOf()
    const root = normalizeContent({ component: 'page', body: [newBlock(lib.get('hero')!), newBlock(lib.get('cta')!)] }, lib, 'page').content
    const [hero, cta] = root.body as CmsBlock[]
    const moved = moveBlock(root, lib, cta!._uid, root._uid, 'body', 0)
    expect(moved.ok).toBe(true)
    expect((moved.content.body as CmsBlock[]).map(b => b.component)).toEqual(['cta', 'hero'])
    expect((root.body as CmsBlock[]).map(b => b.component)).toEqual(['hero', 'cta'])
    const copy = duplicateBlock(root, lib, hero!._uid)
    expect((copy.content.body as CmsBlock[]).map(b => b.component)).toEqual(['hero', 'hero', 'cta'])
    expect((copy.content.body as CmsBlock[])[1]!._uid).not.toBe(hero!._uid)
    expect(addBlock(root, lib, root._uid, 'body', newBlock(lib.get('page')!)).ok).toBe(false)
    expect(addBlock(root, lib, hero!._uid, 'body', newBlock(lib.get('cta')!)).message).toContain('no blocks field')
    expect(findBlock(removeBlock(root, lib, hero!._uid).content, hero!._uid, lib)).toBeNull()
  })

  test('tree operations take the editor\'s reactive proxies', () => {
    const lib = libraryOf()
    const root = normalizeContent({ component: 'page', body: [newBlock(lib.get('hero')!)] }, lib, 'page').content
    const hero = (root.body as CmsBlock[])[0]!
    const proxied = new Proxy(root, {})
    expect(addBlock(proxied, lib, root._uid, 'body', newBlock(lib.get('cta')!)).ok).toBe(true)
    expect(duplicateBlock(proxied, lib, hero._uid).ok).toBe(true)
  })

  test('a new feature grid comes with example cards', () => {
    const grid = newBlock(libraryOf().get('features')!)
    expect((grid.items as CmsBlock[]).length).toBe(3)
    expect(new Set((grid.items as CmsBlock[]).map(b => b._uid)).size).toBe(3)
  })

  test('style keeps only known values', () => {
    expect(normalizeStyle({ accent: '#FF0066', mode: 'neon', headingFont: 'Space Grotesk', bodyFont: 'x;}</style>' })).toMatchObject({ accent: '#ff0066', mode: 'light', headingFont: 'Space Grotesk', bodyFont: '' })
  })
})

describe('rendering', () => {
  test('values are escaped or checked for their type', () => {
    const lib = libraryOf([custom({
      fields: [{ key: 'title', label: 'T', type: 'text' }, { key: 'link', label: 'L', type: 'url' }, { key: 'tint', label: 'C', type: 'color' }, { key: 'img', label: 'I', type: 'asset' }, { key: 'body', label: 'B', type: 'markdown' }],
      html: '<div style="color: {{@tint}}"><a href="{{@link}}">{{@title}}</a>{{#img}}<img src="{{@img}}" alt="{{@img.alt}}">{{/img}}{{^img}}<i>none</i>{{/img}}{{@body}}</div>'
    })])
    const block = { _uid: 'abcdef1', component: 'card', title: '<b>x</b>', link: 'javascript:alert(1)', tint: 'red;background:url(x)', body: 'Hi <script>alert(1)</script> [x](javascript:alert(1)) **b**' }
    const { html } = renderBlocks(block, normalizeStyle({}), '#5e6ad2', ctx(lib))
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('href="#"')
    expect(html).toContain('style="color: "')
    expect(html).toContain('<i>none</i>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('<strong>b</strong>')
    expect(html).toMatch(/^<div data-hb-uid="abcdef1" data-hb-component="card"/)
  })

  test('markdown drops raw HTML and unsafe image sources', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)> ![a](javascript:x)')).not.toMatch(/onerror|javascript|<img/)
  })

  test('nested blocks render inside their parent, with their animation', () => {
    const lib = libraryOf()
    const grid = newBlock(lib.get('features')!, { _anim: { effect: 'fade-up', stagger: 80 } })
    const { content } = normalizeContent({ component: 'page', body: [grid] }, lib, 'page')
    const { html, css } = renderBlocks(content, normalizeStyle({}), '#5e6ad2', ctx(lib))
    expect(html.match(/data-hb-component="feature"/g)).toHaveLength(3)
    expect(html).toContain('data-hb-anim="{&quot;effect&quot;:&quot;fade-up&quot;')
    expect(html).toContain('data-hb-hide')
    expect(css).toContain('/* features */')
    expect(css.match(/\/\* feature \*\//g)).toHaveLength(1)
  })

  test('every template fits the library and renders with no slot left over', () => {
    const lib = libraryOf()
    for (const t of CMS_TEMPLATES) {
      const start = templateContent(t.id, 'Rocket')!
      const { content, issues } = normalizeContent(start.content, lib, 'page')
      expect(issues).toEqual([])
      const page = renderPage({ name: t.name, content, style: normalizeStyle(start.style), projectAccent: '#ff5500', runtime: true }, ctx(lib))
      expect(page).not.toMatch(/\{\{|\{project\}/)
      expect(page).toContain('Rocket')
    }
  })

  test('the hosted page policy allows the runtime by its hash and Motion by its exact URL', async () => {
    const csp = await pageCsp('https://hb.test')
    expect(csp).toContain(`'sha256-${createHash('sha256').update(PAGE_RUNTIME).digest('base64')}'`)
    expect(csp).toContain('script-src \'sha256-')
    expect(csp).toContain('https://hb.test/vendor/motion-14.5.0.js')
    expect(csp).toContain("form-action 'self'")
    expect(csp).not.toContain('unsafe-eval')
  })
})

test('the wizard turns answers into a first message for the assistant', () => {
  const text = wizardPrompt({ product: 'Rocket', oneLiner: 'Launch faster', audience: 'Indie devs', goal: 'waitlist', layout: 'saas', repos: ['acme/rocket'] })
  expect(text).toContain('"SaaS launch"')
  expect(text).toContain('Join a waitlist')
  expect(text).toContain('acme/rocket')
  expect(wizardPrompt({ layout: 'new' })).toContain('new layout')
})

describe('the assistant\'s tools', () => {
  const setup = (rootType = 'page') => {
    const written: { type: string, data: unknown }[] = []
    const writer = { write: (part: { type: string, data: unknown }) => written.push(part) } as unknown as UIMessageStreamWriter
    const library = libraryOf()
    const state: CmsAiState = { library, rootType, content: normalizeContent({ component: rootType, body: [] }, library, rootType).content, name: 'Home', slug: 'home', style: normalizeStyle({}), changed: false, pageChanged: false, brief: EMPTY_BRIEF, saved: 0 }
    const saved: unknown[] = []
    const ctx: CmsAiContext = { project: { get: () => 'Rocket' } as never, saveComponent: async (input) => { saved.push(input); return { ...(input as never), id: 'c9', builtin: false } }, saveBrief: async () => {} }
    const tools = cmsAiTools(state, writer, ctx) as Record<string, { execute: (input: unknown, options: unknown) => Promise<string> }>
    const run = (name: string, input: unknown) => tools[name]!.execute(input, {})
    return { state, written, saved, run }
  }

  test('set_content builds the tree with defaults and streams it', async () => {
    const { state, written, run } = setup()
    const said = await run('set_content', { content: { title: 'Rocket', body: [{ component: 'hero', headline: 'Launch faster' }, { component: 'features', items: [{ component: 'feature', title: 'Fast' }] }] } })
    expect(said).toContain('hero')
    const [hero, features] = state.content!.body as CmsBlock[]
    expect(hero).toMatchObject({ component: 'hero', headline: 'Launch faster', primaryLabel: 'Get started' })
    // Explicit children replace a built-in's example ones.
    expect((features!.items as CmsBlock[]).map(b => b.title)).toEqual(['Fast'])
    expect(written.at(-1)!.type).toBe('data-content')
    expect(await run('set_content', { content: { body: [{ component: 'nope' }] } })).toContain('There is no component')
  })

  test('blocks are added, edited by uid and refused where their field does not take them', async () => {
    const { state, run } = setup()
    await run('add_block', { block: { component: 'faq', items: [] } })
    const faq = (state.content!.body as CmsBlock[])[0]!
    expect(await run('add_block', { block: { component: 'qa', question: 'Free?' }, parent: faq._uid, field: 'items' })).toContain('Added')
    expect(await run('add_block', { block: { component: 'hero' }, parent: faq._uid, field: 'items' })).toContain('takes only qa')
    const qa = (state.content!.body as CmsBlock[])[0]!.items as CmsBlock[]
    expect(qa.map(b => b.question)).toEqual(['Free?'])
    await run('update_blocks', { updates: [{ uid: qa[0]!._uid, values: { answer: 'Yes.', _anim: { effect: 'fade' } } }] })
    const updated = ((state.content!.body as CmsBlock[])[0]!.items as CmsBlock[])[0]!
    expect(updated).toMatchObject({ answer: 'Yes.', _anim: { effect: 'fade' } })
  })

  test('components it writes are checked before they are saved', async () => {
    const { state, saved, run } = setup()
    expect(await run('save_component', { key: 'hero', name: 'Mine', description: '', fields: [], html: '<div></div>', css: '' })).toContain('built-in')
    expect(await run('save_component', { key: 'evil', name: 'Evil', description: '', fields: [], html: '<div onclick="x()"></div>', css: '' })).toContain('Not saved')
    expect(saved).toHaveLength(0)
    expect(await run('save_component', { key: 'banner', name: 'Banner', description: 'A strip', fields: [{ key: 'text', type: 'text' }], html: '<div class="banner">{{@text}}</div>', css: '' })).toContain('Saved')
    expect(state.library.get('banner')).toBeDefined()
    expect(await run('add_block', { block: { component: 'banner', text: 'Hi' } })).toContain('Added')
  })

  test('templates restyle the page; a slug must be a slug', async () => {
    const { state, run } = setup()
    await run('apply_template', { template: 'waitlist' })
    expect(state.style.mode).toBe('dark')
    expect(JSON.stringify(state.content)).toContain('Rocket')
    expect(await run('update_page', { slug: 'Not A Slug' })).toContain('Not changed')
    await run('update_page', { slug: 'launch', style: { accent: '#ff0066' } })
    expect(state).toMatchObject({ slug: 'launch', pageChanged: true, style: { accent: '#ff0066' } })
  })
})
