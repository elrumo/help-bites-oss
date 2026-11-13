import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { UNLIMITED_PLAN } from '../shared/entitlements'
import * as editionModule from '../server/utils/edition'
import * as secrets from '../server/utils/secrets'
import { suggestChangelogMerges } from '../server/utils/changelogMergeAi'
import { resolveJev, type AiRoute } from '../server/utils/aiGateway'
import type { MergeEntryInfo } from '../shared/changelogMerge'

const g = globalThis as Record<string, unknown>
Object.assign(g, editionModule, secrets)
g.workspacePlan = async () => UNLIMITED_PLAN
g.readUsage = async () => 0
g.chargeUsage = async () => {}
const realFetch = g.fetch
const realCreateError = g.createError
g.createError = (e: { statusCode: number, statusMessage: string }) => Object.assign(new Error(e.statusMessage), e)

const e = (id: string, title: string): MergeEntryInfo => ({ id, title, tag: 'improved', summary: '', body: '', area: '' })
const entries = [e('a', 'Histogram clipping warning'), e('b', 'Histogram clipping warning fix'), e('c', 'Grain engine'), e('d', 'Crop overlay')]
const llm: AiRoute = { source: 'platform', endpoint: 'http://llm.test', apiKey: 'k', model: 'm', metered: true, workspaceId: 'w' }
const jev: AiRoute = { ...llm, endpoint: 'http://litellm.test/typesafe', model: 'jev-latest' }

function fakeFetch(yes: (state: any, name: string) => boolean, chatReply: unknown = { merges: [{ ids: ['a', 'b'], title: 'Clipping warning', body: 'Shows clipped areas.', tag: 'new', reason: 'Same feature' }] }, jevStatuses: number[] = []) {
  const calls = { jev: [] as any[], chat: 0 }
  g.fetch = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/v1/systemone')) {
      calls.jev.push({ url, body, auth: (init.headers as Record<string, string>).Authorization })
      const status = jevStatuses.shift()
      if (status) return new Response('busy', { status })
      return Response.json({ answers: Object.fromEntries(Object.keys(body.questions).map(n => [n, { type: 'noul', noul: yes(body.state, n) ? 0.95 : 0.05 }])), usage: { input_tokens: 100 } })
    }
    calls.chat++
    return Response.json({ choices: [{ message: { content: typeof chatReply === 'string' ? chatReply : JSON.stringify(chatReply) } }] })
  }
  return calls
}

describe('suggestChangelogMerges with Jev', () => {
  afterEach(() => editionModule.resetEdition())
  // bun shares one process across test files: put back what this file replaced.
  afterAll(() => { g.fetch = realFetch; g.createError = realCreateError })
  test('Jev judges the pairs through the gateway path, the chat model writes the one group', async () => {
    const calls = fakeFetch((state, name) => state.entry.title.startsWith('Histogram') && name === 'p1')
    const merges = await suggestChangelogMerges(entries, llm, jev)
    expect(merges).toEqual([{ refs: ['a', 'b'], title: 'Clipping warning', body: 'Shows clipped areas.', tag: 'new', reason: 'Same feature' }])
    expect(calls.jev[0].url).toBe('http://litellm.test/typesafe/v1/systemone')
    expect(calls.jev[0].body.model).toBe('jev-latest')
    expect(calls.chat).toBe(1)
  })
  test('nothing judged alike means no merges and no chat call', async () => {
    const calls = fakeFetch(() => false)
    expect(await suggestChangelogMerges(entries, llm, jev)).toEqual([])
    expect(calls.chat).toBe(0)
  })
  test('without Jev a list over the chat-only limit is refused', async () => {
    const many = Array.from({ length: 101 }, (_, i) => e(`n${i}`, `T${i}`))
    await expect(suggestChangelogMerges(many, llm, null)).rejects.toMatchObject({ statusCode: 400 })
  })
  test('a pair just under the threshold is not joined', async () => {
    g.fetch = async (url: string) => {
      return url.endsWith('/v1/systemone') ? Response.json({ answers: { p1: { noul: 0.69 } }, usage: { input_tokens: 1 } }) : Response.json({ choices: [{ message: { content: '{"merges":[]}' } }] })
    }
    expect(await suggestChangelogMerges(entries.slice(0, 2), llm, jev)).toEqual([])
  })
  test('a busy Jev (429, then 529) is retried and the run still succeeds', async () => {
    const calls = fakeFetch((state, name) => name === 'p1' && state.entry.title === 'Histogram clipping warning', undefined, [429, 529])
    const merges = await suggestChangelogMerges(entries.slice(0, 2), llm, jev)
    expect(merges).toHaveLength(1)
    expect(calls.jev).toHaveLength(3)
  }, 15_000)
  test('a Jev failure rejects with its status in the message', async () => {
    fakeFetch(() => true, undefined, [500])
    await expect(suggestChangelogMerges(entries.slice(0, 2), llm, jev)).rejects.toThrow('Jev returned 500')
  })
  test('the gateway key is sent as a Bearer token', async () => {
    const calls = fakeFetch(() => false)
    await suggestChangelogMerges(entries.slice(0, 2), llm, jev)
    expect(calls.jev[0].auth).toBe('Bearer k')
  })
  test('a group the chat model leaves out still comes back, with the sources put together', async () => {
    fakeFetch(() => true, { merges: [] })
    const merges = await suggestChangelogMerges(entries.slice(0, 2), llm, jev)
    expect(merges).toHaveLength(1)
    expect(merges[0]).toMatchObject({ refs: ['a', 'b'], title: 'Histogram clipping warning' })
  })
  test('a hallucinated or partial group from the chat model is replaced by the fallback', async () => {
    fakeFetch(() => true, { merges: [{ ids: ['a', 'zzz'], title: 'Made up' }] })
    const merges = await suggestChangelogMerges(entries.slice(0, 2), llm, jev)
    expect(merges.map(m => m.title)).toEqual(['Histogram clipping warning'])
  })
  test('hundreds of entries: one pair per request, bounded requests, groups capped at 10, every entry in at most one group', async () => {
    const big = Array.from({ length: 300 }, (_, i) => e(`id${i}`, `Topic${i % 30} feature${i % 30} polish`))
    // Jev says yes to everything: the worst case for chaining. The chat model leaves every group to the fallback.
    const calls = fakeFetch(() => true, { merges: [] })
    const merges = await suggestChangelogMerges(big, llm, jev)
    expect(calls.jev.length).toBeLessThanOrEqual(300 * 12) // one request per candidate pair, 12 neighbours each at most
    expect(calls.jev.every(c => Object.keys(c.body.questions).length === 1)).toBe(true)
    expect(merges.length).toBeGreaterThan(0)
    expect(merges.every(m => m.refs.length >= 2 && m.refs.length <= 10)).toBe(true)
    const seen = merges.flatMap(m => m.refs)
    expect(new Set(seen).size).toBe(seen.length)
  }, 30_000)
  test('Jev usage is billed once per run from the summed tokens, not once per request', async () => {
    const seen: { inputTokens: number }[] = []
    editionModule.registerEdition({ id: 'cloud', aiCredits: (call) => { seen.push(call); return 1 } })
    fakeFetch(() => false)
    await suggestChangelogMerges([...entries, e('x', 'Another'), e('y', 'More')], llm, jev)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.inputTokens).toBeGreaterThan(100)
  })
})

describe('resolveJev', () => {
  const keep = { ...process.env }
  afterEach(() => { for (const k of ['JEV_API_BASE_URL', 'JEV_API_KEY', 'JEV_MODEL', 'LITELLM_API_KEY']) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k] } })
  test('off without JEV_API_BASE_URL', () => {
    delete process.env.JEV_API_BASE_URL
    expect(resolveJev('w')).toBeNull()
  })
  test('trims the base, accepts a full /v1/systemone URL, defaults the key to the gateway key and the model to jev-latest', () => {
    process.env.JEV_API_BASE_URL = ' https://llm.test/typesafe/v1/systemone/ '
    process.env.LITELLM_API_KEY = 'sk-gw'
    delete process.env.JEV_API_KEY
    delete process.env.JEV_MODEL
    expect(resolveJev('w')).toMatchObject({ endpoint: 'https://llm.test/typesafe', apiKey: 'sk-gw', model: 'jev-latest', metered: true, workspaceId: 'w' })
    process.env.JEV_API_KEY = 'sk-jev'
    process.env.JEV_MODEL = 'jev-1.14.0'
    expect(resolveJev('w')).toMatchObject({ apiKey: 'sk-jev', model: 'jev-1.14.0' })
  })
})
