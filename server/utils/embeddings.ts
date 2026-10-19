import { createHash, timingSafeEqual } from 'node:crypto'
import { EMBEDDING_DIMENSIONS } from '#shared/knowledge'
import { appRole, servesEmbeddings } from './appRole'

// EmbeddingProvider abstraction. The default runs the CLIP text encoder locally
// via transformers.js (ICON_EMBEDDING_MODEL, ICON_EMBEDDING_DEVICE); set
// EMBEDDING_ENDPOINT to offload to a remote OpenAI-style embeddings service
// instead. Nothing else in the app imports transformers.js directly, so the
// vendor stays behind this seam. Loading is lazy and cached; failures are the
// caller's to handle (ingestion degrades to lexical-only indexing).
//
// Only the roles that may load the model (APP_ROLE all or embedder) ever run
// it. The others ask EMBEDDING_ENDPOINT (in the hosted stack, the embedder's
// POST /v1/internal/embeddings), or go without vectors.

export type EmbeddingProvider = {
  dimensions: number
  embedText(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

/** The most texts one call to /v1/internal/embeddings takes; the remote provider sends bigger batches in pieces. */
export const EMBED_MAX_TEXTS = 256
/** Each text is cut to this many characters (CLIP reads 77 tokens anyway). */
export const EMBED_MAX_CHARS = 2000

let provider: EmbeddingProvider | null = null
let loading: Promise<EmbeddingProvider> | null = null
let local: Promise<EmbeddingProvider> | null = null
let warnedOff = false

const endpointOf = (env: Record<string, string | undefined>) => String(env.EMBEDDING_ENDPOINT || '').trim()

/**
 * Whether embeddings should be attempted at all: not when switched off (an
 * ops off-switch), nor on a role that may not load the model and has no
 * EMBEDDING_ENDPOINT to ask instead.
 */
export function embeddingsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.KNOWLEDGE_DISABLE_EMBEDDINGS === '1') return false
  if (endpointOf(env) || servesEmbeddings(env)) return true
  if (!warnedOff) {
    warnedOff = true
    console.warn(`[embeddings] APP_ROLE=${appRole(env)} does not load the model and EMBEDDING_ENDPOINT is not set: knowledge search runs without vectors`)
  }
  return false
}

function l2normalize(v: number[]): number[] {
  let sum = 0
  for (const x of v) sum += x * x
  const norm = Math.sqrt(sum) || 1
  return v.map(x => x / norm)
}

function remoteProvider(endpoint: string): EmbeddingProvider {
  const key = String(process.env.EMBEDDING_API_KEY || '').trim()
  const model = String(process.env.ICON_EMBEDDING_MODEL || '').trim()
  const embedChunk = async (texts: string[]): Promise<number[][]> => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ input: texts, ...(model ? { model } : {}) }),
      signal: AbortSignal.timeout(60_000)
    })
    if (!res.ok) throw new Error(`embedding endpoint returned ${res.status}`)
    const json = await res.json() as any
    const arr: number[][] | undefined = Array.isArray(json?.data) ? json.data.map((d: any) => d.embedding) : json?.embeddings
    if (!Array.isArray(arr)) throw new Error('embedding endpoint returned no vectors')
    return arr.map(l2normalize)
  }
  const embedBatch = async (texts: string[]): Promise<number[][]> => {
    const vectors: number[][] = []
    for (let i = 0; i < texts.length; i += EMBED_MAX_TEXTS) vectors.push(...await embedChunk(texts.slice(i, i + EMBED_MAX_TEXTS)))
    return vectors
  }
  return { dimensions: EMBEDDING_DIMENSIONS, embedBatch, embedText: async t => (await embedBatch([t]))[0]! }
}

/** The model this process runs when it embeds locally. */
export function localEmbeddingModel(env: Record<string, string | undefined> = process.env): string {
  return String(env.ICON_EMBEDDING_MODEL || '').trim() || 'Xenova/clip-vit-large-patch14'
}

async function localProvider(): Promise<EmbeddingProvider> {
  const model = localEmbeddingModel()
  // transformers.js uses the onnxruntime-node backend under Bun/Node, which only
  // accepts cpu/cuda (wasm/webgpu are browser-only and throw "Unsupported device").
  const wanted = String(process.env.ICON_EMBEDDING_DEVICE || 'cpu').trim() || 'cpu'
  const tf: any = await import('@huggingface/transformers')
  if (process.env.TRANSFORMERS_CACHE) tf.env.cacheDir = process.env.TRANSFORMERS_CACHE

  const load = async (device: string) => {
    const tokenizer = await tf.AutoTokenizer.from_pretrained(model)
    const textModel = await tf.CLIPTextModelWithProjection.from_pretrained(model, { device, dtype: 'fp32' })
    return { tokenizer, textModel }
  }

  let m: { tokenizer: any, textModel: any }
  try {
    m = await load(wanted)
  } catch (error) {
    if (wanted === 'cpu') throw error
    console.warn(`[embeddings] device "${wanted}" failed, falling back to cpu:`, (error as Error).message)
    m = await load('cpu')
  }

  const embedBatch = async (texts: string[]): Promise<number[][]> => {
    const inputs = await m.tokenizer(texts, { padding: true, truncation: true })
    const out = await m.textModel(inputs)
    const tensor = out.text_embeds ?? out.text_embeds_projected ?? out.pooler_output
    if (!tensor) throw new Error('CLIP text model returned no text_embeds')
    const list: number[][] = tensor.tolist()
    return list.map(l2normalize)
  }
  return { dimensions: EMBEDDING_DIMENSIONS, embedBatch, embedText: async t => (await embedBatch([t]))[0]! }
}

/**
 * The model in this process, whatever EMBEDDING_ENDPOINT says: what the
 * embedder serves (asking the endpoint there could mean asking itself).
 * Loaded once; a failed load is tried again on the next call.
 */
export function localEmbeddingProvider(): Promise<EmbeddingProvider> {
  local ||= localProvider().catch((error) => { local = null; throw error })
  return local
}

/** Lazily construct and cache the embedding provider. */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (provider) return provider
  if (!loading) {
    const endpoint = endpointOf(process.env)
    if (!endpoint && !servesEmbeddings()) throw new Error(`APP_ROLE=${appRole()} does not load the embedding model; set EMBEDDING_ENDPOINT`)
    loading = (endpoint ? Promise.resolve(remoteProvider(endpoint)) : localEmbeddingProvider())
      .then((p) => { provider = p; return p })
      .catch((error) => { loading = null; throw error })
  }
  return loading
}

// ---- the embedder's side: POST /v1/internal/embeddings --------------------------

/**
 * Whether a request may use this process's model: a role that loads it,
 * EMBEDDING_API_KEY set, and that key as the bearer token. Anything else is
 * answered as if the route did not exist. Both sides are hashed first, so the
 * comparison takes the same time whatever the length of the guess.
 */
export function embedderAuthorized(authorization: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const key = String(env.EMBEDDING_API_KEY || '').trim()
  if (!key || !servesEmbeddings(env)) return false
  const given = /^Bearer\s+(\S+)\s*$/i.exec(String(authorization || ''))?.[1]
  if (!given) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(given), digest(key))
}

/** The texts to embed: `input` as one string or a list of 1 to EMBED_MAX_TEXTS strings, each clipped. Null when it is anything else. */
export function embeddingInputs(input: unknown): string[] | null {
  const list = typeof input === 'string' ? [input] : input
  if (!Array.isArray(list) || !list.length || list.length > EMBED_MAX_TEXTS) return null
  if (!list.every(item => typeof item === 'string')) return null
  return list.map(text => text.slice(0, EMBED_MAX_CHARS))
}
