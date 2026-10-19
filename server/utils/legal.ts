import { createError, getQuery, getRouterParam, type H3Event } from 'h3'
import { aiTldr, applySectionEdits, checkCoverage, composeDocument, humanTldr, mergeRecomposed, sectionsToMarkdown, type SectionEdit } from '#shared/legal/compose'
import { normalizeLegalConfig, withEntityDefaults } from '#shared/legal/config'
import { LEGAL_DOC_TYPES, type LegalAnswers, type LegalDocType, type LegalSection, type LegalTldr } from '#shared/legal/types'
import { validateAnswers } from '#shared/legal/wizard'
import { nextChangelogSlug } from './changelogRender'
import { renderLegalHtml } from './legalRender'

// Hosted legal documents: the store behind /v1/admin/legal and the public pages.
// The pure logic (composing, merging, coverage) is in shared/legal; this file is
// Parse rows, slugs, versions and what a reader may see.

export const LEGAL_SECTIONS_MAX = 60
export const LEGAL_BODY_MAX = 20_000
const TITLE_MAX = 200

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

export function isLegalType(value: unknown): value is LegalDocType {
  return typeof value === 'string' && (LEGAL_DOC_TYPES as readonly string[]).includes(value)
}

// ---- which project -------------------------------------------------------------

/** The project an operator names with `?project=` (or `project` in a JSON body); a limited key only reaches its own. */
export async function legalProject(ctx: MemberContext, event: H3Event, body?: Record<string, unknown>): Promise<ParseObject> {
  const named = String(getQuery(event).project || body?.project || '')
  if (!named) badRequest('Pass ?project=<projectId>')
  return await requireProject(ctx, named)
}

// ---- rows ------------------------------------------------------------------------

export async function getLegalDocument(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('LegalDocument').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }
}

export async function findLegalDocumentBySlug(project: ParseObject, slug: string): Promise<ParseObject | null> {
  return await new (useParse()).Query('LegalDocument').equalTo('project', project).equalTo('slug', slug).first(MASTER) || null
}

export async function listLegalDocuments(project: ParseObject, onlyPublished = false): Promise<ParseObject[]> {
  const query = new (useParse()).Query('LegalDocument').equalTo('project', project).ascending('type').limit(200)
  if (onlyPublished) query.equalTo('status', 'published')
  return await query.find(MASTER)
}

async function slugTaken(project: ParseObject, slug: string, exceptId?: string): Promise<boolean> {
  const row = await findLegalDocumentBySlug(project, slug)
  return !!row && row.id !== exceptId
}

export function sectionsOf(row: ParseObject): LegalSection[] {
  const raw = row.get('sections')
  if (!Array.isArray(raw)) return []
  return raw.map((s: Record<string, unknown>) => ({
    id: String(s.id || ''),
    clauseId: typeof s.clauseId === 'string' ? s.clauseId : undefined,
    heading: String(s.heading || ''),
    body: String(s.body || ''),
    source: s.source === 'ai' || s.source === 'human' ? s.source : 'template',
    locked: s.locked === true,
    satisfies: Array.isArray(s.satisfies) ? s.satisfies.map(String) : []
  }))
}

export function tldrOf(row: ParseObject): LegalTldr | null {
  const raw = row.get('tldr') as { text?: unknown, source?: unknown } | undefined
  if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) return null
  return raw.source === 'human' ? humanTldr(raw.text) : aiTldr(raw.text)
}

function answersOf(row: ParseObject): LegalAnswers {
  const raw = row.get('answers')
  return raw && typeof raw === 'object' ? raw as LegalAnswers : {}
}

const typeOf = (row: ParseObject): LegalDocType => (isLegalType(row.get('type')) ? row.get('type') : 'privacy')

// ---- serialising -----------------------------------------------------------------

export function legalPath(project: ParseObject, row: ParseObject): string {
  return `/legal/${String(project.get('publicKey') || '')}/${String(row.get('slug') || '')}`
}

export function serializeLegalDocument(project: ParseObject, row: ParseObject) {
  return {
    id: row.id || '',
    type: typeOf(row),
    slug: String(row.get('slug') || ''),
    locale: String(row.get('locale') || 'en'),
    title: String(row.get('title') || ''),
    status: row.get('status') === 'published' ? 'published' : 'draft',
    sections: sectionsOf(row),
    answers: answersOf(row),
    jurisdictions: Array.isArray(row.get('jurisdictions')) ? row.get('jurisdictions').map(String) : [],
    tldr: tldrOf(row),
    effectiveDate: iso(row.get('effectiveDate')),
    publishedAt: iso(row.get('publishedAt')),
    version: typeof row.get('version') === 'number' ? row.get('version') as number : 0,
    path: legalPath(project, row),
    updatedAt: iso(row.updatedAt)
  }
}

/** What a reader may see: published text only, no wizard answers, no provenance. */
export function toPublicLegalDocument(project: ParseObject, row: ParseObject) {
  const sections = sectionsOf(row)
  return {
    type: typeOf(row),
    slug: String(row.get('slug') || ''),
    locale: String(row.get('locale') || 'en'),
    title: String(row.get('title') || ''),
    tldr: tldrOf(row)?.text || '',
    effectiveDate: iso(row.get('effectiveDate')),
    publishedAt: iso(row.get('publishedAt')),
    version: typeof row.get('version') === 'number' ? row.get('version') as number : 0,
    sections: sections.map(s => ({ heading: s.heading, body: s.body })),
    markdown: sectionsToMarkdown(sections),
    html: String(row.get('bodyHtml') || renderLegalHtml(sections)),
    url: legalPath(project, row)
  }
}

type Brief = { id: string, pack: string, summary: string, citation: string, severity: string }
const brief = (r: Brief): Brief => ({ id: r.id, pack: r.pack, summary: r.summary, citation: r.citation, severity: r.severity })

/** What a set of sections covers and lacks: the rulepack requirements that apply, split in two. */
export function coverageReport(type: LegalDocType, answers: LegalAnswers, sections: LegalSection[]) {
  const coverage = checkCoverage(type, answers, sections)
  return { total: coverage.total, covered: coverage.covered.map(brief), gaps: coverage.gaps.map(brief), unreviewedPacks: coverage.unreviewedPacks }
}

export function legalCoverage(row: ParseObject) {
  return coverageReport(typeOf(row), answersOf(row), sectionsOf(row))
}

/** The document an admin route names with `:id`, 404 unless it is in the caller's workspace (and, for a limited key, its projects). */
export async function scopedLegalDocument(ctx: MemberContext, event: H3Event): Promise<{ project: ParseObject, row: ParseObject }> {
  const row = await scoped.legalDocument(ctx, getRouterParam(event, 'id') || '')
  return { row, project: await requireProject(ctx, pointerId(row.get('project'))) }
}

// ---- writing ---------------------------------------------------------------------

function setSections(row: ParseObject, sections: LegalSection[]): void {
  if (sections.length > LEGAL_SECTIONS_MAX) badRequest(`A document has at most ${LEGAL_SECTIONS_MAX} sections`)
  for (const s of sections) if (s.body.length > LEGAL_BODY_MAX) badRequest(`A section is at most ${LEGAL_BODY_MAX} characters`)
  row.set('sections', sections)
  row.set('bodyHtml', renderLegalHtml(sections))
}

function readSectionEdits(value: unknown): SectionEdit[] {
  if (!Array.isArray(value)) badRequest('sections must be a list')
  return value.map((item) => {
    const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    return {
      id: typeof s.id === 'string' ? s.id : undefined,
      heading: typeof s.heading === 'string' ? s.heading : undefined,
      body: typeof s.body === 'string' ? s.body : undefined,
      locked: typeof s.locked === 'boolean' ? s.locked : undefined
    }
  })
}

function readDate(value: unknown): Date | null {
  if (value === null || value === '') return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) badRequest('effectiveDate must be a date')
  return date
}

/** Applies the fields of a PATCH body; only the keys present change. */
export async function applyLegalInput(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  if (typeof body.title === 'string') {
    const title = body.title.trim().slice(0, TITLE_MAX)
    if (!title) badRequest('title cannot be empty')
    row.set('title', title)
  }
  if (typeof body.slug === 'string') {
    row.set('slug', await nextChangelogSlug(body.slug, slug => slugTaken(project, slug, row.id)))
  }
  if (typeof body.locale === 'string') row.set('locale', body.locale.trim().slice(0, 12) || 'en')
  if ('effectiveDate' in body) row.set('effectiveDate', readDate(body.effectiveDate))
  if ('tldr' in body) {
    // A person writing the summary always wins; clearing it removes it.
    const text = body.tldr === null ? '' : typeof body.tldr === 'string' ? body.tldr.trim() : badRequest('tldr must be text or null')
    row.set('tldr', text ? humanTldr(text) : null)
  }
  if ('sections' in body) setSections(row, applySectionEdits(sectionsOf(row), readSectionEdits(body.sections)))
}

export type CreateLegalInput = {
  type: LegalDocType
  mode: 'blank' | 'template'
  answers?: unknown
  title?: string
  slug?: string
  locale?: string
  /** Sections written elsewhere (the AI draft); used instead of composing from clauses. */
  prepared?: { answers: LegalAnswers, jurisdictions: string[], sections: LegalSection[] }
}

export async function createLegalDocument(project: ParseObject, input: CreateLegalInput): Promise<ParseObject> {
  const row = new (useParse().Object.extend('LegalDocument'))() as ParseObject
  row.set('project', project)
  row.set('type', input.type)
  row.set('status', 'draft')
  row.set('version', 0)
  row.set('locale', (input.locale || 'en').slice(0, 12))

  let sections: LegalSection[] = []
  let title = ''
  if (input.prepared) {
    sections = input.prepared.sections
    row.set('answers', input.prepared.answers)
    row.set('jurisdictions', input.prepared.jurisdictions)
  } else if (input.mode === 'template') {
    const answers = prepareAnswers(project, input.type, input.answers)
    const composed = composeDocument(input.type, answers)
    sections = composed.sections
    title = composed.title
    row.set('answers', answers)
    row.set('jurisdictions', composed.jurisdictions)
  }
  row.set('title', (input.title || title || defaultTitle(input.type)).trim().slice(0, TITLE_MAX))
  row.set('slug', await nextChangelogSlug(input.slug || input.type, slug => slugTaken(project, slug)))
  setSections(row, sections)
  await row.save(null, MASTER)
  return row
}

function defaultTitle(type: LegalDocType): string {
  return { privacy: 'Privacy Policy', terms: 'Terms of Service', cookies: 'Cookie Policy', refund: 'Refund Policy' }[type]
}

/** The answers a project's saved identity already supplies, so a wizard can start pre-filled. */
export function legalDefaults(project: ParseObject): LegalAnswers {
  return withEntityDefaults({}, normalizeLegalConfig(project.get('legal')), { name: String(project.get('name') || ''), siteUrl: String(project.get('siteUrl') || '') })
}

/** Raw wizard answers → cleaned answers, with the project's saved identity filling gaps. 400 when a required answer is missing. */
export function prepareAnswers(project: ParseObject, type: LegalDocType, raw: unknown): LegalAnswers {
  const config = normalizeLegalConfig(project.get('legal'))
  const merged = withEntityDefaults((raw && typeof raw === 'object' ? raw : {}) as LegalAnswers, config, { name: String(project.get('name') || ''), siteUrl: String(project.get('siteUrl') || '') })
  const { answers, errors } = validateAnswers(type, merged)
  if (errors.length) badRequest(errors.join('; '))
  return answers
}

/** Re-runs the composer on the saved (or new) answers and merges the result in without losing edits. */
export async function recomposeLegalDocument(project: ParseObject, row: ParseObject, rawAnswers?: unknown): Promise<void> {
  const type = typeOf(row)
  const answers = prepareAnswers(project, type, rawAnswers ?? answersOf(row))
  const composed = composeDocument(type, answers)
  row.set('answers', answers)
  row.set('jurisdictions', composed.jurisdictions)
  setSections(row, mergeRecomposed(sectionsOf(row), composed.sections))
  await row.save(null, MASTER)
}

// ---- publishing and history ----------------------------------------------------------

export async function publishLegalDocument(row: ParseObject, authorName: string, note = ''): Promise<void> {
  if (!sectionsOf(row).some(s => s.body.trim())) badRequest('A document with no text cannot be published')
  const version = (typeof row.get('version') === 'number' ? row.get('version') as number : 0) + 1
  const now = new Date()
  row.set('version', version)
  row.set('status', 'published')
  row.set('publishedAt', now)
  if (!row.get('effectiveDate')) row.set('effectiveDate', now)
  await row.save(null, MASTER)

  const snapshot = new (useParse().Object.extend('LegalDocumentVersion'))() as ParseObject
  snapshot.set('document', row)
  snapshot.set('version', version)
  snapshot.set('note', note.slice(0, 300))
  snapshot.set('authorName', authorName.slice(0, 120))
  snapshot.set('snapshot', {
    title: row.get('title'),
    sections: sectionsOf(row),
    tldr: row.get('tldr') || null,
    answers: answersOf(row),
    jurisdictions: row.get('jurisdictions') || [],
    effectiveDate: iso(row.get('effectiveDate'))
  })
  await snapshot.save(null, MASTER)
}

export async function unpublishLegalDocument(row: ParseObject): Promise<void> {
  row.set('status', 'draft')
  await row.save(null, MASTER)
}

export async function listLegalVersions(row: ParseObject) {
  const rows = await new (useParse()).Query('LegalDocumentVersion').equalTo('document', row).descending('version').limit(100).find(MASTER)
  return rows.map(v => ({ version: v.get('version') as number, note: String(v.get('note') || ''), authorName: String(v.get('authorName') || ''), publishedAt: iso(v.createdAt) }))
}

/** Puts a published version's text back as the working draft. It is not republished. */
export async function restoreLegalVersion(row: ParseObject, version: number): Promise<void> {
  const found = await new (useParse()).Query('LegalDocumentVersion').equalTo('document', row).equalTo('version', version).first(MASTER)
  if (!found) throw createError({ statusCode: 404, statusMessage: 'Version not found' })
  const snap = found.get('snapshot') as { title?: string, sections?: LegalSection[], tldr?: LegalTldr | null, answers?: LegalAnswers, jurisdictions?: string[] }
  if (snap.title) row.set('title', snap.title)
  row.set('tldr', snap.tldr || null)
  row.set('answers', snap.answers || {})
  row.set('jurisdictions', snap.jurisdictions || [])
  setSections(row, Array.isArray(snap.sections) ? snap.sections : [])
  await row.save(null, MASTER)
}

export async function deleteLegalDocument(row: ParseObject): Promise<void> {
  const Parse = useParse()
  const versions = await new Parse.Query('LegalDocumentVersion').equalTo('document', row).limit(1000).find(MASTER)
  if (versions.length) await Parse.Object.destroyAll(versions, MASTER)
  await row.destroy(MASTER)
}

/** Replaces one section's text with AI-written text, marking it `ai`. */
export async function replaceSectionBody(row: ParseObject, sectionId: string, body: string): Promise<void> {
  const sections = sectionsOf(row)
  if (!sections.some(s => s.id === sectionId)) throw createError({ statusCode: 404, statusMessage: 'Section not found' })
  setSections(row, sections.map(s => (s.id === sectionId ? { ...s, body, source: 'ai' as const } : s)))
  await row.save(null, MASTER)
}

// ---- public reads ----------------------------------------------------------------

/** The project behind a public legal URL (`:pk`), after the per-IP read limit. 404 for an unknown key. */
export async function publicLegalProject(event: H3Event): Promise<ParseObject> {
  await rateLimit(`sb:rl:legalread:${clientIp(event) || 'ip'}`, LIMITS.legalReadsPerIp.limit, LIMITS.legalReadsPerIp.window)
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  return project
}

/** A published document by slug; a draft answers like a document that does not exist. */
export async function publicLegalDocument(project: ParseObject, slug: string): Promise<ParseObject> {
  const row = await findLegalDocumentBySlug(project, slug)
  if (!row || row.get('status') !== 'published') throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  return row
}

/** Like publicLegalProject, but an unknown key is null so a page can answer with HTML; a rate limit still throws. */
export async function publicLegalProjectOrNull(event: H3Event): Promise<ParseObject | null> {
  try {
    return await publicLegalProject(event)
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return null
    throw error
  }
}
