import { createError } from 'h3'
import { FAQ_STATUSES, FAQ_ORIGINS, FAQ_QUESTION_MAX_LENGTH, FAQ_ANSWER_MAX_LENGTH, DEFAULT_LANGUAGE, normalizeQuestion, type FaqStatus, type FaqOrigin } from '#shared/knowledge'

// An FAQ is a first-class record (not a line in a markdown file). Imported FAQs
// keep provenance (source document/section/version + a deterministic importKey)
// so re-processing updates them in place. An admin edit sets `detached` so a
// later re-import won't clobber the human's wording.

export type Faq = {
  id: string
  modelId: string
  nodeId: string
  pathCache: string
  question: string
  answer: string
  language: string
  status: FaqStatus
  tags: string[]
  aliases: string[]
  keywords: string[]
  origin: FaqOrigin
  sourceDocumentId: string
  sourceSection: string
  sourceVersion: number
  /** The conversation it was saved from (origin `conversation`); '' otherwise. */
  conversationId: string
  importKey: string
  normalizedQuestion: string
  detached: boolean
  needsReindex: boolean
  indexedAt: string | null
  createdBy: string
  lastProcessedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export async function getFaqById(id: string): Promise<ParseObject> {
  const Parse = useParse()
  try {
    return await new Parse.Query('Faq').include('node').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'FAQ not found' })
  }
}

function cleanList(value: unknown, max = 40, itemMax = 120): string[] {
  if (!Array.isArray(value)) return []
  return value.map(v => String(v ?? '').trim().slice(0, itemMax)).filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).slice(0, max)
}

/**
 * Apply a manual (admin) POST/PATCH body onto an FAQ. Recomputes
 * normalizedQuestion, flags it for re-indexing on content changes, and — for an
 * imported FAQ — marks it `detached` so re-import leaves the edit alone.
 */
export function applyFaqInput(faq: ParseObject, input: Record<string, unknown>, opts: { isEdit?: boolean } = {}): void {
  let contentChanged = false
  if (typeof input.question === 'string' && input.question.trim()) {
    const q = input.question.trim().slice(0, FAQ_QUESTION_MAX_LENGTH)
    if (q !== faq.get('question')) contentChanged = true
    faq.set('question', q)
    faq.set('normalizedQuestion', normalizeQuestion(q))
  }
  if ('answer' in input) {
    const a = String(input.answer ?? '').slice(0, FAQ_ANSWER_MAX_LENGTH)
    if (a !== faq.get('answer')) contentChanged = true
    faq.set('answer', a)
  }
  if ('aliases' in input) { faq.set('aliases', cleanList(input.aliases, 20, 500)); contentChanged = true }
  if ('tags' in input) faq.set('tags', cleanList(input.tags))
  if ('keywords' in input) faq.set('keywords', cleanList(input.keywords))
  if (typeof input.status === 'string' && (FAQ_STATUSES as readonly string[]).includes(input.status)) faq.set('status', input.status)
  if ('language' in input) faq.set('language', String(input.language || DEFAULT_LANGUAGE).trim().slice(0, 12))
  if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) faq.set('metadata', input.metadata)

  if (contentChanged) faq.set('needsReindex', true)
  if (opts.isEdit && faq.get('origin') === 'imported' && contentChanged) faq.set('detached', true)
}

/** Move an FAQ to a node (or to the model root when nodeId is empty). */
export async function setFaqNode(faq: ParseObject, nodeId: string): Promise<void> {
  const Parse = useParse()
  if (nodeId) {
    const node = await getKnowledgeNodeById(nodeId)
    if (pointerId(node.get('knowledgeModel')) !== pointerId(faq.get('knowledgeModel'))) {
      throw createError({ statusCode: 400, statusMessage: 'Node belongs to another model' })
    }
    faq.set('node', node)
  } else {
    faq.unset('node')
  }
  faq.set('needsReindex', true)
}

export function serializeFaq(faq: ParseObject): Faq {
  const node = faq.get('node')
  const pathCache = node && typeof (node as ParseObject).get === 'function' ? String((node as ParseObject).get('pathCache') || '') : ''
  return {
    id: faq.id || '',
    modelId: pointerId(faq.get('knowledgeModel')),
    nodeId: pointerId(faq.get('node')),
    pathCache,
    question: String(faq.get('question') || ''),
    answer: String(faq.get('answer') || ''),
    language: String(faq.get('language') || DEFAULT_LANGUAGE),
    status: (faq.get('status') as FaqStatus) || 'draft',
    tags: Array.isArray(faq.get('tags')) ? faq.get('tags') : [],
    aliases: Array.isArray(faq.get('aliases')) ? faq.get('aliases') : [],
    keywords: Array.isArray(faq.get('keywords')) ? faq.get('keywords') : [],
    origin: (faq.get('origin') as FaqOrigin) || 'manual',
    sourceDocumentId: pointerId(faq.get('sourceDocument')),
    sourceSection: String(faq.get('sourceSection') || ''),
    sourceVersion: Number(faq.get('sourceVersion') || 0),
    conversationId: String(faq.get('conversationId') || ''),
    importKey: String(faq.get('importKey') || ''),
    normalizedQuestion: String(faq.get('normalizedQuestion') || ''),
    detached: faq.get('detached') === true,
    needsReindex: faq.get('needsReindex') === true,
    indexedAt: iso(faq.get('indexedAt')),
    createdBy: pointerId(faq.get('createdBy')),
    lastProcessedAt: iso(faq.get('lastProcessedAt')),
    createdAt: iso(faq.createdAt),
    updatedAt: iso(faq.updatedAt)
  }
}
