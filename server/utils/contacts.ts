import { createError, readBody } from 'h3'
import { cleanAttributes, cleanTags, cleanTopicKeys, guessContactOrigin, normalizeEmail, originTypeForVia, readContactOrigin, CONTACT_LIMITS, type Contact, type ContactAttributeValue, type ContactConsent, type ContactInput, type ContactOriginType, type ContactSubscription } from '#shared/contacts'
import { validateSegmentFilter, type ContactSegment, type SegmentFilter } from '#shared/segments'
import { MASTER, iso, pointerId, useParse, type ParseObject } from './parse'
import { runExclusive } from './redis'
import { searchEndUserIds, syncEndUsersForSearch } from './searchSync'
import { checkGauge, projectWorkspaceId } from './usage'
import { emitDomainEvent } from './domainEvents'
import { resolveSegmentWhere } from './segmentRelations'

// Contacts are EndUser rows (see shared/contacts.ts). Everything that creates
// or changes one in bulk — the contacts API, CSV imports, database syncs,
// sign-up forms — goes through upsertContacts, which owns the matching and
// the consent rules:
//   - a row is matched by externalId, then by email (an email-only row is
//     adopted by the first id that claims its address);
//   - opt-out wins from every side: anyone may unsubscribe someone, but only
//     an explicit call (the person's own action, through the API or a form)
//     may subscribe someone who unsubscribed. Imports and syncs only seed
//     consent for people who have not said anything yet.

// The error inbox files alerts under made-up users; they are not people.
export const SYSTEM_EXTERNAL_IDS = ['glitchtip-alerts', 'bugsink-alerts']

const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : [])

export function serializeContact(row: ParseObject): Contact {
  const consent = record(row.get('consent'))
  return {
    id: row.id || '',
    externalId: String(row.get('externalId') || ''),
    email: String(row.get('email') || ''),
    name: String(row.get('name') || ''),
    username: String(row.get('username') || ''),
    avatarUrl: String(row.get('avatarUrl') || ''),
    language: String(row.get('language') || ''),
    attributes: record(row.get('attributes')) as Record<string, ContactAttributeValue>,
    tags: strings(row.get('tags')),
    subscription: (row.get('subscription') as ContactSubscription) || 'none',
    unsubscribedTopics: strings(row.get('unsubscribedTopics')),
    consent: consent.at ? consent as ContactConsent : null,
    sources: strings(row.get('sources')),
    origin: readContactOrigin(row.get('origin')) || guessContactOrigin({ externalId: row.get('externalId'), sources: row.get('sources'), consent: row.get('consent'), leadForms: row.get('leadForms'), anonymous: row.get('anonymous') }),
    leadForms: strings(row.get('leadForms')),
    feedbackEmails: row.get('feedbackEmails') !== false,
    lastSeenAt: iso(row.get('lastSeenAt')),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  }
}

// ---- writing ---------------------------------------------------------------------

export type ContactWriteOptions = {
  /** Who is writing, for the consent record: 'api', 'import', 'form', 'panel', or a source id for a sync. */
  via: string
  /** A source (database sync) id, remembered on the contact. */
  sourceId?: string
  /** The person's own choice (an API call, a form): may re-subscribe someone who unsubscribed. */
  explicit?: boolean
  /** Imports fill blanks only; the API and syncs overwrite (their data is the truth). */
  fillOnly?: boolean
  consent?: Omit<ContactConsent, 'source' | 'at'>
  /** How someone new got here, when `via` does not say enough (a lead form and which one). */
  origin?: { type: ContactOriginType, id?: string }
}

export type ContactWriteResult = { index: number, status: 'created' | 'updated' | 'unchanged' | 'failed', id: string, error?: string }

export type SubscriptionChange = { contact: ParseObject, from: ContactSubscription, to: ContactSubscription, topics?: { added: string[], removed: string[] } }

/** Tell the developer's app (event webhook) and start sequences that wait for a sign-up. */
async function announce(project: ParseObject, changes: SubscriptionChange[]) {
  if (!changes.length) return
  try {
    for (const c of changes) {
      await emitDomainEvent(project, 'contact.subscription_changed', { contact: { id: c.contact.id, externalId: c.contact.get('externalId') || '', email: c.contact.get('email') || '' }, from: c.from, to: c.to, unsubscribedTopics: c.contact.get('unsubscribedTopics') || [], ...(c.topics ? { topics: c.topics } : {}) })
    }
    // Loaded on use: sequences send through campaigns, which read contacts.
    const { enrollOnSubscribe } = await import('./sequences')
    await enrollOnSubscribe(project, changes.filter(c => c.to === 'subscribed' && c.from !== 'subscribed').map(c => c.contact))
  } catch (error) {
    console.error('[contacts] announcing a subscription change failed:', (error as Error).message)
  }
}

/** What a subscription change is allowed to do; null leaves it alone. */
export function nextSubscription(current: ContactSubscription, wanted: ContactSubscription | undefined, explicit: boolean): ContactSubscription | null {
  if (!wanted || wanted === current) return null
  if (wanted === 'unsubscribed') return 'unsubscribed'
  // Signing up again does not put a confirmed subscriber back to waiting.
  if (wanted === 'pending' && current === 'subscribed') return null
  if (current === 'unsubscribed' && !explicit) return null
  if (wanted === 'none' && !explicit) return null
  // A synced "yes" confirms nothing a pending form is waiting for… unless it is the person's own call.
  if (wanted === 'subscribed' && current === 'pending' && !explicit) return null
  return wanted
}

/** Apply one input to a row; true when something changed. */
export function applyContactInput(row: ParseObject, input: ContactInput, options: ContactWriteOptions, now = new Date()): { changed: boolean, subscription: SubscriptionChange | null, errors: string[] } {
  const errors: string[] = []
  let changed = row.isNew()
  const set = (key: string, value: unknown) => {
    if (JSON.stringify(row.get(key) ?? null) === JSON.stringify(value ?? null)) return
    row.set(key, value)
    changed = true
  }
  const fill = (key: string, value: string | undefined) => {
    if (!value) return
    if (options.fillOnly && row.get(key)) return
    set(key, value)
  }
  if (input.externalId && !row.get('externalId')) set('externalId', input.externalId)
  fill('email', input.email)
  fill('name', input.name)
  // A blank clears it (only the API and the panel send one); a language from a sync or import only fills a gap.
  if (input.language === '' && !options.fillOnly) set('language', null)
  else fill('language', input.language)
  if (input.attributes) {
    const base = record(row.get('attributes')) as Record<string, ContactAttributeValue>
    const incoming = options.fillOnly ? Object.fromEntries(Object.entries(input.attributes).filter(([k]) => base[k] === undefined)) : input.attributes
    const { attributes, errors: attrErrors } = cleanAttributes(incoming, base)
    errors.push(...attrErrors)
    if (!attrErrors.length) set('attributes', attributes)
  }
  if (input.tags?.length) {
    const tags = cleanTags([...strings(row.get('tags')), ...input.tags])
    set('tags', tags)
  }
  if (options.sourceId && !strings(row.get('sources')).includes(options.sourceId)) set('sources', [...strings(row.get('sources')), options.sourceId])
  if (input.leadForms?.length) {
    const before = strings(row.get('leadForms'))
    if (input.leadForms.some(id => !before.includes(id))) set('leadForms', [...new Set([...before, ...input.leadForms])])
  }
  // Set once, when the row is made: how this person first got here.
  if (row.isNew() && !row.get('origin')) set('origin', { type: options.origin?.type || originTypeForVia(options.via), id: options.origin?.id || options.sourceId || '', at: now.toISOString() })

  let subscription: SubscriptionChange | null = null
  const current = (row.get('subscription') as ContactSubscription) || 'none'
  const next = nextSubscription(current, input.subscription, Boolean(options.explicit))
  if (next) {
    set('subscription', next)
    if (next === 'subscribed' || next === 'pending') {
      set('consent', { source: options.via, at: now.toISOString(), ...options.consent })
      // Subscribing again starts with every topic.
      if (current === 'unsubscribed') set('unsubscribedTopics', [])
    }
    subscription = { contact: row, from: current, to: next }
  }
  if (input.unsubscribedTopics) {
    const before = strings(row.get('unsubscribedTopics'))
    const after = cleanTopicKeys(input.unsubscribedTopics)
    const added = after.filter(t => !before.includes(t))
    const removed = before.filter(t => !after.includes(t))
    if (added.length || removed.length) {
      set('unsubscribedTopics', after)
      subscription = { contact: row, from: current, to: (row.get('subscription') as ContactSubscription) || 'none', topics: { added, removed } }
    }
  }
  if (!row.get('subscription')) set('subscription', 'none')
  return { changed, subscription, errors }
}

/**
 * Create or update many contacts at once (≤1000 per call). One lock per
 * project around the lookups and creates, so two imports — or an import and
 * a sync — never create the same person twice.
 */
export async function upsertContacts(project: ParseObject, inputs: ContactInput[], options: ContactWriteOptions): Promise<ContactWriteResult[]> {
  if (inputs.length > CONTACT_LIMITS.batch) throw createError({ statusCode: 413, statusMessage: `At most ${CONTACT_LIMITS.batch} contacts per call` })
  const locked = await runExclusive(`sb:contacts:${project.id}`, 60, () => writeContacts(project, inputs, options), { waitMs: 20_000, failOpen: true })
  if (!locked.ran) throw createError({ statusCode: 503, statusMessage: 'Contacts are busy with another import; try again in a moment' })
  return locked.value
}

async function writeContacts(project: ParseObject, inputs: ContactInput[], options: ContactWriteOptions): Promise<ContactWriteResult[]> {
  const Parse = useParse()
  const ids = [...new Set(inputs.map(i => i.externalId).filter((v): v is string => Boolean(v)))]
  const emails = [...new Set(inputs.map(i => i.email).filter((v): v is string => Boolean(v)))]
  // In batches: a 1000-contact import can match more rows than one query returns, and a missed match is a duplicate.
  const [byIdRows, byEmailRows] = await Promise.all([
    ids.length ? collectAll(() => new Parse.Query('EndUser').equalTo('project', project).containedIn('externalId', ids), { max: ids.length * 2 }) : [],
    emails.length ? collectAll(() => new Parse.Query('EndUser').equalTo('project', project).containedIn('email', emails), { max: emails.length * 3 }) : []
  ])
  // Most recently updated first, as the matching below expects.
  byEmailRows.sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0))
  const byId = new Map(byIdRows.map(r => [String(r.get('externalId')), r]))
  const byEmail = new Map<string, ParseObject>()
  for (const row of byEmailRows) {
    const email = String(row.get('email') || '')
    // Prefer the row no id has claimed yet: that is the one an id may adopt.
    if (!byEmail.has(email) || (!row.get('externalId') && byEmail.get(email)!.get('externalId'))) byEmail.set(email, row)
  }

  const results: ContactWriteResult[] = []
  const dirty = new Map<ParseObject, number[]>()
  const changes: SubscriptionChange[] = []
  const now = new Date()
  for (const [index, input] of inputs.entries()) {
    let row = (input.externalId && byId.get(input.externalId)) || null
    if (!row && input.email) {
      const candidate = byEmail.get(input.email)
      // An email match is the same person only if no other id owns that row.
      if (candidate && (!input.externalId || !candidate.get('externalId'))) row = candidate
    }
    if (!row) {
      row = new (Parse.Object.extend('EndUser'))() as ParseObject
      row.set('project', project)
    }
    const { changed, subscription, errors } = applyContactInput(row, input, options, now)
    if (errors.length) { results.push({ index, status: 'failed', id: row.id || '', error: errors.join('; ') }); continue }
    if (input.externalId) byId.set(input.externalId, row)
    if (input.email) byEmail.set(input.email, row)
    if (subscription) changes.push(subscription)
    // The same new person twice in one batch is created once.
    results.push({ index, status: row.isNew() && !dirty.has(row) ? 'created' : changed ? 'updated' : 'unchanged', id: row.id || '' })
    if (changed) dirty.set(row, [...(dirty.get(row) || []), results.length - 1])
  }

  const rows = [...dirty.keys()]
  // One check for the API, imports, syncs and sign-ups. People who only chat come in through ensureEndUser and are never refused.
  await checkGauge(await projectWorkspaceId(project), 'contacts', rows.filter(row => row.isNew()).length)
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    try {
      await Parse.Object.saveAll(chunk, { ...MASTER, batchSize: 50 })
    } catch {
      // A batch error does not say which row; save one by one to find out.
      for (const row of chunk) {
        try { await row.save(null, MASTER) } catch (error) {
          for (const r of dirty.get(row) || []) Object.assign(results[r]!, { status: 'failed', error: (error as Error).message })
        }
      }
    }
  }
  for (const [row, positions] of dirty) for (const r of positions) if (results[r]!.status !== 'failed') results[r]!.id = row.id || ''
  void syncEndUsersForSearch(rows.filter(r => r.id))
  void announce(project, changes.filter(c => c.contact.id))
  return results
}

/** One contact's own change (PATCH, unsubscribe page, confirm link): saved and announced. */
export async function saveContact(project: ParseObject, row: ParseObject, input: ContactInput, options: ContactWriteOptions): Promise<ParseObject> {
  const { changed, subscription, errors } = applyContactInput(row, input, options)
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  if (!changed) return row
  await row.save(null, MASTER)
  void syncEndUsersForSearch([row])
  if (subscription) void announce(project, [subscription])
  return row
}

/** Mailgun's own unsubscribe link, on campaign mail: the contact stops getting marketing. */
export async function unsubscribeContactByEmail(project: ParseObject, email: string, via: string): Promise<void> {
  const row = await findContactBy(project, { email })
  if (row) await saveContact(project, row, { subscription: 'unsubscribed' }, { via })
}

// ---- reading ---------------------------------------------------------------------

/** A project's contacts matching a compiled segment `where`. Segment rules sit inside `$and`, so keys added after cannot be overridden by them. */
export function contactQuery(project: ParseObject, where: Record<string, unknown> = {}) {
  const Parse = useParse()
  const query = Parse.Query.fromJSON('EndUser', { where: Object.keys(where).length ? { $and: [where] } : {} })
  query.equalTo('project', project)
  query.notContainedIn('externalId', SYSTEM_EXTERNAL_IDS)
  return query
}

export async function getProjectContact(project: ParseObject, id: string): Promise<ParseObject> {
  const row = id ? await contactQuery(project).equalTo('objectId', id).first(MASTER) : null
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Contact not found' })
  return row
}

export async function findContactBy(project: ParseObject, by: { externalId?: string, email?: string }): Promise<ParseObject | null> {
  if (by.externalId) return (await contactQuery(project).equalTo('externalId', by.externalId).first(MASTER)) || null
  const email = normalizeEmail(by.email)
  if (email) return (await contactQuery(project).equalTo('email', email).descending('updatedAt').first(MASTER)) || null
  return null
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Newest first; the cursor is `createdAt|objectId` so rows imported in the
// same millisecond are neither skipped nor repeated.
function readCursor(cursor: string): { at: Date, id: string } | null {
  const [at, id] = cursor.split('|')
  const date = new Date(String(at))
  return id && !Number.isNaN(date.getTime()) ? { at: date, id } : null
}

export type ContactListOptions = { where?: Record<string, unknown>, q?: string, tag?: string, subscription?: string, origin?: string, leadForm?: string, updatedSince?: Date, cursor?: string, limit?: number }

export async function listContacts(project: ParseObject, options: ContactListOptions): Promise<{ contacts: Contact[], nextCursor: string | null }> {
  const Parse = useParse()
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
  const where: Record<string, unknown>[] = []
  if (options.where && Object.keys(options.where).length) where.push(options.where)
  if (options.tag) where.push({ tags: options.tag })
  if (options.subscription) where.push({ subscription: options.subscription })
  if (options.origin) where.push({ 'origin.type': options.origin })
  if (options.leadForm) where.push({ leadForms: options.leadForm })
  if (options.updatedSince) where.push({ updatedAt: { $gte: { __type: 'Date', iso: options.updatedSince.toISOString() } } })

  const term = (options.q || '').trim()
  if (term) {
    // Search returns one page of best matches, not a cursor.
    const ids = await searchEndUserIds(term, { workspaceId: pointerId(project.get('workspace')), projectId: project.id || '' }, limit).catch(() => [])
    const query = contactQuery(project, where.length ? { $and: where } : {})
    if (ids.length) query.containedIn('objectId', ids)
    else {
      const pattern = escapeRegex(term)
      const rows = await Parse.Query.or(
        contactQuery(project, where.length ? { $and: where } : {}).matches('email', pattern, 'i'),
        contactQuery(project, where.length ? { $and: where } : {}).matches('name', pattern, 'i'),
        contactQuery(project, where.length ? { $and: where } : {}).matches('externalId', pattern, 'i')
      ).descending('updatedAt').limit(limit).find(MASTER)
      return { contacts: rows.map(serializeContact), nextCursor: null }
    }
    const rows = await query.limit(limit).find(MASTER)
    const order = new Map(ids.map((id, i) => [id, i]))
    return { contacts: rows.sort((a, b) => (order.get(a.id || '') ?? 0) - (order.get(b.id || '') ?? 0)).map(serializeContact), nextCursor: null }
  }

  const cursor = options.cursor ? readCursor(options.cursor) : null
  if (options.cursor && !cursor) throw createError({ statusCode: 400, statusMessage: 'cursor is not one this API returned' })
  if (cursor) {
    const at = { __type: 'Date', iso: cursor.at.toISOString() }
    where.push({ $or: [{ createdAt: { $lt: at } }, { createdAt: at, objectId: { $lt: cursor.id } }] })
  }
  const rows = await contactQuery(project, where.length ? { $and: where } : {}).descending('createdAt').addDescending('objectId').limit(limit + 1).find(MASTER)
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return { contacts: page.map(serializeContact), nextCursor: rows.length > limit && last ? `${last.createdAt!.toISOString()}|${last.id}` : null }
}

// ---- segments --------------------------------------------------------------------

export function serializeSegment(row: ParseObject): ContactSegment {
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    name: String(row.get('name') || ''),
    filter: validateSegmentFilter(row.get('filter')).filter,
    auto: Boolean(row.get('auto')),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  }
}

export async function getProjectSegment(project: ParseObject, id: string): Promise<ParseObject> {
  const Parse = useParse()
  const row = id ? await new Parse.Query('ContactSegment').equalTo('project', project).equalTo('objectId', id).first(MASTER) : null
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Segment not found' })
  return row
}

export function readSegmentFilter(value: unknown): SegmentFilter {
  const { filter, errors } = validateSegmentFilter(value)
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  return filter
}

/** The `where` for a stored segment, by id. */
export async function segmentWhere(project: ParseObject, segmentId: string): Promise<Record<string, unknown>> {
  return resolveSegmentWhere(project, serializeSegment(await getProjectSegment(project, segmentId)).filter)
}

export async function previewSegment(project: ParseObject, filter: SegmentFilter): Promise<{ count: number, sample: Contact[] }> {
  const where = await resolveSegmentWhere(project, filter)
  const [count, rows] = await Promise.all([
    contactQuery(project, where).count(MASTER),
    contactQuery(project, where).descending('updatedAt').limit(10).find(MASTER)
  ])
  return { count, sample: rows.map(serializeContact) }
}

/** A JSON object body, or a 400: malformed JSON must not quietly become `{}`. */
export async function readObjectBody(event: Parameters<typeof readBody>[0]): Promise<Record<string, unknown>> {
  const body = await readBody(event).catch(() => undefined)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, statusMessage: 'Send a JSON object' })
  return body as Record<string, unknown>
}
