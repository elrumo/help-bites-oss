// Ensures the Meilisearch indexes and their settings exist, idempotently.
// Mirrors server/utils/meili.ts ensureSearchIndexes() for use at container boot
// and from `bun run search:setup`. Never fails the boot: a missing MEILI_URL or
// an older Meilisearch (no vector support) degrades to lexical search.
//
// It also gives documents indexed before workspaces their workspaceId: every
// search filters on it, so a document without one would never be found.
//
//   bun scripts/ensure-search.mjs

import { parseFetch } from './parseRest.mjs'

const HOST = String(process.env.MEILI_URL || '').replace(/\/+$/, '')
// The scoped key from `bun run search:key`; the master key for older deployments.
const KEY = process.env.MEILI_API_KEY || process.env.MEILI_MASTER_KEY
const DIMENSIONS = 768 // Xenova/clip-vit-large-patch14 text encoder

async function meili(path, method = 'GET', body) {
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) }
}

async function waitTask(uid, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (uid !== undefined && Date.now() < deadline) {
    const { body } = await meili(`/tasks/${uid}`)
    if (body?.status === 'succeeded' || body?.status === 'failed' || body?.status === 'canceled') return body
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return null
}

async function idMap(className, keys, value) {
  const out = new Map()
  let after = ''
  for (;;) {
    const query = new URLSearchParams({ where: JSON.stringify(after ? { objectId: { $gt: after } } : {}), order: 'objectId', limit: '1000', keys })
    const { ok, body } = await parseFetch(`/classes/${className}?${query}`)
    if (!ok) throw new Error(`${className} query failed`)
    for (const row of body.results || []) out.set(row.objectId, value(row))
    if ((body.results || []).length < 1000) return out
    after = body.results.at(-1).objectId
  }
}

/** The fields a pre-workspace document is missing, from its project or knowledge model ('' when that is gone). */
export function workspaceFields(uid, doc, { projectWorkspace, models }) {
  if (uid === 'knowledge') {
    const model = models.get(doc.modelId)
    return { id: doc.id, workspaceId: model?.workspaceId || '', projectId: model?.projectId || '' }
  }
  return { id: doc.id, workspaceId: projectWorkspace.get(doc.projectId) || '' }
}

async function backfillWorkspaces() {
  const pointer = value => value?.objectId || ''
  const projectWorkspace = await idMap('Project', 'workspace', row => pointer(row.workspace))
  const models = await idMap('KnowledgeModel', 'workspace,project', row => ({ workspaceId: pointer(row.workspace), projectId: pointer(row.project) }))
  for (const uid of ['conversations', 'endusers', 'knowledge']) {
    let done = 0
    for (;;) {
      const page = await meili(`/indexes/${uid}/documents/fetch`, 'POST', { filter: 'workspaceId NOT EXISTS', limit: 1000, fields: ['id', 'projectId', 'modelId'] })
      const docs = page.body?.results || []
      if (!page.ok || !docs.length) break
      // A partial update: FAQ vectors and every other field stay as they are.
      const task = await meili(`/indexes/${uid}/documents`, 'PUT', docs.map(doc => workspaceFields(uid, doc, { projectWorkspace, models })))
      await waitTask(task.body?.taskUid)
      done += docs.length
      if (docs.length < 1000) break
    }
    if (done) console.log(`~ ${uid}: ${done} document(s) placed in their workspace`)
  }
}

async function main() {
  if (!HOST) {
    console.log('MEILI_URL not set — skipping search setup (lexical/Meili features disabled).')
    return
  }

  await meili('/experimental-features', 'PATCH', { vectorStore: true }).catch(() => {})

  for (const uid of ['knowledge', 'conversations', 'endusers']) {
    const res = await meili('/indexes', 'POST', { uid, primaryKey: 'id' })
    if (res.ok) console.log(`+ index ${uid}`)
    else if (res.status !== 409 && !(res.body?.code === 'index_already_exists')) console.log(`= index ${uid} (${res.status})`)
  }

  await meili('/indexes/knowledge/settings', 'PATCH', {
    searchableAttributes: ['question', 'aliases', 'keywords', 'tags', 'pathCache', 'answer'],
    filterableAttributes: ['workspaceId', 'projectId', 'modelId', 'nodeId', 'pathCache', 'pathAncestors', 'status', 'language', 'tags'],
    sortableAttributes: ['updatedAt']
  })
  await meili('/indexes/conversations/settings', 'PATCH', {
    searchableAttributes: ['subject', 'preview', 'endUserName', 'endUserEmail'],
    filterableAttributes: ['workspaceId', 'projectId', 'status', 'endUserId'],
    sortableAttributes: ['lastMessageAt']
  })
  const settled = await meili('/indexes/endusers/settings', 'PATCH', {
    searchableAttributes: ['name', 'email', 'externalId', 'tags'],
    filterableAttributes: ['workspaceId', 'projectId']
  })

  const emb = await meili('/indexes/knowledge/settings/embedders', 'PATCH', { default: { source: 'userProvided', dimensions: DIMENSIONS } })
  console.log(emb.ok ? '+ knowledge embedder (vector search on)' : `= embedders not set — lexical only (${emb.status})`)

  // Filtering on workspaceId needs the settings above applied first.
  await waitTask(settled.body?.taskUid)
  if (process.env.PARSE_URL) await backfillWorkspaces().catch(error => console.warn('[ensure-search] workspace backfill skipped:', error.message || error))

  console.log('Search indexes ensured.')
}

if (import.meta.main) {
  main().catch((error) => {
    // Never block boot on search setup.
    console.warn('[ensure-search] skipped:', error.message || error)
  })
}
