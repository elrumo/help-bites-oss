import { faqAllowed, filterIsEmpty, rankAndFilter, normalizeQuestion, type FaqLite, type AgentFaqFilter } from '#shared/knowledge'
import { meiliConfigured, searchIndex, KNOWLEDGE_INDEX } from './meili'
import { embeddingsEnabled, getEmbeddingProvider } from './embeddings'

// The retrieval service the support runtime and the admin "test" tool consume.
// It respects the agent's knowledge assignments, FAQ status and language, and
// combines lexical + semantic ranking via Meilisearch — falling back to a Parse
// keyword scan when Meili or embeddings are unavailable. No UI concerns here.

export type RetrievedFaq = {
  faqId: string
  question: string
  answer: string
  pathCache: string
  modelId: string
  source: { documentId: string, section: string, version: number }
  status: string
  language: string
  score: number
}

export type RetrieveOptions = { limit?: number, statuses?: string[], language?: string }

export async function retrieveKnowledge(agentId: string, query: string, opts: RetrieveOptions = {}): Promise<RetrievedFaq[]> {
  const limit = opts.limit ?? 8
  const statuses = opts.statuses ?? ['active']
  const q = String(query || '').trim()
  const { filter, modelIds } = await resolveAgentFilter(agentId)
  // Without a model there is nothing this assistant may read; never fall through to the whole index.
  if (filterIsEmpty(filter) || !q || !modelIds.length) return []
  const assistant = await new (useParse()).Query('SupportAgent').select('workspace').get(agentId, MASTER).catch(() => null)
  const workspaceId = pointerId(assistant?.get('workspace'))
  if (!workspaceId) return []

  // Meilisearch (hybrid) path.
  if (meiliConfigured()) {
    try {
      let vector: number[] | undefined
      if (embeddingsEnabled()) {
        try { vector = await (await getEmbeddingProvider()).embedText(q) } catch { vector = undefined }
      }
      const filters = [`workspaceId = ${JSON.stringify(workspaceId)}`, `status IN [${statuses.map(s => JSON.stringify(s)).join(', ')}]`, `modelId IN [${modelIds.map(id => JSON.stringify(id)).join(', ')}]`]
      if (opts.language) filters.push(`language = ${JSON.stringify(opts.language)}`)
      const hits = await searchIndex(KNOWLEDGE_INDEX, q, { vector, filter: filters, limit: limit * 4 })
      const ordered = hits.map((h: any) => String(h.id)).filter(Boolean)
      if (ordered.length) return await hydrate(ordered, filter, statuses, opts.language, limit, hits)
    } catch (error) {
      console.warn('[retrieval] Meili search failed, falling back to Parse:', (error as Error).message)
    }
  }

  // Fallback: accessible FAQs scored by naive keyword overlap.
  const rows = await queryAccessibleFaqs(agentId, { statuses, limit: 200 })
  const terms = normalizeQuestion(q).split(' ').filter(t => t.length > 2)
  const scored = rows.map((f) => {
    const hay = `${normalizeQuestion(String(f.get('question') || ''))} ${normalizeQuestion(String(f.get('answer') || ''))} ${(f.get('aliases') || []).map(normalizeQuestion).join(' ')}`
    const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0) / (terms.length || 1)
    return { f, score }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
  return scored.map(({ f, score }) => toResult(f, score))
}

async function hydrate(ids: string[], filter: AgentFaqFilter, statuses: string[], language: string | undefined, limit: number, hits: any[]): Promise<RetrievedFaq[]> {
  const Parse = useParse()
  const rows = await new Parse.Query('Faq').include('node').include('sourceDocument').containedIn('objectId', ids).find(MASTER)
  const byId = new Map(rows.map(r => [r.id || '', r]))
  const scoreById = new Map(hits.map((h: any) => [String(h.id), Number(h._rankingScore ?? 0)]))
  const out: RetrievedFaq[] = []
  for (const id of ids) {
    const f = byId.get(id)
    if (!f) continue
    const lite: FaqLite = { id, modelId: pointerId(f.get('knowledgeModel')), pathCache: nodePath(f), status: String(f.get('status') || ''), language: String(f.get('language') || '') }
    if (!faqAllowed(lite, filter)) continue
    out.push(toResult(f, scoreById.get(id) ?? 0))
  }
  return rankAndFilter(out, { statuses, language, limit })
}

function nodePath(faq: ParseObject): string {
  const node = faq.get('node') as ParseObject | undefined
  return node && typeof node.get === 'function' ? String(node.get('pathCache') || '') : ''
}

function toResult(f: ParseObject, score: number): RetrievedFaq {
  const doc = f.get('sourceDocument') as ParseObject | undefined
  return {
    faqId: f.id || '',
    question: String(f.get('question') || ''),
    answer: String(f.get('answer') || ''),
    pathCache: nodePath(f),
    modelId: pointerId(f.get('knowledgeModel')),
    source: {
      documentId: pointerId(f.get('sourceDocument')),
      section: String(f.get('sourceSection') || ''),
      version: Number(f.get('sourceVersion') || (doc && typeof doc.get === 'function' ? doc.get('version') : 0) || 0)
    },
    status: String(f.get('status') || ''),
    language: String(f.get('language') || 'en'),
    score
  }
}
