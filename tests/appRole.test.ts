import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { appRole, runsWorkers, servesEmbeddings } from '../server/utils/appRole'
import { EMBED_MAX_CHARS, EMBED_MAX_TEXTS, embedderAuthorized, embeddingInputs, embeddingsEnabled, getEmbeddingProvider, localEmbeddingModel } from '../server/utils/embeddings'

const env = { ...process.env }
afterEach(() => {
  for (const key of ['APP_ROLE', 'EMBEDDING_ENDPOINT', 'EMBEDDING_API_KEY', 'KNOWLEDGE_DISABLE_EMBEDDINGS']) {
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
})

describe('app roles', () => {
  test('all unless APP_ROLE names another role', () => {
    expect(appRole({})).toBe('all')
    expect(appRole({ APP_ROLE: '' })).toBe('all')
    expect(appRole({ APP_ROLE: 'web' })).toBe('web')
    expect(appRole({ APP_ROLE: ' Worker ' })).toBe('worker')
    expect(appRole({ APP_ROLE: 'EMBEDDER' })).toBe('embedder')
    expect(appRole({ APP_ROLE: 'scheduler' })).toBe('all')
  })

  test('background work runs on all and worker only', () => {
    expect(['all', 'web', 'worker', 'embedder'].map(role => runsWorkers({ APP_ROLE: role }))).toEqual([true, false, true, false])
    expect(runsWorkers({})).toBe(true)
  })

  test('the model loads on all and embedder only', () => {
    expect(['all', 'web', 'worker', 'embedder'].map(role => servesEmbeddings({ APP_ROLE: role }))).toEqual([true, false, false, true])
    expect(servesEmbeddings({})).toBe(true)
  })
})

describe('embeddings by role', () => {
  test('a web or worker container without an endpoint goes without vectors, and says so once', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    expect(embeddingsEnabled({ APP_ROLE: 'web' })).toBe(false)
    expect(embeddingsEnabled({ APP_ROLE: 'worker' })).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  test('with an endpoint any role embeds; the switch still turns it off', () => {
    expect(embeddingsEnabled({ APP_ROLE: 'web', EMBEDDING_ENDPOINT: 'http://app-embedder:3000/v1/internal/embeddings' })).toBe(true)
    expect(embeddingsEnabled({})).toBe(true)
    expect(embeddingsEnabled({ APP_ROLE: 'embedder' })).toBe(true)
    expect(embeddingsEnabled({ KNOWLEDGE_DISABLE_EMBEDDINGS: '1' })).toBe(false)
  })

  test('a web container never loads the model itself', async () => {
    process.env.APP_ROLE = 'web'
    delete process.env.EMBEDDING_ENDPOINT
    await expect(getEmbeddingProvider()).rejects.toThrow('does not load the embedding model')
  })

  test('with an endpoint it asks the embedder, at most 256 texts a call, with the key', async () => {
    process.env.APP_ROLE = 'web'
    process.env.EMBEDDING_ENDPOINT = 'http://app-embedder:3000/v1/internal/embeddings'
    process.env.EMBEDDING_API_KEY = 'k'.repeat(32)
    const calls: { url: string, input: string[], auth: string }[] = []
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init: RequestInit) => {
      const input = JSON.parse(String(init.body)).input as string[]
      calls.push({ url, input, auth: String((init.headers as Record<string, string>).Authorization) })
      return new Response(JSON.stringify({ data: input.map((_, index) => ({ embedding: [3, 4], index })), model: 'm' }))
    }) as unknown as typeof fetch)
    const provider = await getEmbeddingProvider()
    const vectors = await provider.embedBatch(Array.from({ length: 600 }, (_, i) => `text ${i}`))
    fetchSpy.mockRestore()
    expect(calls.map(call => call.input.length)).toEqual([EMBED_MAX_TEXTS, EMBED_MAX_TEXTS, 600 - 2 * EMBED_MAX_TEXTS])
    expect(calls[2]!.input.at(-1)).toBe('text 599')
    expect(calls.every(call => call.url === process.env.EMBEDDING_ENDPOINT && call.auth === `Bearer ${'k'.repeat(32)}`)).toBe(true)
    expect(vectors).toHaveLength(600)
    expect(vectors[0]).toEqual([0.6, 0.8])
  })

  test('the local model is named by ICON_EMBEDDING_MODEL, or the default', () => {
    expect(localEmbeddingModel({})).toBe('Xenova/clip-vit-large-patch14')
    expect(localEmbeddingModel({ ICON_EMBEDDING_MODEL: ' Xenova/other ' })).toBe('Xenova/other')
  })
})

describe('the embedder endpoint', () => {
  const key = 'secret-embedding-key-0123456789'
  const embedder = { APP_ROLE: 'embedder', EMBEDDING_API_KEY: key }

  test('answers the right bearer key on a role that loads the model', () => {
    expect(embedderAuthorized(`Bearer ${key}`, embedder)).toBe(true)
    expect(embedderAuthorized(`bearer  ${key} `, embedder)).toBe(true)
    expect(embedderAuthorized(`Bearer ${key}`, { ...embedder, APP_ROLE: 'all' })).toBe(true)
  })

  test('is not there without a key, for a wrong one, or on web and worker', () => {
    expect(embedderAuthorized(`Bearer ${key}`, { APP_ROLE: 'embedder' })).toBe(false)
    expect(embedderAuthorized('Bearer ', { APP_ROLE: 'embedder', EMBEDDING_API_KEY: '' })).toBe(false)
    expect(embedderAuthorized(undefined, embedder)).toBe(false)
    expect(embedderAuthorized(key, embedder)).toBe(false)
    expect(embedderAuthorized(`Bearer ${key}x`, embedder)).toBe(false)
    expect(embedderAuthorized(`Bearer ${key.slice(0, -1)}`, embedder)).toBe(false)
    expect(embedderAuthorized('Bearer x', embedder)).toBe(false)
    expect(embedderAuthorized(`Basic ${key}`, embedder)).toBe(false)
    expect(embedderAuthorized(`Bearer ${key}`, { ...embedder, APP_ROLE: 'web' })).toBe(false)
    expect(embedderAuthorized(`Bearer ${key}`, { ...embedder, APP_ROLE: 'worker' })).toBe(false)
  })

  test('takes one text or a list of up to 256, each clipped', () => {
    expect(embeddingInputs('hello')).toEqual(['hello'])
    expect(embeddingInputs(['a', 'b'])).toEqual(['a', 'b'])
    expect(embeddingInputs(['x'.repeat(EMBED_MAX_CHARS + 50)])![0]).toHaveLength(EMBED_MAX_CHARS)
    expect(embeddingInputs(Array.from({ length: EMBED_MAX_TEXTS }, () => 'a'))).toHaveLength(EMBED_MAX_TEXTS)
    expect(embeddingInputs(Array.from({ length: EMBED_MAX_TEXTS + 1 }, () => 'a'))).toBeNull()
    expect(embeddingInputs([])).toBeNull()
    expect(embeddingInputs(['a', 1])).toBeNull()
    expect(embeddingInputs(undefined)).toBeNull()
    expect(embeddingInputs({ input: 'a' })).toBeNull()
  })
})
