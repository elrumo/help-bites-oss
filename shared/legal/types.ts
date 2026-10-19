// Legal documents: the shapes shared by the server, the panel and the tests.
// Everything under shared/legal is pure (no Parse, no network) so it unit-tests
// without a database.

export const LEGAL_DOC_TYPES = ['privacy', 'terms', 'cookies', 'refund'] as const
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number]

export const LEGAL_DOC_LABELS: Record<LegalDocType, string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  cookies: 'Cookie Policy',
  refund: 'Refund Policy'
}

/** Regions the wizard asks about. `row` is everywhere else. */
export const LEGAL_REGIONS = ['eu', 'uk', 'us-ca', 'us-other', 'br', 'ca', 'au', 'row'] as const
export type LegalRegion = (typeof LEGAL_REGIONS)[number]

export const LEGAL_REGION_LABELS: Record<LegalRegion, string> = {
  'eu': 'European Union / EEA',
  'uk': 'United Kingdom',
  'us-ca': 'United States: California',
  'us-other': 'United States: other states',
  'br': 'Brazil',
  'ca': 'Canada',
  'au': 'Australia',
  'row': 'Rest of the world'
}

export type LegalAnswer = string | boolean | string[]
export type LegalAnswers = Record<string, LegalAnswer>

/**
 * A condition over the wizard's answers. Every key present must hold (AND);
 * `anyOf` holds when one of its members does.
 *   regions  the answers' regions overlap this list (no regions answered counts as `row`)
 *   has      a multi-choice answer includes one of the listed values
 *   is       an answer equals the value (an unanswered boolean equals false)
 */
export type When = {
  regions?: string[]
  has?: Record<string, string[]>
  is?: Record<string, string | boolean>
  anyOf?: When[]
}

export type LegalSectionSource = 'template' | 'ai' | 'human'

export type LegalSection = {
  /** A clause id for a section a template produced; a generated id for one added by hand. */
  id: string
  clauseId?: string
  heading: string
  /** Markdown. */
  body: string
  source: LegalSectionSource
  /** A locked section is never touched by a recompose or an AI rewrite. */
  locked: boolean
  /** Rulepack requirement ids this section answers, copied from its clause. */
  satisfies: string[]
}

export type LegalClause = {
  id: string
  docType: LegalDocType
  heading: string
  /** Position in the document: lower first. */
  order: number
  /** Markdown with `{{variable}}` placeholders. */
  body: string
  when?: When
  satisfies?: string[]
}

export type LegalRequirement = {
  id: string
  docTypes: LegalDocType[]
  /** A paraphrase, never statute text. */
  summary: string
  citation: string
  severity: 'required' | 'recommended'
  /** Narrows the pack's own condition. */
  appliesWhen?: When
}

export type LegalRulepack = {
  id: string
  name: string
  /** What kind of source this is: a law, a platform policy or a best-practice checklist. */
  kind: 'law' | 'platform' | 'best-practice'
  version: string
  sourceUrl: string
  /** ISO date a person last checked the pack against its sources; null while unreviewed. */
  lastReviewed: string | null
  appliesWhen: When
  requirements: LegalRequirement[]
}

export type LegalTldr = { text: string, source: 'ai' | 'human' }

export type LegalQuestionKind = 'text' | 'longtext' | 'boolean' | 'select' | 'multi'

export type LegalQuestion = {
  id: string
  label: string
  help?: string
  kind: LegalQuestionKind
  options?: { value: string, label: string }[]
  required?: boolean
  /** Which documents ask this; `all` for every one. */
  docTypes: LegalDocType[] | 'all'
  showIf?: When
  placeholder?: string
}

export type LegalFinding = {
  /** A requirement id from the rulepacks that were supplied. */
  requirement: string
  status: 'ok' | 'missing' | 'unclear' | 'conflict'
  note: string
}
