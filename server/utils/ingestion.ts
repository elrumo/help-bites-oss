import {
  parseFaqMarkdown, importKeyFor, normalizeQuestion, buildIndexText, outdatedImportKeys,
  type ImportPreview, type ImportPreviewEntry, type FaqOrigin
} from '#shared/knowledge'
import { embeddingsEnabled, getEmbeddingProvider } from './embeddings'
import { meiliConfigured, indexDocuments, KNOWLEDGE_INDEX } from './meili'

// The ingestion pipeline: parse → preview → commit → index. The parse is
// deterministic (shared/knowledge.ts); commit matches FAQs by a stable
// importKey so re-processing updates in place instead of duplicating, and never
// destroys an admin-edited ("detached") FAQ. Indexing (embeddings + Meili) runs
// after commit and degrades to lexical-only if embeddings are unavailable.

/** Build the review preview for a parsed document, flagging duplicates. */
export async function buildImportPreview(text: string, ctx: { modelId: string, documentId: string, lineageId: string, version: number, pathPrefix?: string[] }): Promise<ImportPreview> {
  const Parse = useParse()
  const parsed = parseFaqMarkdown(text)
  const prefix = (ctx.pathPrefix || []).map(p => String(p || '').trim()).filter(Boolean)

  // Existing FAQs in the model, to flag re-imports and cross-document dupes.
  const model = Parse.Object.extend('KnowledgeModel').createWithoutData(ctx.modelId)
  const byKey = new Map<string, ParseObject>()
  const byNormalized = new Map<string, ParseObject>()
  await eachBatch(() => new Parse.Query('Faq').equalTo('knowledgeModel', model), (existing) => {
    for (const f of existing) {
      byKey.set(String(f.get('importKey') || ''), f)
      const n = String(f.get('normalizedQuestion') || '')
      if (n && !byNormalized.has(n)) byNormalized.set(n, f)
    }
  }, { keys: ['importKey', 'normalizedQuestion', 'detached'] })

  const seenInDoc = new Set<string>()
  const nodePaths = new Map<string, { pathCache: string, name: string, depth: number }>()
  let duplicates = 0
  let existingCount = 0

  const entries: ImportPreviewEntry[] = parsed.faqs.map((f, i) => {
    const path = [...prefix, ...f.path]
    const pathCache = path.join('/')
    for (let d = 0; d < path.length; d++) {
      const pc = path.slice(0, d + 1).join('/')
      if (!nodePaths.has(pc)) nodePaths.set(pc, { pathCache: pc, name: path[d]!, depth: d })
    }
    const key = importKeyFor(ctx.lineageId, pathCache, f.question)
    const normalized = normalizeQuestion(f.question)
    let duplicate: ImportPreviewEntry['duplicate'] = ''
    let existingFaqId = ''

    if (seenInDoc.has(normalized)) { duplicate = 'in-document'; duplicates++ }
    seenInDoc.add(normalized)

    const match = byKey.get(key) || byNormalized.get(normalized)
    if (match) {
      existingFaqId = match.id || ''
      existingCount++
      if (!duplicate) duplicate = match.get('detached') === true ? 'existing-detached' : 'existing-active'
    }
    return { key: `e${i}`, path, pathCache, question: f.question, answer: f.answer, sourceSection: path.join(' > '), duplicate, existingFaqId }
  })

  const nodes = [...nodePaths.values()]
  return {
    documentId: ctx.documentId,
    lineageId: ctx.lineageId,
    version: ctx.version,
    title: parsed.title,
    nodes,
    entries,
    warnings: parsed.warnings,
    invalid: parsed.invalid,
    counts: { faqs: entries.length, nodes: nodes.length, duplicates, existing: existingCount }
  }
}

export type CommitEntry = { path: string[], question: string, answer: string, aliases?: string[], tags?: string[] }
export type CommitStats = { created: number, updated: number, skippedDetached: number, outdated: number, nodes: number }

function readCommitEntry(lineageId: string, entry: CommitEntry): { question: string, path: string[], key: string } {
  const question = String(entry.question || '').trim()
  const path = (entry.path || []).map(p => String(p || '').trim()).filter(Boolean)
  return { question, path, key: importKeyFor(lineageId, path.join('/'), question) }
}

/** Refuse (402) before anything is written when the FAQs a commit adds would pass the plan's limit. Updates add none. */
async function checkFaqRoom(workspace: WorkspaceRef, model: ParseObject, keys: string[]): Promise<void> {
  // Telling new entries from known ones costs a query, so only a plan that limits FAQs pays for it.
  const plan = await workspacePlan(workspace)
  if (plan.limits.faqs === null || plan.soft.faqs) return
  const unique = [...new Set(keys)]
  if (!unique.length) return
  const known = new Set<string>()
  await eachBatch(() => new (useParse()).Query('Faq').equalTo('knowledgeModel', model).containedIn('importKey', unique), (rows) => {
    for (const f of rows) known.add(String(f.get('importKey')))
  }, { keys: ['importKey'] })
  await checkGauge(workspace, 'faqs', unique.length - known.size)
}

/**
 * Create/update FAQs from reviewed entries. Deterministic: an entry whose
 * importKey already exists updates that FAQ (unless it was detached by an
 * admin), and previously-imported FAQs from this lineage that are absent now
 * are marked `outdated` rather than deleted.
 */
export async function commitImport(document: ParseObject, entries: CommitEntry[], agentId: string, workspace: WorkspaceRef): Promise<CommitStats> {
  const Parse = useParse()
  const modelId = pointerId(document.get('knowledgeModel'))
  const lineageId = String(document.get('lineageId') || '')
  const version = Number(document.get('version') || 1)
  const model = Parse.Object.extend('KnowledgeModel').createWithoutData(modelId)
  const creator = agentId ? Parse.Object.extend('_User').createWithoutData(agentId) : null
  const stats: CommitStats = { created: 0, updated: 0, skippedDetached: 0, outdated: 0, nodes: 0 }
  await checkFaqRoom(workspace, model, entries.map(entry => readCommitEntry(lineageId, entry)).filter(entry => entry.question).map(entry => entry.key))

  // Cache node resolution per path within this commit.
  const nodeCache = new Map<string, string>()
  const resolveNode = async (path: string[]): Promise<string> => {
    const pc = path.join('/')
    if (nodeCache.has(pc)) return nodeCache.get(pc)!
    const id = await ensurePathNodes(modelId, path)
    nodeCache.set(pc, id)
    return id
  }

  const presentKeys = new Set<string>()
  for (const entry of entries) {
    const { question, path, key } = readCommitEntry(lineageId, entry)
    if (!question) continue
    presentKeys.add(key)

    const existing = await new Parse.Query('Faq').equalTo('knowledgeModel', model).equalTo('importKey', key).first(MASTER)
    if (existing && existing.get('detached') === true) { stats.skippedDetached++; continue }

    const nodeId = await resolveNode(path)
    const faq = existing || new (Parse.Object.extend('Faq'))()
    if (!existing) {
      faq.set('knowledgeModel', model)
      faq.set('status', 'active')
      faq.set('origin', 'imported' as FaqOrigin)
      faq.set('importKey', key)
      if (creator) faq.set('createdBy', creator)
    }
    faq.set('question', question)
    faq.set('normalizedQuestion', normalizeQuestion(question))
    faq.set('answer', String(entry.answer || ''))
    if (Array.isArray(entry.aliases)) faq.set('aliases', entry.aliases.map(a => String(a).slice(0, 500)).filter(Boolean).slice(0, 20))
    if (Array.isArray(entry.tags)) faq.set('tags', entry.tags.map(t => String(t).slice(0, 120)).filter(Boolean).slice(0, 40))
    if (nodeId) faq.set('node', Parse.Object.extend('KnowledgeNode').createWithoutData(nodeId))
    else faq.unset('node')
    faq.set('sourceDocument', document)
    faq.set('sourceSection', path.join(' > '))
    faq.set('sourceVersion', version)
    faq.set('needsReindex', true)
    faq.set('lastProcessedAt', new Date())
    await faq.save(null, MASTER)
    existing ? stats.updated++ : stats.created++
  }

  // FAQs previously imported from this lineage that vanished from the source.
  await eachBatch(() => new Parse.Query('Faq').equalTo('knowledgeModel', model).startsWith('importKey', `${lineageId}::`), async (priorImported) => {
    const staleKeys = new Set(outdatedImportKeys(
      priorImported.map(f => ({ importKey: String(f.get('importKey') || ''), detached: f.get('detached') === true, status: String(f.get('status') || '') })),
      presentKeys
    ))
    const stale = priorImported.filter(f => staleKeys.has(String(f.get('importKey') || '')))
    for (const f of stale) { f.set('status', 'outdated'); f.set('needsReindex', true) }
    if (stale.length) { await Parse.Object.saveAll(stale, MASTER); stats.outdated += stale.length }
  }, { keys: ['importKey', 'detached', 'status'] })

  stats.nodes = await new Parse.Query('KnowledgeNode').equalTo('knowledgeModel', model).count(MASTER)
  return stats
}

/**
 * Index a model's FAQs into Meilisearch (with vectors when embeddings are
 * available). Only touches rows flagged needsReindex unless `all` is set.
 * Returns how many were indexed. Safe to retry.
 */
export async function indexModelFaqs(modelId: string, opts: { all?: boolean } = {}): Promise<{ indexed: number, vectors: boolean }> {
  if (!meiliConfigured()) return { indexed: 0, vectors: false }
  const Parse = useParse()
  const model = await new Parse.Query('KnowledgeModel').get(modelId, MASTER)
  const productName = String(model.get('name') || '')
  // Every knowledge search filters on these: a model's FAQs only answer for its own workspace.
  const workspaceId = pointerId(model.get('workspace'))
  const projectId = pointerId(model.get('project'))
  let q = new Parse.Query('Faq').equalTo('knowledgeModel', model).include('node').limit(1000)
  if (!opts.all) q = q.equalTo('needsReindex', true)
  const rows = await q.find(MASTER)
  if (!rows.length) return { indexed: 0, vectors: false }

  const indexTexts = rows.map(f => buildIndexText({
    product: productName,
    pathCache: nodePathCache(f),
    question: String(f.get('question') || ''),
    aliases: f.get('aliases') || [],
    answer: String(f.get('answer') || ''),
    tags: f.get('tags') || []
  }))

  let vectors: number[][] | null = null
  if (embeddingsEnabled()) {
    try {
      const provider = await getEmbeddingProvider()
      vectors = await provider.embedBatch(indexTexts)
    } catch (error) {
      console.warn('[ingestion] embedding failed, indexing lexical-only:', (error as Error).message)
      vectors = null
    }
  }

  const docs = rows.map((f, i) => {
    const pathCache = nodePathCache(f)
    const doc: Record<string, unknown> = {
      id: f.id,
      workspaceId,
      projectId,
      modelId,
      nodeId: pointerId(f.get('node')),
      pathCache,
      pathAncestors: ancestors(pathCache),
      status: String(f.get('status') || 'draft'),
      language: String(f.get('language') || 'en'),
      question: String(f.get('question') || ''),
      aliases: f.get('aliases') || [],
      keywords: f.get('keywords') || [],
      tags: f.get('tags') || [],
      answer: String(f.get('answer') || ''),
      indexText: indexTexts[i],
      updatedAt: (f.updatedAt || new Date()).getTime()
    }
    if (vectors) doc._vectors = { default: vectors[i] }
    return doc
  })

  await indexDocuments(KNOWLEDGE_INDEX, docs)

  const now = new Date()
  for (const f of rows) { f.set('needsReindex', false); f.set('indexedAt', now) }
  await Parse.Object.saveAll(rows, MASTER)
  return { indexed: rows.length, vectors: Boolean(vectors) }
}

function nodePathCache(faq: ParseObject): string {
  const node = faq.get('node') as ParseObject | undefined
  return node && typeof node.get === 'function' ? String(node.get('pathCache') || '') : ''
}

function ancestors(pathCache: string): string[] {
  if (!pathCache) return []
  const parts = pathCache.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

/**
 * Index a model in the background (a `knowledge.index` job). With a
 * document, the import's progress shows on it: processing now, then
 * processed or failed. Repeated requests for the same model while one is
 * still waiting collapse into it.
 */
export async function queueKnowledgeIndex(model: ParseObject | string, options: { documentId?: string, all?: boolean } = {}): Promise<void> {
  const row = typeof model === 'string' ? await new (useParse()).Query('KnowledgeModel').get(model, MASTER).catch(() => null) : model
  if (!row?.id) return
  if (options.documentId) {
    const doc = await getKnowledgeDocumentById(options.documentId).catch(() => null)
    if (doc) await setDocumentStatus(doc, 'processing')
  }
  await enqueueJob('knowledge.index', { modelId: row.id, documentId: options.documentId || '', all: options.all === true }, {
    workspaceId: pointerId(row.get('workspace')),
    dedupeKey: options.documentId ? undefined : `knowledge.index:${row.id}${options.all ? ':all' : ''}`
  })
}

/** The `knowledge.index` job. */
export async function runKnowledgeIndex(input: { modelId: string, documentId?: string, all?: boolean }): Promise<void> {
  if (!input.documentId) {
    await indexModelFaqs(input.modelId, { all: input.all })
    return
  }
  const doc = await getKnowledgeDocumentById(input.documentId).catch(() => null)
  if (!doc) return
  try {
    await setDocumentStatus(doc, 'processing')
    const result = await indexModelFaqs(input.modelId)
    const stats = { ...(doc.get('importStats') || {}), indexed: result.indexed, vectors: result.vectors }
    await setDocumentStatus(doc, 'processed', { stats })
  } catch (error) {
    await setDocumentStatus(doc, 'failed', { error: (error as Error).message }).catch(() => {})
    throw error
  }
}
