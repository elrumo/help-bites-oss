// Contacts: the people of one project. A contact is an EndUser row — the
// app's own users (made from identity tokens) plus anyone imported, synced
// from the developer's database or signed up through a form. Shared by the
// server and the panel; the native app mirrors the DTO.

export type ContactSubscription = 'none' | 'pending' | 'subscribed' | 'unsubscribed'
export const CONTACT_SUBSCRIPTIONS: ContactSubscription[] = ['none', 'pending', 'subscribed', 'unsubscribed']

export type ContactAttributeValue = string | number | boolean

/** Proof of marketing consent: how, when and from where someone opted in. */
export type ContactConsent = { source: string, at: string, ip?: string, ua?: string, formUrl?: string, confirmedAt?: string }

export type Contact = {
  id: string
  externalId: string
  email: string
  name: string
  username: string
  avatarUrl: string
  attributes: Record<string, ContactAttributeValue>
  tags: string[]
  subscription: ContactSubscription
  /** Topics this contact opted out of; every other topic reaches them while subscribed. */
  unsubscribedTopics: string[]
  consent: ContactConsent | null
  /** Ids of the sources (database syncs) this contact came from. */
  sources: string[]
  feedbackEmails: boolean
  lastSeenAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export const CONTACT_LIMITS = { attributes: 50, attributeValue: 500, tags: 50, tag: 40, topics: 50, batch: 1000, name: 120, email: 200, externalId: 200 }

// Stored as nested Mongo keys and queried as `attributes.<key>`: no dots, no `$`.
export const ATTRIBUTE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
export const TOPIC_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

/** Lowercased address, or '' when it does not look like one. */
export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') return ''
  const email = value.trim().toLowerCase()
  if (!email || email.length > CONTACT_LIMITS.email || /\s/.test(email)) return ''
  const at = email.indexOf('@')
  return at > 0 && at < email.length - 1 && email.lastIndexOf('@') === at && email.includes('.', at) ? email : ''
}

function attributeValue(value: unknown): ContactAttributeValue | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return value.trim().slice(0, CONTACT_LIMITS.attributeValue)
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  return undefined
}

/** Merge attribute changes onto `base`; `null` removes a key. */
export function cleanAttributes(value: unknown, base: Record<string, ContactAttributeValue> = {}): { attributes: Record<string, ContactAttributeValue>, errors: string[] } {
  const errors: string[] = []
  const attributes = { ...base }
  if (value === undefined) return { attributes, errors }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { attributes, errors: ['attributes must be an object'] }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ATTRIBUTE_KEY_RE.test(key)) { errors.push(`Attribute "${key.slice(0, 40)}": use letters, digits and _ (start with a letter, up to 40)`); continue }
    if (raw === null) { delete attributes[key]; continue }
    const clean = attributeValue(raw)
    if (clean === undefined) { errors.push(`Attribute "${key}" must be a string, number or boolean`); continue }
    attributes[key] = clean
  }
  if (Object.keys(attributes).length > CONTACT_LIMITS.attributes) errors.push(`At most ${CONTACT_LIMITS.attributes} attributes`)
  return { attributes, errors }
}

/** Trimmed, deduped tags; a comma-separated string works too (CSV columns). */
export function cleanTags(value: unknown): string[] {
  const list = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : []
  const tags = list.map(t => String(t ?? '').trim().slice(0, CONTACT_LIMITS.tag)).filter(Boolean)
  return [...new Set(tags)].slice(0, CONTACT_LIMITS.tags)
}

export function cleanTopicKeys(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  return [...new Set(list.map(t => String(t ?? '').trim().toLowerCase()).filter(t => TOPIC_KEY_RE.test(t)))].slice(0, CONTACT_LIMITS.topics)
}

/** What a create, an update, an import row or a synced row may set. */
export type ContactInput = {
  externalId?: string
  email?: string
  name?: string
  attributes?: Record<string, ContactAttributeValue | null>
  tags?: string[]
  subscription?: ContactSubscription
  unsubscribedTopics?: string[]
}

/** Validate one contact as the API receives it. Unknown keys are ignored. */
export function readContactInput(value: unknown): { input: ContactInput, errors: string[] } {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const errors: string[] = []
  const input: ContactInput = {}
  if (raw.externalId !== undefined && raw.externalId !== null && raw.externalId !== '') {
    const id = String(raw.externalId).trim()
    if (!id || id.length > CONTACT_LIMITS.externalId) errors.push('externalId must be 1–200 characters')
    else input.externalId = id
  }
  if (raw.email !== undefined && raw.email !== null && raw.email !== '') {
    const email = normalizeEmail(raw.email)
    if (!email) errors.push(`"${String(raw.email).slice(0, 80)}" is not an email address`)
    else input.email = email
  }
  if (typeof raw.name === 'string') input.name = raw.name.trim().slice(0, CONTACT_LIMITS.name)
  if (raw.attributes !== undefined) {
    if (!raw.attributes || typeof raw.attributes !== 'object' || Array.isArray(raw.attributes)) errors.push('attributes must be an object')
    else {
      // Checked here, merged onto the stored row later (null still means "remove").
      const { errors: attrErrors } = cleanAttributes(Object.fromEntries(Object.entries(raw.attributes as Record<string, unknown>).filter(([, v]) => v !== null)))
      errors.push(...attrErrors)
      input.attributes = raw.attributes as ContactInput['attributes']
    }
  }
  if (raw.tags !== undefined) input.tags = cleanTags(raw.tags)
  if (raw.subscription !== undefined) {
    if (!CONTACT_SUBSCRIPTIONS.includes(raw.subscription as ContactSubscription)) errors.push(`subscription must be one of ${CONTACT_SUBSCRIPTIONS.join(', ')}`)
    else input.subscription = raw.subscription as ContactSubscription
  }
  if (raw.unsubscribedTopics !== undefined) input.unsubscribedTopics = cleanTopicKeys(raw.unsubscribedTopics)
  if (!input.externalId && !input.email) errors.push('Pass an email or an externalId')
  return { input, errors }
}

// ---- mapping a row from somewhere else ------------------------------------------

/** Which column (or dot-path) of a source row fills which contact field. */
export type ContactFieldMapping = {
  externalId?: string
  email?: string
  name?: string
  tags?: string
  /** A truthy value means opted in, a falsy one opted out; blank leaves consent alone. */
  subscribed?: string
  attributes?: Record<string, string>
}

export function readPath(row: unknown, path: string): unknown {
  let value: unknown = row
  for (const part of path.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[part]
  }
  // Parse REST dates arrive as { __type: 'Date', iso }.
  if (value && typeof value === 'object' && (value as { __type?: unknown }).__type === 'Date') return (value as { iso?: unknown }).iso
  return value
}

const TRUTHY = new Set(['true', '1', 'yes', 'y', 'on', 'subscribed', 'opted_in', 'opt-in'])
const FALSY = new Set(['false', '0', 'no', 'n', 'off', 'unsubscribed', 'opted_out', 'opt-out'])

/** Truthy/falsy as a CSV cell or a database column says it; null when it says nothing. */
export function readFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const text = String(value ?? '').trim().toLowerCase()
  if (TRUTHY.has(text)) return true
  if (FALSY.has(text)) return false
  return null
}

/** One source row as a contact, or null when it has neither an email nor an id. */
export function mapSourceRow(row: unknown, mapping: ContactFieldMapping): ContactInput | null {
  const text = (path?: string) => {
    if (!path) return ''
    const value = readPath(row, path)
    return value === null || value === undefined ? '' : String(value).trim()
  }
  const input: ContactInput = {}
  const externalId = text(mapping.externalId).slice(0, CONTACT_LIMITS.externalId)
  const email = normalizeEmail(text(mapping.email))
  if (externalId) input.externalId = externalId
  if (email) input.email = email
  if (!externalId && !email) return null
  const name = text(mapping.name).slice(0, CONTACT_LIMITS.name)
  if (name) input.name = name
  if (mapping.tags) input.tags = cleanTags(readPath(row, mapping.tags))
  if (mapping.subscribed) {
    const flag = readFlag(readPath(row, mapping.subscribed))
    if (flag !== null) input.subscription = flag ? 'subscribed' : 'unsubscribed'
  }
  if (mapping.attributes) {
    const attributes: Record<string, ContactAttributeValue> = {}
    for (const [key, path] of Object.entries(mapping.attributes)) {
      if (!ATTRIBUTE_KEY_RE.test(key) || !path) continue
      const value = attributeValue(readPath(row, path))
      if (value !== undefined && value !== '') attributes[key] = value
    }
    if (Object.keys(attributes).length) input.attributes = attributes
  }
  return input
}

/** Check a mapping before saving it: it must say where the email or the id is. */
export function validateMapping(value: unknown): { mapping: ContactFieldMapping, errors: string[] } {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const path = (v: unknown) => (typeof v === 'string' && /^[\w$-]+(\.[\w$-]+)*$/.test(v.trim()) ? v.trim().slice(0, 120) : '')
  const mapping: ContactFieldMapping = {}
  for (const key of ['externalId', 'email', 'name', 'tags', 'subscribed'] as const) {
    const p = path(raw[key])
    if (p) mapping[key] = p
  }
  const errors: string[] = []
  if (raw.attributes && typeof raw.attributes === 'object' && !Array.isArray(raw.attributes)) {
    const attributes: Record<string, string> = {}
    for (const [key, p] of Object.entries(raw.attributes as Record<string, unknown>)) {
      if (!ATTRIBUTE_KEY_RE.test(key)) { errors.push(`Attribute "${key.slice(0, 40)}": use letters, digits and _`); continue }
      if (path(p)) attributes[key] = path(p)
    }
    if (Object.keys(attributes).length > CONTACT_LIMITS.attributes) errors.push(`At most ${CONTACT_LIMITS.attributes} attributes`)
    if (Object.keys(attributes).length) mapping.attributes = attributes
  }
  if (!mapping.email && !mapping.externalId) errors.push('Map the email or the user id column')
  return { mapping, errors }
}

/** Every source column the mapping reads, so a sync fetches only those (never a password hash). */
export function mappedColumns(mapping: ContactFieldMapping): string[] {
  const paths = [mapping.externalId, mapping.email, mapping.name, mapping.tags, mapping.subscribed, ...Object.values(mapping.attributes || {})]
  return [...new Set(paths.filter((p): p is string => Boolean(p)).map(p => p.split('.')[0]!))]
}

// ---- CSV ---------------------------------------------------------------------------

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF, a BOM. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      if (row.some(f => f !== '')) rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  row.push(field)
  if (row.some(f => f !== '')) rows.push(row)
  return rows
}

/** The header row names the columns; each later row becomes an object. */
export function csvRecords(text: string): { columns: string[], records: Record<string, string>[] } {
  const [header = [], ...rest] = parseCsv(text)
  const columns = header.map(c => c.trim())
  const records = rest.map(cells => Object.fromEntries(columns.map((c, i) => [c, (cells[i] ?? '').trim()])))
  return { columns, records }
}

/** A first guess at which CSV column is which, by its name. */
export function guessMapping(columns: string[]): ContactFieldMapping {
  const find = (re: RegExp) => columns.find(c => re.test(c.toLowerCase().replace(/[\s_-]+/g, '')))
  return {
    email: find(/^(e?mail|emailaddress)$/) || find(/mail/),
    externalId: find(/^(id|userid|externalid|uid|objectid)$/),
    name: find(/^(name|fullname|displayname)$/),
    tags: find(/^tags?$/),
    subscribed: find(/^(subscribed|optin|marketing|newsletter|consent)$/)
  }
}
