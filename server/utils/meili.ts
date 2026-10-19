import { EMBEDDING_DIMENSIONS } from '#shared/knowledge'

// Meilisearch wrapper: the hybrid (lexical + vector) search backend for the
// knowledge base, and the full-text backend for the rest of the app
// (conversations, end-users). The SDK is lazy-imported so a missing package or
// unset MEILI_URL never breaks unrelated routes. Callers that want best-effort
// behaviour (live sync) wrap these in try/catch; ingestion lets errors surface
// so it can mark a document failed.

export const KNOWLEDGE_INDEX = 'knowledge'
export const CONVERSATIONS_INDEX = 'conversations'
export const ENDUSERS_INDEX = 'endusers'

let clientPromise: Promise<any> | null = null

export function meiliConfigured(): boolean {
  return Boolean(process.env.MEILI_URL)
}

async function useMeili(): Promise<any> {
  const host = process.env.MEILI_URL
  if (!host) throw new Error('MEILI_URL is not set')
  if (!clientPromise) {
    clientPromise = import('meilisearch').then(m => new m.Meilisearch({ host, apiKey: process.env.MEILI_MASTER_KEY || undefined }))
  }
  return clientPromise
}

/** Raw request for the version-fragile bits (experimental features, embedders). */
async function meiliFetch(path: string, init: RequestInit): Promise<Response> {
  const host = String(process.env.MEILI_URL || '').replace(/\/+$/, '')
  const key = process.env.MEILI_MASTER_KEY
  return fetch(`${host}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(init.headers || {}) } })
}

/**
 * Create indexes and (idempotently) set their attributes. Enables the vector
 * store and the knowledge index's userProvided embedder; both are wrapped so an
 * older Meilisearch that lacks vectors still gets working lexical search.
 */
export async function ensureSearchIndexes(): Promise<void> {
  const client = await useMeili()

  await meiliFetch('/experimental-features', { method: 'PATCH', body: JSON.stringify({ vectorStore: true }) }).catch(() => {})

  const wait = async (task: any) => { try { await client.waitForTask(task.taskUid ?? task.uid) } catch {} }
  await wait(await client.createIndex(KNOWLEDGE_INDEX, { primaryKey: 'id' }).catch(() => ({})))
  await wait(await client.createIndex(CONVERSATIONS_INDEX, { primaryKey: 'id' }).catch(() => ({})))
  await wait(await client.createIndex(ENDUSERS_INDEX, { primaryKey: 'id' }).catch(() => ({})))

  await client.index(KNOWLEDGE_INDEX).updateSettings({
    searchableAttributes: ['question', 'aliases', 'keywords', 'tags', 'pathCache', 'answer'],
    filterableAttributes: ['workspaceId', 'projectId', 'modelId', 'nodeId', 'pathCache', 'pathAncestors', 'status', 'language', 'tags'],
    sortableAttributes: ['updatedAt']
  })
  await client.index(CONVERSATIONS_INDEX).updateSettings({
    searchableAttributes: ['subject', 'preview', 'endUserName', 'endUserEmail'],
    filterableAttributes: ['workspaceId', 'projectId', 'status', 'endUserId'],
    sortableAttributes: ['lastMessageAt']
  })
  await client.index(ENDUSERS_INDEX).updateSettings({
    searchableAttributes: ['name', 'email', 'externalId', 'tags'],
    filterableAttributes: ['workspaceId', 'projectId']
  })

  // Semantic search is optional: a Meilisearch without vector support keeps the
  // lexical settings above.
  await meiliFetch(`/indexes/${KNOWLEDGE_INDEX}/settings/embedders`, {
    method: 'PATCH',
    body: JSON.stringify({ default: { source: 'userProvided', dimensions: EMBEDDING_DIMENSIONS } })
  }).catch(err => console.warn('[meili] embedders not set (vector search disabled):', (err as Error).message))
}

// Ensure indexes/embedder exist once per process, so vector indexing works even
// if the boot-time `search:setup` step was skipped. Best-effort and cached.
let ensured: Promise<void> | null = null
function ensureOnce(): Promise<void> {
  if (!ensured) ensured = ensureSearchIndexes().catch((e) => { ensured = null; throw e })
  return ensured
}

export async function indexDocuments(uid: string, docs: Record<string, unknown>[]): Promise<void> {
  if (!docs.length) return
  await ensureOnce().catch(err => console.warn('[meili] ensure indexes failed:', (err as Error).message))
  const client = await useMeili()
  await client.index(uid).addDocuments(docs)
}

export async function deleteDocuments(uid: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  const client = await useMeili()
  await client.index(uid).deleteDocuments(ids)
}

export async function deleteByFilter(uid: string, filter: string): Promise<void> {
  const client = await useMeili()
  await client.index(uid).deleteDocuments({ filter })
}

export type MeiliSearchOptions = {
  vector?: number[]
  filter?: string | string[]
  limit?: number
  semanticRatio?: number
}

/** Search an index. Passes a hybrid query when a vector is supplied. */
export async function searchIndex(uid: string, query: string, opts: MeiliSearchOptions = {}): Promise<any[]> {
  const client = await useMeili()
  const params: Record<string, unknown> = { limit: opts.limit ?? 20, showRankingScore: true }
  if (opts.filter) params.filter = opts.filter
  if (opts.vector && opts.vector.length) {
    params.vector = opts.vector
    params.hybrid = { embedder: 'default', semanticRatio: opts.semanticRatio ?? 0.5 }
  }
  const res = await client.index(uid).search(query, params)
  return res.hits || []
}
