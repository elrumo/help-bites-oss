import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// public/helpbites.js run against a tiny fake page: which scripts it adds, with
// which attributes, and where HelpBites.push calls end up.

const source = readFileSync(join(import.meta.dir, '..', 'public/helpbites.js'), 'utf8')

type FakeScript = { src: string, attrs: Record<string, string>, listeners: Record<string, (() => void)[]>, getAttribute: (name: string) => string | null, setAttribute: (name: string, value: string) => void, addEventListener: (name: string, fn: () => void) => void, readonly attributes: { name: string, value: string }[] }

function script(attrs: Record<string, string>, src = ''): FakeScript {
  const s: FakeScript = {
    src,
    attrs: { ...attrs },
    listeners: {},
    getAttribute: name => (name === 'src' ? (src || null) : s.attrs[name] ?? null),
    setAttribute: (name, value) => { s.attrs[name] = value },
    addEventListener: (name, fn) => { (s.listeners[name] ||= []).push(fn) },
    get attributes() { return Object.entries(s.attrs).map(([name, value]) => ({ name, value })) }
  }
  return s
}

type Loader = { modules?: Record<string, { enabled: boolean, flows?: string[] }> }

async function run(attrs: Record<string, string>, options: { loader?: Loader | 'down', onPage?: string[], globals?: Record<string, unknown> } = {}) {
  const tag = script({ 'data-project': 'pk_test', ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [`data-${k}`, v])) }, 'https://help.example.com/helpbites.js')
  const onPage: FakeScript[] = [tag, ...(options.onPage || []).map(name => script({}, `https://cdn.example.com/${name}`))]
  const injected: FakeScript[] = []
  const events: { type: string, detail: { modules: string[] } }[] = []
  const win: Record<string, any> = { ...(options.globals || {}), dispatchEvent: (e: any) => { events.push(e) } }
  const doc = {
    currentScript: tag,
    getElementsByTagName: () => onPage,
    createElement: () => script({}),
    head: { appendChild: (s: FakeScript) => { onPage.push(s); injected.push(s) } }
  }
  const fetched: string[] = []
  const fetchMock = async (url: string) => {
    fetched.push(url)
    if (options.loader === 'down') throw new Error('offline')
    return { ok: true, json: async () => ({ project: { name: 'Acme', publicKey: 'pk_test' }, modules: { chat: { enabled: true }, feedback: { enabled: true }, changelog: { enabled: true }, onboarding: { enabled: true, flows: ['tour', 'welcome'] }, ...(options.loader?.modules || {}) }, hub: { enabled: false, url: '' }, accent: '#4f46e5' }) }
  }
  class CustomEventMock { type: string; detail: any; constructor(type: string, init: any) { this.type = type; this.detail = init?.detail } }
  const location = { href: 'https://site.example.com/' }
  new Function('window', 'document', 'fetch', 'location', 'CustomEvent', 'console', 'setTimeout', 'clearTimeout', source)(win, doc, fetchMock, location, CustomEventMock, { warn: () => {} }, setTimeout, clearTimeout)
  await new Promise(resolve => setTimeout(resolve, 5))
  const file = (s: FakeScript) => s.src.split('/').pop()
  return { win, injected, events, fetched, file, load: (s: FakeScript) => s.listeners.load?.forEach(fn => fn()) }
}

describe('helpbites.js', () => {
  test('asks the project what it has, then adds the chat and nothing else by default', async () => {
    const page = await run({})
    expect(page.fetched).toEqual(['https://help.example.com/v1/hub/pk_test/loader'])
    expect(page.injected.map(page.file)).toEqual(['widget.js'])
    expect(page.injected[0]!.src).toBe('https://help.example.com/widget.js')
    expect(page.injected[0]!.attrs['data-project']).toBe('pk_test')
    expect(page.events[0]!.detail.modules).toEqual(['chat'])
  })

  test('data-features names the modules, and a module the project lacks is left out', async () => {
    const page = await run({ features: 'chat, feedback,changelog', 'changelog-target': '#log' }, { loader: { modules: { feedback: { enabled: false } } } })
    expect(page.injected.map(page.file)).toEqual(['widget.js', 'changelog.js'])
    const only = await run({ features: 'feedback' })
    expect(only.injected.map(only.file)).toEqual(['feedback.js'])
  })

  test('attributes pass through; a module prefix aims one at one module', async () => {
    const page = await run({ features: 'chat,feedback,onboarding', accent: '#ff0066', position: 'left', locale: 'es', mode: 'inline', target: '#chat', 'feedback-position': 'right', 'feedback-target': '#board', 'onboarding-show': 'update' })
    const [chat, feedback, onboarding] = page.injected
    expect(chat!.attrs).toMatchObject({ 'data-project': 'pk_test', 'data-accent': '#ff0066', 'data-position': 'left', 'data-locale': 'es', 'data-mode': 'inline', 'data-target': '#chat' })
    expect(feedback!.attrs).toMatchObject({ 'data-accent': '#ff0066', 'data-position': 'right', 'data-target': '#board' })
    // data-mode and data-target are the chat's alone.
    expect(feedback!.attrs['data-mode']).toBeUndefined()
    expect(onboarding!.attrs['data-target']).toBeUndefined()
    // The flow it was not told is the project's own "welcome".
    expect(onboarding!.attrs).toMatchObject({ 'data-flow': 'welcome', 'data-show': 'update', 'data-locale': 'es' })
  })

  test('a script already on the page is never added twice', async () => {
    const page = await run({ features: 'chat,feedback' }, { onPage: ['widget.js?v=2'.split('?')[0]!] })
    expect(page.injected.map(page.file)).toEqual(['feedback.js'])
    const both = await run({ features: 'chat,feedback' }, { onPage: ['widget.js', 'feedback.js'] })
    expect(both.injected).toEqual([])
  })

  test('when HelpBites cannot be reached the modules asked for still load', async () => {
    const page = await run({ features: 'chat,changelog', 'changelog-target': '#log' }, { loader: 'down' })
    expect(page.injected.map(page.file)).toEqual(['widget.js', 'changelog.js'])
  })

  test('an onboarding flow needs a name, from the page or the project', async () => {
    const named = await run({ flow: 'tour' })
    expect(named.injected.map(named.file)).toEqual(['widget.js', 'onboarding.js'])
    expect(named.injected[1]!.attrs['data-flow']).toBe('tour')
    const none = await run({ features: 'onboarding' }, { loader: { modules: { onboarding: { enabled: false, flows: [] } } } })
    expect(none.injected).toEqual([])
  })

  test('HelpBites.push before the chat loads is kept for it; module calls go to their own queue', async () => {
    const page = await run({}, { globals: { HelpBites: [['init', { context: { a: 1 } }]] } })
    const queue = page.win.HelpBites
    expect(Array.isArray(queue)).toBe(true)
    queue.push(['open'])
    queue.push(['feedback', 'open'])
    queue.push(['onboarding', 'reset'])
    expect(Array.from(queue)).toEqual([['init', { context: { a: 1 } }], ['open']])
    expect(page.win.HelpBitesFeedback).toEqual([['open']])
    expect(page.win.HelpBitesOnboarding).toEqual([['reset']])
  })

  test('once the chat has loaded the same calls still reach the right module, and the page is not asked to init twice', async () => {
    const page = await run({ token: 'eyJ.test' })
    const calls: unknown[] = []
    // What widget.js does when it finishes: replace window.HelpBites with its own object.
    page.win.HelpBites = { push: (cmd: unknown[]) => { calls.push(cmd) } }
    page.load(page.injected[0]!)
    // The page did not init, so the loader does, with the token it was given.
    expect((calls[0] as any)[0]).toBe('init')
    expect(await (calls[0] as any)[1].getToken()).toBe('eyJ.test')
    page.win.HelpBites.push(['setContext', { page: 'x' }])
    page.win.HelpBites.push(['chat', 'close'])
    page.win.HelpBites.push(['feedback', 'open'])
    expect(calls.slice(1)).toEqual([['setContext', { page: 'x' }], ['close']])
    expect(page.win.HelpBitesFeedback).toEqual([['open']])

    // A page that called init itself is left alone.
    const own = await run({}, { globals: { HelpBites: [['init', {}]] } })
    const ownCalls: unknown[] = []
    own.win.HelpBites = { push: (cmd: unknown[]) => { ownCalls.push(cmd) } }
    own.load(own.injected[0]!)
    expect(ownCalls).toEqual([])
  })
})
