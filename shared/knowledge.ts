// Knowledge vocabulary, limits, and the pure logic the ingestion and retrieval
// pipelines are built on. One copy, imported by the API, the admin panel and
// the scripts, so client and server cannot drift. Nothing here touches Parse,
// Meilisearch, the filesystem or the network — it is all unit-tested in
// tests/faqParser.test.ts, tests/knowledge.test.ts, etc.

// --- Enums (const tuple + type, the shared/support.ts idiom) ---

export const KNOWLEDGE_MODEL_STATUSES = ['active', 'draft', 'archived'] as const
export type KnowledgeModelStatus = typeof KNOWLEDGE_MODEL_STATUSES[number]

// 'outdated' = the source document no longer contains this imported FAQ; kept,
// not deleted, and excluded from retrieval (see rankAndFilter's default).
export const FAQ_STATUSES = ['draft', 'active', 'disabled', 'archived', 'outdated'] as const
export type FaqStatus = typeof FAQ_STATUSES[number]

export const FAQ_ORIGINS = ['manual', 'imported', 'ai-generated', 'api', 'conversation'] as const
export type FaqOrigin = typeof FAQ_ORIGINS[number]

export const DOCUMENT_STATUSES = ['uploaded', 'queued', 'processing', 'processed', 'failed', 'outdated', 'archived'] as const
export type DocumentStatus = typeof DOCUMENT_STATUSES[number]

export const SUPPORT_AGENT_STATUSES = ['active', 'disabled', 'draft'] as const
export type SupportAgentStatus = typeof SUPPORT_AGENT_STATUSES[number]

export const ASSIGNMENT_SCOPES = ['model', 'path', 'faq'] as const
export type AssignmentScope = typeof ASSIGNMENT_SCOPES[number]

export const AGENT_FALLBACKS = ['human', 'silent'] as const
export type AgentFallback = typeof AGENT_FALLBACKS[number]

// A rule decides, per incoming user message, whether the assistant answers with
// AI ('auto') or leaves it for a human ('human'). First matching rule wins;
// with no match the assistant's defaultAction applies.
export const AGENT_RULE_ACTIONS = ['auto', 'human'] as const
export type AgentRuleAction = typeof AGENT_RULE_ACTIONS[number]
export const AGENT_RULES_MAX = 20
export const AGENT_RULE_KEYWORDS_MAX = 20

// --- Limits ---

export const KNOWLEDGE_DOC_MAX_BYTES = 4 * 1024 * 1024 // 4 MB of markdown/text
export const KNOWLEDGE_DOC_EXTENSIONS = ['md', 'markdown', 'txt'] as const
export const KNOWLEDGE_DOC_MIME_TYPES = ['text/markdown', 'text/x-markdown', 'text/plain', 'application/octet-stream', ''] as const
export const FAQ_QUESTION_MAX_LENGTH = 500
export const FAQ_ANSWER_MAX_LENGTH = 20000
export const KNOWLEDGE_NAME_MAX_LENGTH = 120
export const EMBEDDING_DIMENSIONS = 768 // Xenova/clip-vit-large-patch14 text encoder
export const DEFAULT_LANGUAGE = 'en'
export const DEFAULT_LLM_MODEL = 'openai/mimo-v2.6-flash'

// --- Small pure string helpers ---

/** Lowercase slug of up to 40 chars; ASCII letters, digits and dashes only. */
export function slugifyKnowledge(value: unknown): string {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/** Strip inline markdown (emphasis, code spans, links) to readable text. */
export function stripInline(value: string): string {
  return String(value || '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^#{1,6}\s+/, '')
    .trim()
}

/** Flatten markdown to plain text for indexing / embedding input. */
export function stripMarkdown(value: string): string {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A stable, comparable form of a question: lowercase, markdown-stripped,
 * punctuation removed, whitespace collapsed. Two phrasings that differ only by
 * case, trailing "?", or spacing normalize to the same string — the basis for
 * duplicate detection and deterministic re-import matching.
 */
export function normalizeQuestion(value: unknown): string {
  return stripMarkdown(String(value || ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Deterministic key identifying one logical FAQ within a document lineage, so
 * re-processing a document updates the existing FAQ instead of duplicating it.
 * Same lineage + same normalized path + same normalized question ⇒ same key.
 */
export function importKeyFor(lineageId: string, pathCache: string, question: string): string {
  const path = String(pathCache || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
  return `${String(lineageId || '').slice(0, 60)}::${path}::${normalizeQuestion(question).slice(0, 240)}`
}

// --- Markdown FAQ parser ---

export type ParsedFaq = {
  question: string
  answer: string
  /** Category titles from the document hierarchy, outermost first. */
  path: string[]
  /** path joined by "/", the matchable/display form. */
  pathCache: string
  /** Human-readable source location, e.g. "Account > Sign-In". */
  sourceSection: string
}

export type ParsedNode = {
  name: string
  path: string[]
  pathCache: string
  depth: number
  description: string
}

export type ParseResult = {
  title: string
  nodes: ParsedNode[]
  faqs: ParsedFaq[]
  warnings: string[]
  invalid: { section: string, reason: string }[]
}

// --- Import preview wire shapes (server builds them, the admin UI reviews them) ---

export type ImportPreviewEntry = {
  key: string
  path: string[]
  pathCache: string
  question: string
  answer: string
  sourceSection: string
  /** '' unless this entry collides with another in the document or an existing FAQ. */
  duplicate: '' | 'in-document' | 'existing-active' | 'existing-detached'
  existingFaqId: string
}

export type ImportPreview = {
  documentId: string
  lineageId: string
  version: number
  title: string
  nodes: { pathCache: string, name: string, depth: number }[]
  entries: ImportPreviewEntry[]
  warnings: string[]
  invalid: { section: string, reason: string }[]
  counts: { faqs: number, nodes: number, duplicates: number, existing: number }
}

type Section = { level: number, title: string, body: string[], children: Section[] }

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/
const FENCE = /^\s*(```|~~~)/

function endsWithQuestion(title: string): boolean {
  return /\?\s*$/.test(title)
}

/** Build the heading tree, skipping headings inside fenced code blocks. */
function buildSectionTree(md: string): { roots: Section[], preamble: boolean } {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n')
  const root: Section = { level: 0, title: '', body: [], children: [] }
  const stack: Section[] = [root]
  let inFence = false
  let seenHeading = false
  let preamble = false

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence
      if (seenHeading) stack[stack.length - 1]!.body.push(line)
      continue
    }
    const m = !inFence ? HEADING.exec(line) : null
    if (m) {
      seenHeading = true
      const level = m[1]!.length
      const title = stripInline(m[2]!.trim())
      while (stack.length > 1 && stack[stack.length - 1]!.level >= level) stack.pop()
      const node: Section = { level, title, body: [], children: [] }
      stack[stack.length - 1]!.children.push(node)
      stack.push(node)
    } else if (seenHeading) {
      stack[stack.length - 1]!.body.push(line)
    } else if (line.trim()) {
      preamble = true
    }
  }
  return { roots: root.children, preamble }
}

/**
 * Turn a support-FAQ markdown document into structured paths and FAQ entries.
 * Defensive by design — it does not assume one exact structure:
 *  - A leaf heading with body text becomes an FAQ (question = heading, answer =
 *    body), whether or not it ends in "?".
 *  - A heading with child headings becomes a path/category node.
 *  - A single leading level-1 heading is treated as the document title and
 *    unwrapped, so paths start at its children.
 *  - Category bodies are scanned for inline "Q:/A:" and bold "**question?**"
 *    entries, so less-structured documents still yield FAQs.
 *  - Empty and answerless sections are reported rather than silently dropped.
 */
export function parseFaqMarkdown(md: string): ParseResult {
  const { roots, preamble } = buildSectionTree(md)
  const nodes = new Map<string, ParsedNode>()
  const faqs: ParsedFaq[] = []
  const warnings: string[] = []
  const invalid: { section: string, reason: string }[] = []

  if (preamble) warnings.push('Text before the first heading was ignored.')

  // A single leading level-1 heading ("# Product Support & FAQ") is the
  // document title; unwrap it so paths start at its children. A lone "##" is a
  // real category and is kept.
  let title = ''
  let topNodes = roots
  if (roots.length === 1 && roots[0]!.level === 1 && roots[0]!.children.length > 0) {
    title = roots[0]!.title
    topNodes = roots[0]!.children
  }

  const ensureNodes = (path: string[], description = '') => {
    for (let i = 0; i < path.length; i++) {
      const slice = path.slice(0, i + 1)
      const pathCache = slice.join('/')
      const existing = nodes.get(pathCache)
      if (!existing) {
        nodes.set(pathCache, { name: slice[i]!, path: slice, pathCache, depth: i, description: i === path.length - 1 ? description : '' })
      } else if (i === path.length - 1 && description && !existing.description) {
        existing.description = description
      }
    }
  }

  const addFaq = (question: string, answer: string, path: string[]) => {
    const q = question.trim()
    const a = answer.trim()
    if (!q) return
    faqs.push({ question: q, answer: a, path, pathCache: path.join('/'), sourceSection: path.join(' > ') })
  }

  const walk = (section: Section, parentPath: string[]) => {
    const bodyText = section.body.join('\n').trim()
    const isLeaf = section.children.length === 0

    if (isLeaf) {
      if (bodyText) {
        addFaq(section.title, bodyText, parentPath)
        ensureNodes(parentPath)
      } else if (endsWithQuestion(section.title)) {
        invalid.push({ section: [...parentPath, section.title].join(' > '), reason: 'Question has no answer.' })
        ensureNodes(parentPath)
      } else {
        ensureNodes([...parentPath, section.title])
        warnings.push(`Empty section: ${[...parentPath, section.title].join(' / ')}`)
      }
      return
    }

    // Category node.
    const path = [...parentPath, section.title]
    const inline = bodyText ? extractInlineFaqs(bodyText) : []
    ensureNodes(path, inline.length ? '' : firstLine(bodyText))
    for (const entry of inline) addFaq(entry.question, entry.answer, path)
    for (const child of section.children) walk(child, path)
  }

  for (const node of topNodes) walk(node, [])

  // A document that is only body text (no usable leaf headings) still yields
  // FAQs from inline Q&A patterns at the root.
  return { title, nodes: [...nodes.values()], faqs, warnings, invalid }
}

function firstLine(text: string): string {
  const line = String(text || '').split('\n').map(l => l.trim()).find(Boolean) || ''
  return stripInline(line).slice(0, 280)
}

/**
 * Extract "Q:/A:" pairs and bold "**question?**" blocks from a body of text.
 * Used for category sections and less-structured documents.
 */
export function extractInlineFaqs(body: string): { question: string, answer: string }[] {
  const text = String(body || '')
  const out: { question: string, answer: string }[] = []
  const lines = text.split('\n')

  // Q:/A: pairs — a line starting "Q:" opens a question, "A:" opens its answer.
  if (/^\s*Q[:.)]\s*/im.test(text)) {
    let mode: 'q' | 'a' | null = null
    let q: string[] = []
    let a: string[] = []
    const flush = () => {
      const question = stripInline(q.join(' ').trim())
      const answer = stripInline(a.join('\n').trim())
      if (question) out.push({ question, answer })
      q = []
      a = []
    }
    for (const line of lines) {
      const qm = /^\s*Q[:.)]\s*(.*)$/i.exec(line)
      const am = /^\s*A[:.)]\s*(.*)$/i.exec(line)
      if (qm) {
        if (mode) flush()
        mode = 'q'
        q.push(qm[1] || '')
      } else if (am) {
        mode = 'a'
        a.push(am[1] || '')
      } else if (mode === 'q') {
        q.push(line)
      } else if (mode === 'a') {
        a.push(line)
      }
    }
    if (mode) flush()
    return out
  }

  // Bold "**question?**" blocks: a bold line ending in "?" opens a question,
  // following lines up to the next such line are its answer.
  let current: { question: string, answer: string[] } | null = null
  const boldQuestion = /^\s*(\*\*|__)(.+?)\1\s*:?\s*$/
  for (const line of lines) {
    const b = boldQuestion.exec(line)
    if (b && endsWithQuestion(b[2]!)) {
      if (current) out.push({ question: current.question, answer: current.answer.join('\n').trim() })
      current = { question: stripInline(b[2]!.trim()), answer: [] }
    } else if (current) {
      current.answer.push(line)
    }
  }
  if (current) out.push({ question: current.question, answer: current.answer.join('\n').trim() })
  return out.filter(e => e.question)
}

export type PriorImportedFaq = { importKey: string, detached: boolean, status: string }

/**
 * Reprocessing decision: which previously-imported FAQs are no longer produced
 * by the source and should be marked outdated. Admin-detached and already
 * archived/outdated FAQs are left untouched, so a re-import never destroys
 * deliberate edits or re-flaps state. Pure — the heart of idempotent reprocess.
 */
export function outdatedImportKeys(prior: PriorImportedFaq[], incomingKeys: Iterable<string>): string[] {
  const present = new Set(incomingKeys)
  return prior
    .filter(p => !present.has(p.importKey) && !p.detached && p.status !== 'archived' && p.status !== 'outdated')
    .map(p => p.importKey)
}

/** Group parsed FAQs by normalized question; return only the collisions. */
export function detectDuplicates(faqs: { question: string }[]): { normalized: string, indexes: number[] }[] {
  const groups = new Map<string, number[]>()
  faqs.forEach((f, i) => {
    const key = normalizeQuestion(f.question)
    if (!key) return
    const list = groups.get(key) || []
    list.push(i)
    groups.set(key, list)
  })
  return [...groups.entries()].filter(([, idx]) => idx.length > 1).map(([normalized, indexes]) => ({ normalized, indexes }))
}

// --- Index text (kept separate from the FAQ record, per the spec) ---

export type IndexableFaq = {
  product?: string
  pathCache?: string
  question: string
  aliases?: string[]
  answer: string
  tags?: string[]
}

/** The normalized text representation used for lexical indexing and embeddings. */
export function buildIndexText(f: IndexableFaq): string {
  const lines: string[] = []
  if (f.product) lines.push(`Product: ${f.product}`)
  if (f.pathCache) lines.push(`Path: ${f.pathCache.split('/').join(' > ')}`)
  lines.push(`Question: ${stripInline(f.question)}`)
  if (f.aliases && f.aliases.length) lines.push(`Aliases: ${f.aliases.map(stripInline).join('; ')}`)
  if (f.tags && f.tags.length) lines.push(`Tags: ${f.tags.join(', ')}`)
  lines.push(`Answer: ${stripMarkdown(f.answer)}`)
  return lines.join('\n')
}

// --- Agent knowledge filtering (pure; server resolves pointers to this shape) ---

export type AssignmentLite = {
  scope: AssignmentScope
  modelId?: string
  /** pathCache of the assigned node, resolved by the server. */
  pathCache?: string
  faqId?: string
  exclude?: boolean
}

export type AgentFaqFilter = {
  modelIds: string[]
  paths: { modelId: string, pathCache: string }[]
  faqIds: string[]
  excludeModelIds: string[]
  excludePaths: { modelId: string, pathCache: string }[]
  excludeFaqIds: string[]
}

export type FaqLite = { id: string, modelId: string, pathCache: string, status?: string, language?: string }

function pathUnder(child: string, prefix: string): boolean {
  if (!prefix) return true
  return child === prefix || child.startsWith(`${prefix}/`)
}

/** Fold a list of assignments into include/exclude sets. */
export function resolveAgentFaqFilter(assignments: AssignmentLite[]): AgentFaqFilter {
  const filter: AgentFaqFilter = { modelIds: [], paths: [], faqIds: [], excludeModelIds: [], excludePaths: [], excludeFaqIds: [] }
  for (const a of assignments) {
    const model = a.modelId || ''
    if (a.scope === 'model' && model) (a.exclude ? filter.excludeModelIds : filter.modelIds).push(model)
    else if (a.scope === 'path' && model) (a.exclude ? filter.excludePaths : filter.paths).push({ modelId: model, pathCache: a.pathCache || '' })
    else if (a.scope === 'faq' && a.faqId) (a.exclude ? filter.excludeFaqIds : filter.faqIds).push(a.faqId)
  }
  return filter
}

/**
 * Whether an agent with this filter may use an FAQ. Excludes win; a parent-path
 * assignment grants everything in its subtree (inheritance) unless a narrower
 * exclusion removes it.
 */
export function faqAllowed(faq: FaqLite, filter: AgentFaqFilter): boolean {
  if (filter.excludeFaqIds.includes(faq.id)) return false
  if (filter.excludeModelIds.includes(faq.modelId)) return false
  if (filter.excludePaths.some(p => p.modelId === faq.modelId && pathUnder(faq.pathCache, p.pathCache))) return false
  if (filter.faqIds.includes(faq.id)) return true
  if (filter.modelIds.includes(faq.modelId)) return true
  if (filter.paths.some(p => p.modelId === faq.modelId && pathUnder(faq.pathCache, p.pathCache))) return true
  return false
}

/** Is this agent scoped to nothing at all? */
export function filterIsEmpty(filter: AgentFaqFilter): boolean {
  return !filter.modelIds.length && !filter.paths.length && !filter.faqIds.length
}

// --- Tree building (pure; used by the admin tree UI and node utils) ---

export type TreeItem<T> = T & { children: TreeItem<T>[] }

/**
 * Nest a flat node list by parentId, ordered by `order` then name. Nodes whose
 * parent is missing from the list surface as roots, so a partial list never
 * loses entries.
 */
export function buildNodeTree<T extends { id: string, parentId: string, order: number, name: string }>(nodes: T[]): TreeItem<T>[] {
  const byId = new Map<string, TreeItem<T>>(nodes.map(n => [n.id, { ...n, children: [] }]))
  const roots: TreeItem<T>[] = []
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sortRec = (arr: TreeItem<T>[]) => {
    arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    for (const child of arr) sortRec(child.children)
  }
  sortRec(roots)
  return roots
}

// --- Assistant rules (pure; the server stores/reads AgentRule[] on SupportAgent) ---

export type AgentRule = {
  /** Match when the conversation's type key equals this. Unset = any type. */
  conversationType?: string
  /** Match when any keyword is a case-insensitive substring of the message. Unset = any. */
  keywords?: string[]
  action: AgentRuleAction
}

/** Clamp/validate rules from input or storage. A rule needs at least one
 *  condition; the "otherwise" case is the assistant's defaultAction, not a
 *  condition-less rule. */
export function normalizeAgentRules(value: unknown): AgentRule[] {
  if (!Array.isArray(value)) return []
  const out: AgentRule[] = []
  for (const raw of value.slice(0, AGENT_RULES_MAX)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const conversationType = typeof r.conversationType === 'string' ? r.conversationType.trim().slice(0, 60) : ''
    const keywords = Array.isArray(r.keywords)
      ? r.keywords.map(k => String(k || '').trim().slice(0, 80)).filter(Boolean).filter((k, i, all) => all.indexOf(k) === i).slice(0, AGENT_RULE_KEYWORDS_MAX)
      : []
    if (!conversationType && !keywords.length) continue
    out.push({ action: r.action === 'human' ? 'human' : 'auto', ...(conversationType ? { conversationType } : {}), ...(keywords.length ? { keywords } : {}) })
  }
  return out
}

/** First matching rule's action; no match → defaultAction. A rule matches when
 *  every condition it sets holds (an unset condition is "any"). */
export function matchAgentRules(rules: AgentRule[], ctx: { conversationType: string, text: string }, defaultAction: AgentRuleAction = 'auto'): AgentRuleAction {
  const text = String(ctx.text || '').toLowerCase()
  const type = String(ctx.conversationType || '')
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || (rule.action !== 'auto' && rule.action !== 'human')) continue
    const typeOk = !rule.conversationType || rule.conversationType === type
    const kw = Array.isArray(rule.keywords) ? rule.keywords : []
    const kwOk = kw.length === 0 || kw.some(k => text.includes(String(k).toLowerCase()))
    if (typeOk && kwOk) return rule.action
  }
  return defaultAction
}

/** Post-retrieval filter by status/language, preserving the incoming ranking. */
export function rankAndFilter<T extends { status?: string, language?: string }>(
  results: T[],
  opts: { statuses?: readonly string[], language?: string, limit?: number } = {}
): T[] {
  const statuses = opts.statuses ?? ['active']
  let out = results.filter(r => !r.status || statuses.includes(r.status))
  if (opts.language) out = out.filter(r => !r.language || r.language === opts.language)
  if (typeof opts.limit === 'number') out = out.slice(0, opts.limit)
  return out
}
