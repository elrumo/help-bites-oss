// A segment is a saved filter over a project's contacts:
//   { match: 'all' | 'any', rules: [{ field, op, value }] }
// compiled to a Parse REST `where` object. The server wraps it in its own
// `$and` with the project (and, for campaigns, the subscription rules), so a
// segment can narrow an audience but never widen it.

import { ATTRIBUTE_KEY_RE, CONTACT_ORIGIN_TYPES, CONTACT_SUBSCRIPTIONS } from './contacts'

export type SegmentOp =
  | 'is' | 'is_not' | 'contains' | 'starts_with' | 'exists' | 'not_exists'
  | 'gt' | 'lt' | 'before' | 'after' | 'within_days' | 'not_within_days'
  | 'includes' | 'excludes'

export type SegmentValue = string | number | boolean
export type SegmentRule = { field: string, op: SegmentOp, value?: SegmentValue }
export type SegmentFilter = { match: 'all' | 'any', rules: SegmentRule[] }

/** `auto`: made by HelpBites (a lead form's segment, or every lead); it can be renamed, edited and deleted like any other. */
export type ContactSegment = { id: string, projectId: string, name: string, filter: SegmentFilter, auto: boolean, createdAt: string | null, updatedAt: string | null }

type FieldKind = 'text' | 'enum' | 'list' | 'date' | 'attribute'

export const SEGMENT_FIELDS: { key: string, label: string, kind: FieldKind }[] = [
  { key: 'email', label: 'Email', kind: 'text' },
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'externalId', label: 'User id', kind: 'text' },
  { key: 'subscription', label: 'Subscription', kind: 'enum' },
  { key: 'tags', label: 'Tags', kind: 'list' },
  { key: 'unsubscribedTopics', label: 'Opted-out topics', kind: 'list' },
  { key: 'sources', label: 'Source', kind: 'list' },
  { key: 'origin', label: 'Added via', kind: 'enum' },
  { key: 'leadForms', label: 'Lead form', kind: 'list' },
  { key: 'createdAt', label: 'Added', kind: 'date' },
  { key: 'lastSeenAt', label: 'Last seen', kind: 'date' },
  { key: 'updatedAt', label: 'Updated', kind: 'date' }
]

export const SEGMENT_OPS: Record<FieldKind, SegmentOp[]> = {
  text: ['is', 'is_not', 'contains', 'starts_with', 'exists', 'not_exists'],
  enum: ['is', 'is_not'],
  list: ['includes', 'excludes', 'exists', 'not_exists'],
  date: ['before', 'after', 'within_days', 'not_within_days', 'exists', 'not_exists'],
  attribute: ['is', 'is_not', 'contains', 'starts_with', 'gt', 'lt', 'before', 'after', 'exists', 'not_exists']
}

export const SEGMENT_OP_LABELS: Record<SegmentOp, string> = {
  is: 'is', is_not: 'is not', contains: 'contains', starts_with: 'starts with', exists: 'is set', not_exists: 'is not set',
  gt: 'is more than', lt: 'is less than', before: 'is before', after: 'is after',
  within_days: 'in the last … days', not_within_days: 'not in the last … days', includes: 'includes', excludes: 'does not include'
}

const MAX_RULES = 20
const VALUELESS: SegmentOp[] = ['exists', 'not_exists']

export function segmentFieldKind(field: string): FieldKind | null {
  if (field.startsWith('attributes.')) return ATTRIBUTE_KEY_RE.test(field.slice(11)) ? 'attribute' : null
  return SEGMENT_FIELDS.find(f => f.key === field)?.kind || null
}

export const EMPTY_SEGMENT: SegmentFilter = { match: 'all', rules: [] }

/** Check a filter as the API receives it. Values are primitives only: no `$` operators sneak through. */
export function validateSegmentFilter(value: unknown): { filter: SegmentFilter, errors: string[] } {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const errors: string[] = []
  const match = raw.match === 'any' ? 'any' : 'all'
  const list = Array.isArray(raw.rules) ? raw.rules : []
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) errors.push('rules must be a list')
  if (list.length > MAX_RULES) errors.push(`At most ${MAX_RULES} rules`)
  const rules: SegmentRule[] = []
  for (const [i, item] of list.slice(0, MAX_RULES).entries()) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const field = String(r.field || '')
    const op = String(r.op || '') as SegmentOp
    const kind = segmentFieldKind(field)
    const at = `Rule ${i + 1}`
    if (!kind) { errors.push(`${at}: unknown field "${field.slice(0, 60)}"`); continue }
    if (!SEGMENT_OPS[kind].includes(op)) { errors.push(`${at}: "${op}" does not apply to ${field}`); continue }
    if (VALUELESS.includes(op)) { rules.push({ field, op }); continue }
    const v = r.value
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') { errors.push(`${at}: needs a value`); continue }
    if (typeof v === 'string' && (!v.trim() || v.length > 200)) { errors.push(`${at}: the value must be 1–200 characters`); continue }
    if ((op === 'within_days' || op === 'not_within_days') && !(Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) <= 3650)) { errors.push(`${at}: days must be a whole number from 1 to 3650`); continue }
    if ((op === 'gt' || op === 'lt') && !Number.isFinite(Number(v))) { errors.push(`${at}: needs a number`); continue }
    if ((op === 'before' || op === 'after') && Number.isNaN(new Date(String(v)).getTime())) { errors.push(`${at}: needs a date`); continue }
    if (field === 'subscription' && !CONTACT_SUBSCRIPTIONS.includes(v as never)) { errors.push(`${at}: subscription is one of ${CONTACT_SUBSCRIPTIONS.join(', ')}`); continue }
    if (field === 'origin' && !CONTACT_ORIGIN_TYPES.includes(v as never)) { errors.push(`${at}: origin is one of ${CONTACT_ORIGIN_TYPES.join(', ')}`); continue }
    rules.push({ field, op, value: typeof v === 'string' ? v.trim() : v })
  }
  return { filter: { match, rules }, errors }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const parseDate = (date: Date) => ({ __type: 'Date', iso: date.toISOString() })

/** An attribute typed in as text may be stored as a number or a boolean: match all of them. */
function attributeValues(value: SegmentValue): SegmentValue[] {
  if (typeof value !== 'string') return [value]
  const out: SegmentValue[] = [value]
  if (/^-?\d+(\.\d+)?$/.test(value)) out.push(Number(value))
  if (value === 'true' || value === 'false') out.push(value === 'true')
  return out
}

// Fields stored under another name on the row.
const COLUMNS: Record<string, string> = { origin: 'origin.type' }

function compileRule(rule: SegmentRule, now: Date): Record<string, unknown> {
  const kind = segmentFieldKind(rule.field)!
  const f = COLUMNS[rule.field] || rule.field
  const v = rule.value as SegmentValue
  const text = (x: SegmentValue) => (f === 'email' ? String(x).toLowerCase() : String(x))
  // Stored dates on the row are Parse Dates; dates inside `attributes` are ISO strings.
  const date = (x: SegmentValue) => (kind === 'date' ? parseDate(new Date(String(x))) : new Date(String(x)).toISOString())
  const daysAgo = () => parseDate(new Date(now.getTime() - Number(v) * 86_400_000))
  switch (rule.op) {
    case 'exists': return { [f]: { $exists: true } }
    case 'not_exists': return { [f]: { $exists: false } }
    case 'is': return kind === 'attribute' ? { [f]: { $in: attributeValues(v) } } : { [f]: text(v) }
    case 'is_not': return kind === 'attribute' ? { [f]: { $nin: attributeValues(v) } } : { [f]: { $ne: text(v) } }
    case 'contains': return { [f]: { $regex: escapeRegex(text(v)), $options: 'i' } }
    case 'starts_with': return { [f]: { $regex: `^${escapeRegex(text(v))}`, $options: 'i' } }
    case 'gt': return { [f]: { $gt: Number(v) } }
    case 'lt': return { [f]: { $lt: Number(v) } }
    case 'before': return { [f]: { $lt: date(v) } }
    case 'after': return { [f]: { $gt: date(v) } }
    case 'within_days': return { [f]: { $gte: daysAgo() } }
    // Never seen counts as "not in the last N days".
    case 'not_within_days': return { $or: [{ [f]: { $lt: daysAgo() } }, { [f]: { $exists: false } }] }
    case 'includes': return { [f]: String(v) }
    case 'excludes': return { [f]: { $ne: String(v) } }
  }
}

/** Everyone who came through one lead form: the segment a form makes for itself. */
export const leadFormSegmentFilter = (formId: string): SegmentFilter => ({ match: 'all', rules: [{ field: 'leadForms', op: 'includes', value: formId }] })
/** Everyone who came through any lead form. */
export const ALL_LEADS_SEGMENT: SegmentFilter = { match: 'all', rules: [{ field: 'leadForms', op: 'exists' }] }

/** The filter as a Parse REST `where`; `{}` (everyone) when it has no rules. */
export function compileSegmentFilter(filter: SegmentFilter, now = new Date()): Record<string, unknown> {
  const parts = filter.rules.map(rule => compileRule(rule, now))
  if (!parts.length) return {}
  if (parts.length === 1) return parts[0]!
  return filter.match === 'any' ? { $or: parts } : { $and: parts }
}
