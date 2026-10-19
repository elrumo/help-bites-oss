import { clausesFor } from './clauses'
import { LEGAL_RULEPACKS } from './rulepacks'
import { LEGAL_PROCESSORS } from './wizard'
import { answeredRegions, matches } from './when'
import {
  LEGAL_DOC_LABELS, type LegalAnswers, type LegalDocType, type LegalFinding, type LegalRequirement, type LegalRulepack, type LegalSection, type LegalTldr
} from './types'

// Pure document logic: wizard answers → sections (the composer), keeping human
// edits through a recompose, the rulepack coverage check, and the guards that
// keep AI output honest. No Parse and no AI in here.

const DATA_LINES: Record<string, string> = {
  account: 'Account details, such as your name and email address.',
  payments: 'Purchase and subscription information. Card details are handled by our payment provider, not by us.',
  analytics: 'Usage information, such as the features you use and how often.',
  crash: 'Crash and error reports, which can include device and app version details.',
  device: 'Device information, such as device type, operating system and identifiers.',
  location: 'Your location, if you allow it.',
  user_content: 'The content you create or upload.',
  support: 'Messages you send to our support team.',
  advertising: 'Advertising identifiers.'
}

const COOKIE_LINES: Record<string, string> = {
  essential: '**Essential**: needed to sign you in and keep {{app_name}} secure. These cannot be switched off.',
  preferences: '**Preferences**: remember choices such as language and theme.',
  analytics: '**Analytics**: help us understand how {{app_name}} is used so we can improve it.',
  advertising: '**Advertising**: used to show and measure advertising.'
}

function list(items: string[], none: string): string {
  return items.length ? items.map(item => `- ${item}`).join('\n') : `- ${none}`
}

function text(answers: LegalAnswers, key: string): string {
  const value = answers[key]
  return typeof value === 'string' ? value.trim() : ''
}

function many(answers: LegalAnswers, key: string): string[] {
  const value = answers[key]
  return Array.isArray(value) ? value : []
}

/** The `{{variable}}` values a set of answers produces. */
export function composeVariables(answers: LegalAnswers): Record<string, string> {
  const appName = text(answers, 'app_name') || 'the service'
  const entity = text(answers, 'entity_name') || 'the operator'
  const address = text(answers, 'entity_address')
  const email = text(answers, 'contact_email')
  const dpo = text(answers, 'dpo_contact')

  const picked = many(answers, 'processors')
  const processors = LEGAL_PROCESSORS.filter(p => picked.includes(p.id))
    .map(p => `**${p.name}**: ${p.purpose} (${p.data}). [Privacy policy](${p.url})`)
  const others = text(answers, 'processors_other').split('\n').map(line => line.trim()).filter(Boolean)

  return {
    app_name: appName,
    entity_name: entity,
    operator: address ? `${entity}, ${address}` : entity,
    contact_email: email || '[contact email]',
    contact_postal: address ? `, or write to us at ${address}` : '',
    dpo_line: dpo ? `Our data protection officer can be reached at ${dpo}.` : `We have not appointed a data protection officer. Send privacy questions to ${email || '[contact email]'}.`,
    data_collected_list: list(many(answers, 'data_collected').map(k => DATA_LINES[k]).filter((v): v is string => !!v), 'We do not collect personal data beyond what your device sends when it connects to us.'),
    processors_list: list([...processors, ...others], 'We do not share personal data with third-party service providers.'),
    retention: text(answers, 'retention') || 'for as long as your account is active, and afterwards only as long as needed to meet legal obligations and resolve disputes',
    cookie_list: list(many(answers, 'cookie_types').map(k => (COOKIE_LINES[k] || '').replaceAll('{{app_name}}', appName)).filter(Boolean), 'We do not use cookies or similar technologies beyond what is strictly necessary.'),
    governing_law: text(answers, 'governing_law') || '[governing law]',
    min_age: text(answers, 'min_age') || '13',
    refund_window_days: text(answers, 'refund_window_days') || '14'
  }
}

/** `{{name}}` → its value; an unknown name becomes empty. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, name: string) => vars[name] ?? '')
}

export type ComposedDocument = {
  title: string
  sections: LegalSection[]
  jurisdictions: string[]
}

/** Answers → the sections of a document: every clause whose condition holds, in order, with its variables filled. */
export function composeDocument(type: LegalDocType, answers: LegalAnswers): ComposedDocument {
  const vars = composeVariables(answers)
  const sections: LegalSection[] = clausesFor(type)
    .filter(clause => matches(clause.when, answers))
    .map(clause => ({
      id: clause.id,
      clauseId: clause.id,
      heading: clause.heading,
      body: fillTemplate(clause.body, vars),
      source: 'template' as const,
      locked: false,
      satisfies: clause.satisfies || []
    }))
  return { title: LEGAL_DOC_LABELS[type], sections, jurisdictions: answeredRegions(answers) }
}

const isProtected = (section: LegalSection) => section.locked || section.source !== 'template'

/**
 * Recompose without losing work: sections a person edited, locked, or that AI
 * wrote keep their text; template sections take the fresh text or drop out when
 * their clause no longer applies; clauses that newly apply are added next to
 * their neighbours.
 */
export function mergeRecomposed(existing: LegalSection[], fresh: LegalSection[]): LegalSection[] {
  const freshById = new Map(fresh.map(section => [section.id, section]))
  const result: LegalSection[] = []
  for (const section of existing) {
    if (isProtected(section)) result.push(section)
    else {
      const next = freshById.get(section.id)
      if (next) result.push(next)
    }
  }
  const have = new Set(result.map(section => section.id))
  fresh.forEach((section, index) => {
    if (have.has(section.id)) return
    // Insert after the closest earlier fresh section already placed; else at the top.
    let at = 0
    for (let i = index - 1; i >= 0; i--) {
      const placed = result.findIndex(r => r.id === fresh[i]!.id)
      if (placed !== -1) { at = placed + 1; break }
    }
    result.splice(at, 0, section)
    have.add(section.id)
  })
  return result
}

export type SectionEdit = { id?: string, heading?: string, body?: string, locked?: boolean }

let counter = 0
export function newSectionId(): string {
  counter += 1
  return `s_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Applies a full list of edits to a document's sections: unknown ids become human sections, omitted ones are removed, a changed template section turns `human`. */
export function applySectionEdits(existing: LegalSection[], edits: SectionEdit[]): LegalSection[] {
  const byId = new Map(existing.map(section => [section.id, section]))
  return edits.map((edit) => {
    const heading = String(edit.heading ?? '').trim().slice(0, 200)
    const body = String(edit.body ?? '')
    const current = edit.id ? byId.get(edit.id) : undefined
    if (!current) {
      return { id: newSectionId(), heading: heading || 'Untitled', body, source: 'human' as const, locked: !!edit.locked, satisfies: [] }
    }
    const changed = (edit.heading !== undefined && heading !== current.heading) || (edit.body !== undefined && body !== current.body)
    return {
      ...current,
      heading: edit.heading !== undefined ? heading : current.heading,
      body: edit.body !== undefined ? body : current.body,
      locked: edit.locked !== undefined ? !!edit.locked : current.locked,
      source: changed ? 'human' as const : current.source
    }
  })
}

/** The document as Markdown: one `##` heading per section. */
export function sectionsToMarkdown(sections: LegalSection[]): string {
  return sections.map(section => `## ${section.heading}\n\n${section.body.trim()}`).join('\n\n')
}

// ---- rulepacks ---------------------------------------------------------------

/** The packs whose condition holds for these answers. */
export function applicablePacks(answers: LegalAnswers, packs: LegalRulepack[] = LEGAL_RULEPACKS): LegalRulepack[] {
  return packs.filter(pack => matches(pack.appliesWhen, answers))
}

export type ApplicableRequirement = LegalRequirement & { pack: string }

/** Every requirement that applies to a document of this type for these answers. */
export function applicableRequirements(type: LegalDocType, answers: LegalAnswers, packs: LegalRulepack[] = LEGAL_RULEPACKS): ApplicableRequirement[] {
  return applicablePacks(answers, packs).flatMap(pack =>
    pack.requirements.filter(req => req.docTypes.includes(type) && matches(req.appliesWhen, answers)).map(req => ({ ...req, pack: pack.id }))
  )
}

export type Coverage = { total: number, covered: ApplicableRequirement[], gaps: ApplicableRequirement[], unreviewedPacks: string[] }

/**
 * Structural check: a requirement is covered when some non-empty section lists
 * it. This shows what the document is missing, not whether the text is good
 * enough; the AI check reads the text.
 */
export function checkCoverage(type: LegalDocType, answers: LegalAnswers, sections: LegalSection[], packs: LegalRulepack[] = LEGAL_RULEPACKS): Coverage {
  const have = new Set(sections.filter(s => s.body.trim()).flatMap(s => s.satisfies))
  const reqs = applicableRequirements(type, answers, packs)
  const used = new Set(reqs.map(r => r.pack))
  return {
    total: reqs.length,
    covered: reqs.filter(r => have.has(r.id)),
    gaps: reqs.filter(r => !have.has(r.id)),
    unreviewedPacks: applicablePacks(answers, packs).filter(p => used.has(p.id) && !p.lastReviewed).map(p => p.id)
  }
}

// ---- keeping AI honest -----------------------------------------------------------

/** A requirement id as a model may write it back: the prompt shows `[R:id]`, so it can echo `R:id` or `[R:id]`. */
export function requirementId(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^\[?R:/i, '').replace(/\]$/, '').trim() : ''
}

const FINDING_STATUSES = new Set(['ok', 'missing', 'unclear', 'conflict'])

/** Parses model output into findings, dropping any that cite a requirement we did not supply. */
export function sanitizeFindings(raw: unknown, allowed: Set<string>): LegalFinding[] {
  const items = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const out: LegalFinding[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const { requirement: cited, status, note } = item as Record<string, unknown>
    const requirement = requirementId(cited)
    if (!allowed.has(requirement) || seen.has(requirement)) continue
    if (typeof status !== 'string' || !FINDING_STATUSES.has(status)) continue
    seen.add(requirement)
    out.push({ requirement, status: status as LegalFinding['status'], note: String(note ?? '').trim().slice(0, 600) })
  }
  return out
}

/**
 * The first JSON array or object in a model reply, which may wrap it in prose or
 * a code fence. An array cut off by the token limit keeps the objects that were
 * completed (they are flat, like findings and sections).
 */
export function extractJson(reply: string): unknown {
  const start = reply.search(/[[{]/)
  if (start === -1) return null
  const open = reply[start]!
  const end = reply.lastIndexOf(open === '[' ? ']' : '}')
  if (end > start) {
    try { return JSON.parse(reply.slice(start, end + 1)) } catch { /* fall through to the truncated case */ }
  }
  const cut = reply.lastIndexOf('}')
  if (open === '[' && cut > start) {
    try { return JSON.parse(`${reply.slice(start, cut + 1)}]`) } catch { return null }
  }
  return null
}

// ---- TL;DR -------------------------------------------------------------------------

/** A person's edit always wins: `human`. */
export function humanTldr(text: string): LegalTldr {
  return { text: text.trim().slice(0, 1200), source: 'human' }
}

/** AI may replace a TL;DR only when none exists, the current one is AI-written, or `force` is set. */
export function canReplaceTldr(current: LegalTldr | null | undefined, force = false): boolean {
  return force || !current || !current.text.trim() || current.source === 'ai'
}

export function aiTldr(text: string): LegalTldr {
  return { text: text.trim().slice(0, 1200), source: 'ai' }
}
