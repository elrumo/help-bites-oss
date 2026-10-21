import { createError, getHeader, getQuery, type H3Event } from 'h3'
import {
  CHANGELOG_LINKS_MAX,
  CHANGELOG_LINK_KINDS,
  CHANGELOG_IMPORT_MAX,
  buildPublicChangelog,
  changelogPrefill,
  changelogReservedSlugs,
  fillChangelogUrl,
  normalizeChangelogConfig,
  readChangelogEntryInput,
  readChangelogImportItem,
  readChangelogMergeInput,
  readChangelogReleaseInput,
  readChangelogReviewInput,
  toPublicEntry,
  type ChangelogBodyFormat,
  type ChangelogConfig,
  type ChangelogEntry,
  type ChangelogEntryStatus,
  type ChangelogEntryValues,
  type ChangelogExternalLink,
  type ChangelogLinkKind,
  type ChangelogRelease,
  type ChangelogReviewStatus,
  type ChangelogSource,
  type ChangelogSourceKind,
  type ChangelogTag,
  type PublicChangelog,
  type PublicChangelogEntry,
  type PublicChangelogPage
} from '#shared/changelog'
import { feedbackStatusCategory, parsePostRef } from '#shared/feedback'
import { deriveChangelogExcerpt, nextChangelogSlug, renderChangelogBody } from './changelogRender'
import { emitDomainEventLater } from './domainEvents'

// The changelog: entries (what shipped, in the project's own words) grouped
// into releases, linked to the feedback posts, board items and conversations
// (tickets, error issues) they answer. Changing it takes a writer (an operator,
// the project secret, or an identity token with `role: "admin"`); the public
// read sends an allow-list of published entries and never a word about their
// sources.

const LINK_FIELDS = { feedback: 'feedbackPostIds', board: 'boardItemIds', conversation: 'conversationIds' } as const satisfies Record<ChangelogLinkKind, string>
const LINK_NOUNS = { feedback: 'posts', board: 'board items', conversation: 'conversations' } as const satisfies Record<ChangelogLinkKind, string>

export function getChangelogConfig(project: ParseObject): ChangelogConfig {
  return normalizeChangelogConfig(project.get('changelog'))
}

/**
 * Whether the project's changelog is public: its own switch (`changelog.enabled`),
 * independent of the feedback board. Projects that were public through the
 * board's Changelog option were switched on by scripts/migrate-changelog-public.mjs.
 */
export function changelogIsPublic(project: ParseObject): boolean {
  return getChangelogConfig(project).enabled
}

function badRequest(errors: string[]): never {
  throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

// ---- who is asking -----------------------------------------------------------

/**
 * Whoever may change the changelog.
 *
 *   an operator       a Parse session or `ak_` key; acts on the project named by `?project=`
 *   the project       its `sk_` secret (a release script, a host's backend); acts on its own project
 *   an admin token    a host-signed identity token with `role: "admin"` (a host's own staff
 *                     in their browser); acts on the project the token was minted for
 */
export type ChangelogWriter = {
  /** Set for the secret and the admin token; null for an operator, who names a project. */
  project: ParseObject | null
  kind: 'agent' | 'secret' | 'user'
  agent?: ParseObject
  /** An operator's workspace: every project they touch must be in it. */
  member?: MemberContext
  /** Shown as the author of what they write. */
  name: string
  source: ChangelogSourceKind
}

function userWriter(project: ParseObject, claims: { name?: string, username?: string }): ChangelogWriter {
  return { project, kind: 'user', name: String(claims.name || claims.username || 'admin').trim().slice(0, 120), source: 'admin' }
}

export async function requireChangelogWriter(event: H3Event): Promise<ChangelogWriter> {
  const token = optionalBearer(event)
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Missing Authorization header' })
  if (token.startsWith('sk_')) return { project: await requireProjectSecret(event), kind: 'secret', name: 'automated', source: 'internal' }
  if (token.startsWith('r:') || token.startsWith('ak_')) {
    const member = await requireMember(event, { can: 'content' })
    const { agent } = member
    return { project: null, kind: 'agent', agent, member, name: String(agent.get('name') || agent.get('username') || ''), source: 'admin' }
  }
  const { project, claims } = await verifyEndUserToken(event, token)
  if (claims.role !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Only admins can change the changelog' })
  return userWriter(project, claims)
}

/** Only an operator or the project secret: the routes that rewrite history in bulk. */
export function requireServerWriter(writer: ChangelogWriter): void {
  if (writer.kind === 'user') throw createError({ statusCode: 403, statusMessage: 'This needs the project secret or an admin API key' })
}

/** The project a request acts on: the writer's own, or the one an operator names with `?project=`. */
export async function changelogWriterProject(event: H3Event, writer: ChangelogWriter): Promise<ParseObject> {
  const named = String(getQuery(event).project || '')
  if (writer.project) {
    if (named && named !== writer.project.id) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
    return writer.project
  }
  if (!named) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=<projectId>' })
  return await requireProject(writer.member!, named)
}

/** A secret or token only reaches its own project's rows; an operator, their workspace's. */
export function assertChangelogProject(writer: ChangelogWriter, project: ParseObject): void {
  if (writer.project && writer.project.id !== project.id) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (writer.member) assertProjectInWorkspace(writer.member, project, 'Not found')
}

export type ChangelogReader = { project: ParseObject, writer: ChangelogWriter | null }

/**
 * Who is reading the public changelog, and which project. Anonymous callers
 * pass `?pk=` (rate limited per IP). A writer reads the same project and may
 * also see its drafts where a route allows it; any other signed-in caller reads
 * as the public. The changelog must be public, except for a writer.
 */
export async function resolveChangelogReader(event: H3Event): Promise<ChangelogReader> {
  const token = optionalBearer(event)
  if (token) {
    if (token.startsWith('sk_') || token.startsWith('r:') || token.startsWith('ak_')) {
      const writer = await requireChangelogWriter(event)
      return { project: await changelogWriterProject(event, writer), writer }
    }
    const { project, claims } = await verifyEndUserToken(event, token)
    const writer = claims.role === 'admin' ? userWriter(project, claims) : null
    if (!writer && !changelogIsPublic(project)) throw createError({ statusCode: 404, statusMessage: 'No changelog here' })
    return { project, writer }
  }
  const pk = String(getQuery(event).pk || getHeader(event, 'x-project-key') || '').trim()
  if (!pk) throw createError({ statusCode: 401, statusMessage: 'Pass ?pk=<public key> or an identity token' })
  const project = await findProjectByPublicKey(pk)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  await rateLimit(`sb:rl:clread:${clientIp(event) || 'ip'}`, LIMITS.changelogReadsPerIp.limit, LIMITS.changelogReadsPerIp.window)
  if (!changelogIsPublic(project)) throw createError({ statusCode: 404, statusMessage: 'No changelog here' })
  return { project, writer: null }
}

// ---- reads ------------------------------------------------------------------

// The panel lists a project's whole changelog at once; past this many it errors rather than quietly losing some.
const CHANGELOG_LIST_MAX = 10_000

/**
 * Newest published first, undated drafts last, newest created breaking ties:
 * the panel's order. Lists are read by id, so they are put in order here.
 */
function newestPublishedFirst(a: ParseObject, b: ParseObject): number {
  const time = (value: unknown) => (value instanceof Date ? value.getTime() : -Infinity)
  const compare = (x: number, y: number) => (x < y ? 1 : x > y ? -1 : 0)
  return compare(time(a.get('publishedAt')), time(b.get('publishedAt'))) || compare(time(a.createdAt), time(b.createdAt))
}

/** Entry `row` is published and in a published release (or none): what the public can see and comment on. */
export async function isChangelogEntryPublic(row: ParseObject): Promise<boolean> {
  if (entryStatus(row) !== 'published') return false
  const releaseId = pointerId(row.get('release'))
  if (!releaseId) return true
  const release = await new (useParse()).Query('ChangelogRelease').get(releaseId, MASTER).catch(() => undefined)
  return release?.get('status') === 'published'
}

/** An entry in a project by any of its names: object id, slug, `#N` / `N`, or the `entry-N` an entry saved before slugs existed answers to. */
export async function findChangelogEntry(project: ParseObject, ref: string): Promise<ParseObject | undefined> {
  const Parse = useParse()
  const name = String(ref || '').trim()
  if (!name) return undefined
  const base = () => new Parse.Query('ChangelogEntry').equalTo('project', project)
  const bySlug = await base().equalTo('slug', name).first(MASTER)
  if (bySlug) return bySlug
  const byId = /^[A-Za-z0-9]{6,40}$/.test(name) ? await base().equalTo('objectId', name).first(MASTER) : undefined
  if (byId) return byId
  const number = parsePostRef(name.replace(/^#/, '').replace(/^entry-/, ''))
  return number ? await base().equalTo('number', number).first(MASTER) : undefined
}

/** An entry by object id, or by slug / number when the caller names the project. */
export async function loadChangelogEntry(ref: string, projectId?: string): Promise<{ project: ParseObject, row: ParseObject }> {
  const Parse = useParse()
  let row: ParseObject | undefined = await new Parse.Query('ChangelogEntry').get(ref, MASTER).catch(() => undefined)
  if (!row && projectId) row = await findChangelogEntry(await loadProjectUnscoped(projectId), ref.replace(/^#/, ''))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
  return { project: await loadProjectUnscoped(pointerId(row.get('project'))), row }
}

/** The entry a route names, for this writer: it must belong to the writer's project. */
export async function loadWriterEntry(event: H3Event, writer: ChangelogWriter, ref: string): Promise<{ project: ParseObject, row: ParseObject }> {
  const found = await loadChangelogEntry(ref, writer.project?.id || String(getQuery(event).project || '') || undefined)
  assertChangelogProject(writer, found.project)
  return found
}

export async function loadChangelogRelease(id: string): Promise<{ project: ParseObject, row: ParseObject }> {
  const row = await new (useParse()).Query('ChangelogRelease').get(id, MASTER).catch(() => undefined)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Release not found' })
  return { project: await loadProjectUnscoped(pointerId(row.get('project'))), row }
}

export async function loadWriterRelease(writer: ChangelogWriter, id: string): Promise<{ project: ParseObject, row: ParseObject }> {
  const found = await loadChangelogRelease(id)
  assertChangelogProject(writer, found.project)
  return found
}

export function serializeChangelogRelease(row: ParseObject): ChangelogRelease {
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    version: String(row.get('version') || ''),
    title: String(row.get('title') || ''),
    summary: String(row.get('summary') || ''),
    status: row.get('status') === 'published' ? 'published' : 'draft',
    publishedAt: iso(row.get('publishedAt')),
    createdAt: iso(row.createdAt) || '',
    updatedAt: iso(row.updatedAt) || ''
  }
}

type EntryFields = Omit<ChangelogEntry, 'sources' | 'version'>

/** The slug an entry answers to: its own, or `entry-N` for one saved before slugs existed. */
export function changelogEntrySlug(row: ParseObject): string {
  const number = typeof row.get('number') === 'number' ? row.get('number') as number : null
  return String(row.get('slug') || (number ? `entry-${number}` : ''))
}

/** Where an entry lives on the project's own site. */
export function changelogEntryUrl(project: ParseObject, row: ParseObject): string {
  return fillChangelogUrl(getChangelogConfig(project).entryUrl, String(project.get('siteUrl') || ''), changelogEntrySlug(row))
}

function entryStatus(row: ParseObject): ChangelogEntryStatus {
  const status = row.get('status')
  return status === 'published' || status === 'archived' ? status : 'draft'
}

/** The fields of an entry that are its own, without its sources and its release's version. */
function entryFields(row: ParseObject): EntryFields {
  const tag = String(row.get('tag') || '')
  const number = typeof row.get('number') === 'number' ? row.get('number') as number : null
  const body = String(row.get('body') || '')
  const bodyFormat: ChangelogBodyFormat = row.get('bodyFormat') === 'html' ? 'html' : 'markdown'
  const source = row.get('source')
  const reviewStatus = row.get('reviewStatus')
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    number,
    // Entries saved before slugs existed answer to `entry-N`; they get a real slug on their next save.
    slug: changelogEntrySlug(row),
    title: String(row.get('title') || ''),
    summary: String(row.get('summary') || ''),
    body,
    bodyFormat,
    // Entries saved before bodies were rendered on write are rendered on read instead.
    bodyHtml: typeof row.get('bodyHtml') === 'string' ? row.get('bodyHtml') : renderChangelogBody(body, bodyFormat),
    excerpt: typeof row.get('excerpt') === 'string' ? row.get('excerpt') : deriveChangelogExcerpt(body, bodyFormat),
    tag: (['new', 'improved', 'fix', 'removed', 'breaking'].includes(tag) ? tag : 'improved') as ChangelogTag,
    area: String(row.get('area') || ''),
    releaseId: pointerId(row.get('release')),
    status: entryStatus(row),
    publishedAt: iso(row.get('publishedAt')),
    pinned: row.get('pinned') === true,
    iconGlyph: String(row.get('iconGlyph') || ''),
    accentColor: String(row.get('accentColor') || ''),
    imageUrl: String(row.get('imageUrl') || ''),
    links: (Array.isArray(row.get('links')) ? row.get('links') : []) as ChangelogExternalLink[],
    feedbackPostIds: stringList(row.get('feedbackPostIds')),
    boardItemIds: stringList(row.get('boardItemIds')),
    conversationIds: stringList(row.get('conversationIds')),
    commitShas: stringList(row.get('commitShas')),
    externalId: String(row.get('externalId') || ''),
    reviewStatus: reviewStatus === 'pending' || reviewStatus === 'approved' || reviewStatus === 'rejected' ? reviewStatus as ChangelogReviewStatus : null,
    reviewedBy: typeof row.get('reviewedBy') === 'string' ? row.get('reviewedBy') : null,
    reviewedAt: iso(row.get('reviewedAt')),
    reviewNotes: typeof row.get('reviewNotes') === 'string' ? row.get('reviewNotes') : null,
    authorName: String(row.get('authorName') || ''),
    source: source === 'admin' || source === 'internal' ? source : null,
    aiGenerated: row.get('aiGenerated') === true,
    commentCount: typeof row.get('commentCount') === 'number' ? row.get('commentCount') as number : 0,
    createdAt: iso(row.createdAt) || '',
    updatedAt: iso(row.updatedAt) || ''
  }
}

/** Versions of the releases these entries belong to, by release id. */
async function releaseVersions(rows: ParseObject[]): Promise<Map<string, string>> {
  const ids = unique(rows.map(row => pointerId(row.get('release'))))
  if (!ids.length) return new Map()
  const releases = await collectAll(() => new (useParse()).Query('ChangelogRelease').containedIn('objectId', ids), { max: ids.length, keys: ['version'] })
  return new Map(releases.map(release => [release.id || '', String(release.get('version') || '')]))
}

/**
 * Serialize a page of entries with their sources resolved in one query per
 * kind. Ids that no longer resolve (the post, item or conversation was
 * deleted) are skipped. Admin only: sources carry internal titles.
 */
export async function serializeChangelogEntries(project: ParseObject, rows: ParseObject[]): Promise<ChangelogEntry[]> {
  const Parse = useParse()
  const postIds = unique(rows.flatMap(row => stringList(row.get('feedbackPostIds'))))
  const itemIds = unique(rows.flatMap(row => stringList(row.get('boardItemIds'))))
  const conversationIds = unique(rows.flatMap(row => stringList(row.get('conversationIds'))))
  // A whole changelog links more sources than one read returns: in batches, never more than were asked for.
  const [postRows, itemRows, conversationRows, versions] = await Promise.all([
    postIds.length ? collectAll(() => new Parse.Query('FeedbackPost').equalTo('project', project).containedIn('objectId', postIds), { max: postIds.length, keys: ['title', 'status', 'number'] }) : [],
    itemIds.length ? collectAll(() => new Parse.Query('BoardItem').equalTo('project', project).containedIn('objectId', itemIds), { max: itemIds.length, keys: ['title', 'status', 'number'] }) : [],
    conversationIds.length ? collectAll(() => new Parse.Query('Conversation').equalTo('project', project).containedIn('objectId', conversationIds), { max: conversationIds.length, keys: ['subject', 'status', 'statusCategory'] }) : [],
    releaseVersions(rows)
  ])
  const feedback = getFeedbackConfig(project)
  const board = getBoardConfig(project)
  const sources = new Map<string, ChangelogSource>()
  const number = (row: ParseObject) => (typeof row.get('number') === 'number' ? row.get('number') as number : null)
  for (const row of postRows) {
    const status = String(row.get('status') || '')
    sources.set(`feedback:${row.id}`, { kind: 'feedback', id: row.id || '', number: number(row), label: String(row.get('title') || ''), status, done: feedbackStatusCategory(feedback, status) === 'done' })
  }
  for (const row of itemRows) {
    const status = String(row.get('status') || '')
    sources.set(`board:${row.id}`, { kind: 'board', id: row.id || '', number: number(row), label: String(row.get('title') || ''), status, done: feedbackStatusCategory(board, status) === 'done' })
  }
  for (const row of conversationRows) {
    const category = String(row.get('statusCategory') || '')
    sources.set(`conversation:${row.id}`, { kind: 'conversation', id: row.id || '', number: null, label: String(row.get('subject') || ''), status: String(row.get('status') || ''), done: category === 'resolved' || category === 'closed' })
  }
  return rows.map((row) => {
    const fields = entryFields(row)
    const linked = [
      ...fields.feedbackPostIds.map(id => sources.get(`feedback:${id}`)),
      ...fields.boardItemIds.map(id => sources.get(`board:${id}`)),
      ...fields.conversationIds.map(id => sources.get(`conversation:${id}`))
    ].filter((source): source is ChangelogSource => Boolean(source))
    return { ...fields, version: versions.get(fields.releaseId) || '', sources: linked }
  })
}

export async function serializeChangelogEntry(project: ParseObject, row: ParseObject): Promise<ChangelogEntry> {
  return (await serializeChangelogEntries(project, [row]))[0]!
}

export type ChangelogEntryFilter = { release?: string, status?: ChangelogEntryStatus, feedbackPost?: string, boardItem?: string, conversation?: string }

/**
 * Every entry of a project, newest first, or those linked to one source / in
 * one release. Archived entries are left out unless `status: 'archived'` asks.
 */
export async function listChangelogEntries(project: ParseObject, filter: ChangelogEntryFilter = {}): Promise<ChangelogEntry[]> {
  const Parse = useParse()
  const rows = await collectAll(() => {
    const query = new Parse.Query('ChangelogEntry').equalTo('project', project)
    if (filter.status) query.equalTo('status', filter.status)
    else query.notEqualTo('status', 'archived')
    if (filter.release === 'none') query.doesNotExist('release')
    else if (filter.release) query.equalTo('release', Parse.Object.extend('ChangelogRelease').createWithoutData(filter.release))
    if (filter.feedbackPost) query.equalTo('feedbackPostIds', filter.feedbackPost)
    if (filter.boardItem) query.equalTo('boardItemIds', filter.boardItem)
    if (filter.conversation) query.equalTo('conversationIds', filter.conversation)
    return query
  }, { max: CHANGELOG_LIST_MAX })
  // Drafts have no date and come last (the panel groups them).
  return serializeChangelogEntries(project, rows.sort(newestPublishedFirst))
}

export async function listChangelogReleases(project: ParseObject): Promise<ChangelogRelease[]> {
  const rows = await collectAll(() => new (useParse()).Query('ChangelogRelease').equalTo('project', project), { max: CHANGELOG_LIST_MAX })
  return rows.sort(newestPublishedFirst).map(serializeChangelogRelease)
}

/**
 * The public changelog: published entries, under their published release.
 * Nothing about sources goes out (see `buildPublicChangelog`).
 * ponytail: one page — the 200 newest releases and 1000 newest entries; page it when a changelog outgrows that.
 */
export async function listPublicChangelog(project: ParseObject): Promise<PublicChangelog> {
  const Parse = useParse()
  const [releaseRows, entryRows] = await Promise.all([
    new Parse.Query('ChangelogRelease').equalTo('project', project).equalTo('status', 'published').descending('publishedAt').limit(200).find(MASTER),
    new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo('status', 'published').descending('publishedAt').addDescending('number').limit(1000).find(MASTER)
  ])
  return buildPublicChangelog(releaseRows.map(serializeChangelogRelease), entryRows.map(row => ({ ...entryFields(row) })))
}

export type PublicEntryQuery = { limit: number, skip: number, tag?: ChangelogTag, area?: string, version?: string, since?: Date }

/**
 * Published entries as one flat, paged list, newest first, each with its
 * release's version. An entry counts only when its release, if any, is
 * published too — the same rule as `listPublicChangelog`, applied in the query
 * so paging and the total are exact.
 */
export async function listPublicChangelogEntries(project: ParseObject, query: PublicEntryQuery): Promise<PublicChangelogPage> {
  const Parse = useParse()
  const releases = await new Parse.Query('ChangelogRelease').equalTo('project', project).equalTo('status', 'published').limit(1000).find(MASTER)
  const versionById = new Map(releases.map(release => [release.id || '', String(release.get('version') || '')]))
  const inVersion = query.version === undefined ? null : releases.filter(release => release.get('version') === query.version)

  const scoped = () => {
    const q = new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo('status', 'published')
    if (query.tag) q.equalTo('tag', query.tag)
    if (query.area) q.equalTo('area', query.area)
    if (query.since) q.greaterThan('publishedAt', query.since)
    return q
  }
  const visible = inVersion
    ? scoped().containedIn('release', inVersion)
    : Parse.Query.or(scoped().doesNotExist('release'), scoped().containedIn('release', releases))
  const [total, rows] = await Promise.all([
    visible.count(MASTER),
    visible.descending('publishedAt').addDescending('number').skip(query.skip).limit(query.limit).find(MASTER)
  ])
  return {
    entries: rows.map((row) => { const fields = entryFields(row); return toPublicEntry(fields, versionById.get(fields.releaseId) || '') }),
    total,
    hasMore: query.skip + rows.length < total
  }
}

/**
 * One entry for the public (published, in a published release), or, with
 * `preview`, for a writer: a draft too, in the admin shape. Archived never.
 */
export async function getChangelogEntryForReader(project: ParseObject, ref: string, preview: boolean): Promise<PublicChangelogEntry | ChangelogEntry | null> {
  const row = await findChangelogEntry(project, ref)
  if (!row || entryStatus(row) === 'archived') return null
  if (preview) return await serializeChangelogEntry(project, row)
  const fields = entryFields(row)
  if (fields.status !== 'published') return null
  if (fields.releaseId) {
    const release = await new (useParse()).Query('ChangelogRelease').get(fields.releaseId, MASTER).catch(() => undefined)
    if (!release || release.get('status') !== 'published') return null
    return toPublicEntry(fields, String(release.get('version') || ''))
  }
  return toPublicEntry(fields)
}

// ---- writes: entries --------------------------------------------------------

type LinkTarget = { kind: ChangelogLinkKind, id: string, row: ParseObject }

async function findBoardItem(project: ParseObject, id: string): Promise<ParseObject | undefined> {
  const Parse = useParse()
  const byId = await new Parse.Query('BoardItem').equalTo('project', project).equalTo('objectId', id).first(MASTER)
  if (byId) return byId
  const number = parsePostRef(id)
  return number ? await new Parse.Query('BoardItem').equalTo('project', project).equalTo('number', number).first(MASTER) : undefined
}

/** A post or board item (by id or `#N`) or a conversation in this project; 404 for anything else. */
async function resolveLinkTarget(project: ParseObject, kind: ChangelogLinkKind, rawId: string): Promise<LinkTarget> {
  const id = String(rawId || '').trim().replace(/^#/, '')
  if (kind === 'feedback') {
    const post = id ? await findFeedbackPost(project, id) : undefined
    if (!post) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
    return { kind, id: post.id || '', row: post }
  }
  if (kind === 'board') {
    const item = id ? await findBoardItem(project, id) : undefined
    if (!item) throw createError({ statusCode: 404, statusMessage: 'Board item not found' })
    return { kind, id: item.id || '', row: item }
  }
  const conversation = id ? await getConversation(id) : null
  if (!conversation || pointerId(conversation.get('project')) !== project.id) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  return { kind, id: conversation.id || '', row: conversation }
}

function readLinkKind(value: unknown): ChangelogLinkKind {
  if ((CHANGELOG_LINK_KINDS as readonly string[]).includes(String(value))) return value as ChangelogLinkKind
  badRequest([`kind must be one of ${CHANGELOG_LINK_KINDS.join(', ')}`])
}

function readIdList(value: unknown, kind: ChangelogLinkKind): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) badRequest([`${LINK_FIELDS[kind]} must be an array`])
  const ids = unique(value.map(v => String(v ?? '').trim()))
  if (ids.length > CHANGELOG_LINKS_MAX) badRequest([`An entry links at most ${CHANGELOG_LINKS_MAX} ${LINK_NOUNS[kind]}`])
  return ids
}

/** The release row for an id, which must belong to the project. */
async function resolveRelease(project: ParseObject, releaseId: string): Promise<ParseObject> {
  const row = await new (useParse()).Query('ChangelogRelease').equalTo('project', project).equalTo('objectId', releaseId).first(MASTER)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Release not found' })
  return row
}

/**
 * The release of this version, or a new one already published (dated `date`).
 * For callers that think in versions, not release objects: a release script, an
 * import. An existing release keeps its own status.
 * ponytail: two requests creating the same new version at once can make two releases.
 */
async function resolveReleaseByVersion(project: ParseObject, version: string, date: Date): Promise<ParseObject> {
  const Parse = useParse()
  const found = await new Parse.Query('ChangelogRelease').equalTo('project', project).equalTo('version', version).first(MASTER)
  if (found) return found
  const row = new (Parse.Object.extend('ChangelogRelease'))() as ParseObject
  row.set('project', project)
  row.set('version', version)
  row.set('title', '')
  row.set('summary', '')
  row.set('status', 'published')
  row.set('publishedAt', date)
  await row.save(null, MASTER)
  return row
}

/** Add or remove one link with $addToSet / $pull, so two operators linking at once both land. */
async function applyLink(row: ParseObject, target: LinkTarget, linked: boolean, agent?: ParseObject): Promise<void> {
  const field = LINK_FIELDS[target.kind]
  const ids = stringList(row.get(field))
  if (linked === ids.includes(target.id)) return
  if (linked && ids.length >= CHANGELOG_LINKS_MAX) badRequest([`An entry links at most ${CHANGELOG_LINKS_MAX} ${LINK_NOUNS[target.kind]}`])
  if (linked) row.addUnique(field, target.id)
  else row.remove(field, target.id)
  await row.save(null, MASTER)
  if (target.kind === 'conversation') {
    await appendEvent(target.row, { type: linked ? 'changelog.linked' : 'changelog.unlinked', entryId: row.id || '', number: row.get('number') ?? null, title: String(row.get('title') || '') }, agent)
  }
}

function setRelease(row: ParseObject, release: ParseObject | null): void {
  if (release) row.set('release', release)
  else row.unset('release')
}

async function slugTaken(project: ParseObject, slug: string, exceptId?: string): Promise<boolean> {
  const query = new (useParse()).Query('ChangelogEntry').equalTo('project', project).equalTo('slug', slug)
  if (exceptId) query.notEqualTo('objectId', exceptId)
  return Boolean(await query.first(MASTER))
}

/** An area the project does not list is refused; a project listing none takes any. */
function checkArea(config: ChangelogConfig, area: string | undefined): void {
  if (area && config.areas.length && !config.areas.includes(area)) badRequest([`area must be one of ${config.areas.join(', ')}`])
}

/**
 * Set everything an entry's own fields say, from a create/update/import body:
 * text (rendered once, here), taxonomy, look, slug, release, status and date.
 * Only the keys present change. A new entry's slug comes from its title unless
 * one was asked for; an entry that has none yet gets one the first time it is saved.
 */
/** A publish the notification sweep should hear about: stamped once, and never for an entry already notified. */
function stampPublish(row: ParseObject, wasPublished: boolean): void {
  if (!wasPublished && entryStatus(row) === 'published' && !row.get('notifiedAt')) row.set('notifyPendingSince', new Date())
}

/**
 * Tell the bus an entry is public (`changelog.entry.published`), which is what
 * mails the followers of the posts it answers. Called after the save that made
 * it public; an entry still held back by a draft release is announced when that
 * release publishes. Fire and forget: the publish never waits on the mail, and
 * the handler's own at-most-once claim makes announcing twice harmless.
 */
async function announcePublished(project: ParseObject, rows: ParseObject[]): Promise<void> {
  for (const row of rows) {
    if (!(await isChangelogEntryPublic(row))) continue
    emitDomainEventLater(project, 'changelog.entry.published', {
      entryId: row.id || '',
      number: typeof row.get('number') === 'number' ? row.get('number') : null,
      releaseId: pointerId(row.get('release')) || null,
      publishedAt: iso(row.get('publishedAt')),
      feedbackPostIds: stringList(row.get('feedbackPostIds')),
      boardItemIds: stringList(row.get('boardItemIds')),
      conversationIds: stringList(row.get('conversationIds'))
    })
  }
}

async function applyEntryValues(project: ParseObject, row: ParseObject, values: ChangelogEntryValues, config: ChangelogConfig, options: { notify?: boolean } = {}): Promise<void> {
  const wasPublished = entryStatus(row) === 'published'
  checkArea(config, values.area)
  for (const key of ['title', 'summary', 'tag', 'area', 'pinned', 'iconGlyph', 'accentColor', 'imageUrl', 'links', 'commitShas'] as const) {
    if (values[key] !== undefined) row.set(key, values[key])
  }

  if (values.slug !== undefined || !row.get('slug')) {
    const reserved = changelogReservedSlugs(config)
    const base = values.slug ?? String(row.get('title') || values.title || '')
    row.set('slug', await nextChangelogSlug(base, slug => slugTaken(project, slug, row.id), reserved))
  }

  // The rendered HTML is derived: recompute whenever either input to it changes, or it was never made.
  if (values.body !== undefined || values.bodyFormat !== undefined || typeof row.get('bodyHtml') !== 'string') {
    const body = values.body ?? String(row.get('body') || '')
    const format: ChangelogBodyFormat = values.bodyFormat ?? (row.get('bodyFormat') === 'html' ? 'html' : 'markdown')
    row.set('body', body)
    row.set('bodyFormat', format)
    row.set('bodyHtml', renderChangelogBody(body, format))
    row.set('excerpt', deriveChangelogExcerpt(body, format))
  }

  if (values.status !== undefined) row.set('status', values.status)
  if (values.publishedAt === null) row.unset('publishedAt')
  else if (values.publishedAt) row.set('publishedAt', values.publishedAt)
  if (row.get('status') === 'published' && !row.get('publishedAt')) row.set('publishedAt', new Date())
  if (options.notify !== false) stampPublish(row, wasPublished)

  if (values.releaseId !== undefined) setRelease(row, values.releaseId ? await resolveRelease(project, values.releaseId) : null)
  else if (values.releaseVersion) setRelease(row, await resolveReleaseByVersion(project, values.releaseVersion, (row.get('publishedAt') as Date | undefined) || new Date()))
}

/** `ai`: written by a model from git commits (marked on the entry; one published straight away is logged as auto-published). */
type Author = { name: string, source: ChangelogSourceKind, ai?: boolean }

function authorOf(agent: ParseObject | undefined): Author {
  return agent ? { name: String(agent.get('name') || agent.get('username') || ''), source: 'admin' } : { name: 'automated', source: 'internal' }
}

/**
 * Create an entry: a draft unless `status: "published"`. Optional
 * `feedbackPostIds` (ids or `#N`), `boardItemIds` and `conversationIds` link it
 * on creation; every one must belong to the project, and a bad one fails the
 * request before anything is written. `author` is who wrote it (default: the
 * agent, else the automated caller).
 */
export async function createChangelogEntry(project: ParseObject, agent: ParseObject | undefined, payload: unknown, author: Author = authorOf(agent), options: { announce?: boolean } = {}): Promise<ParseObject> {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const { values, errors } = readChangelogEntryInput(raw, { create: true })
  if (errors.length) badRequest(errors)
  const targets: LinkTarget[] = []
  for (const kind of CHANGELOG_LINK_KINDS) {
    for (const id of readIdList(raw[LINK_FIELDS[kind]], kind)) targets.push(await resolveLinkTarget(project, kind, id))
  }

  const row = new (useParse().Object.extend('ChangelogEntry'))() as ParseObject
  row.set('project', project)
  row.set('feedbackPostIds', [])
  row.set('boardItemIds', [])
  row.set('conversationIds', [])
  row.set('commitShas', [])
  row.set('commentCount', 0)
  row.set('authorName', author.name)
  row.set('source', author.source)
  if (author.ai) row.set('aiGenerated', true)
  // A draft starts out waiting for review; an entry published straight away never was (an AI one says so).
  if (values.status === 'draft') row.set('reviewStatus', 'pending')
  else if (author.ai && values.status === 'published') {
    row.set('reviewStatus', 'approved')
    row.set('reviewedBy', 'Auto-publish')
    row.set('reviewedAt', new Date())
  }
  await applyEntryValues(project, row, values, getChangelogConfig(project))
  row.set('number', await allocateProjectNumber(project, 'changelogSeq', 'ChangelogEntry'))
  await row.save(null, MASTER)
  for (const target of targets) await applyLink(row, target, true, agent)
  // After the links: the event carries them.
  if (options.announce !== false && entryStatus(row) === 'published') await announcePublished(project, [row])
  return row
}

export const CHANGELOG_BATCH_MAX = 50

export type ChangelogBatchResult = {
  created: ParseObject[]
  /** Entries left out because a commit they cite is already cited by entry `entryId`. */
  skipped: { index: number, commitSha: string, entryId: string }[]
  failed: { index: number, message: string }[]
}

/** Which of these commits an entry of the project (an archived one too) already cites, and which entry. */
export async function citedCommitShas(project: ParseObject, shas: string[]): Promise<Map<string, string>> {
  const known = new Map<string, string>()
  if (!shas.length) return known
  const rows = await new (useParse()).Query('ChangelogEntry').equalTo('project', project).containedIn('commitShas', shas).select('commitShas').limit(1000).find(MASTER)
  for (const row of rows) for (const sha of stringList(row.get('commitShas'))) if (!known.has(sha)) known.set(sha, row.id || '')
  return known
}

function shasOf(item: unknown): string[] {
  return item && typeof item === 'object' ? stringList((item as Record<string, unknown>).commitShas).map(sha => sha.trim().toLowerCase()) : []
}

/**
 * Create up to 50 entries (`{ entries: [...] }`, each as `createChangelogEntry`
 * takes it), idempotent for the ones that cite `commitShas`: an entry is
 * skipped when any of its commits is already cited by an entry of the project
 * (an archived one too), so re-sending a batch (a retry, a re-run of the CLI)
 * never writes it twice. The known commits are read once, before anything is
 * created, so several entries of one batch may cite the same commit. Entries
 * are created one by one and are not transactional; one failing does not stop
 * the rest.
 * ponytail: two batches racing can both pass the check (Parse cannot make an array element unique); lock per project if that ever happens.
 */
export async function createChangelogEntries(project: ParseObject, agent: ParseObject | undefined, payload: unknown, author: Author = authorOf(agent)): Promise<ChangelogBatchResult> {
  const items = (payload && typeof payload === 'object' ? (payload as Record<string, unknown>).entries : undefined)
  if (!Array.isArray(items) || !items.length || items.length > CHANGELOG_BATCH_MAX) badRequest([`entries must be an array of 1 to ${CHANGELOG_BATCH_MAX} entries`])

  const known = await citedCommitShas(project, unique(items.flatMap(shasOf)))

  const result: ChangelogBatchResult = { created: [], skipped: [], failed: [] }
  for (const [index, item] of items.entries()) {
    const cited = shasOf(item).find(sha => known.has(sha))
    if (cited) {
      result.skipped.push({ index, commitSha: cited, entryId: known.get(cited)! })
      continue
    }
    try {
      result.created.push(await createChangelogEntry(project, agent, item, author))
    } catch (error) {
      result.failed.push({ index, message: String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Could not create the entry') })
    }
  }
  return result
}

/** Edit an entry. The first time it is published it gets `publishedAt` (admins may set it); unpublishing keeps it. */
export async function updateChangelogEntry(project: ParseObject, row: ParseObject, payload: unknown): Promise<ParseObject> {
  const { values, errors } = readChangelogEntryInput(payload, { create: false })
  if (errors.length) badRequest(errors)
  const wasPublished = entryStatus(row) === 'published'
  await applyEntryValues(project, row, values, getChangelogConfig(project))
  await row.save(null, MASTER)
  if (!wasPublished && entryStatus(row) === 'published') await announcePublished(project, [row])
  return row
}

export async function deleteChangelogEntry(row: ParseObject): Promise<void> {
  await row.destroy(MASTER)
}

/**
 * Approve (publish) or reject a draft. Only drafts are reviewed. Approving
 * never overwrites a date the entry already wears (a backfilled draft keeps its
 * commit date); rejecting leaves it a draft, marked, for its author to revise.
 */
export async function reviewChangelogEntry(row: ParseObject, writer: ChangelogWriter, payload: unknown): Promise<ParseObject> {
  const { action, notes, errors } = readChangelogReviewInput(payload)
  if (errors.length) badRequest(errors)
  if (entryStatus(row) !== 'draft') badRequest(['Only draft entries can be reviewed'])
  row.set('reviewedBy', writer.name)
  row.set('reviewedAt', new Date())
  row.set('reviewNotes', notes || null)
  if (action === 'approve') {
    row.set('status', 'published')
    row.set('reviewStatus', 'approved')
    if (!row.get('publishedAt')) row.set('publishedAt', new Date())
    stampPublish(row, false)
  } else {
    row.set('reviewStatus', 'rejected')
  }
  await row.save(null, MASTER)
  if (action === 'approve') await announcePublished(await loadProjectUnscoped(pointerId(row.get('project'))), [row])
  return row
}

export type ChangelogImportResult = {
  results: { index: number, id: string, externalId: string, slug: string, created: boolean }[]
  failed: { index: number, message: string }[]
}

/**
 * Bring entries over from another system (up to 100): each is created, or
 * updated when an entry with its `externalId` exists, so re-running converges.
 * It keeps the slug and the `publishedAt` it is given and the review trail the
 * entry already has, and it never drafts, links or tells anyone. Entries are
 * handled one by one and are not transactional; one failing does not stop the rest.
 */
export async function importChangelogEntries(project: ParseObject, writer: ChangelogWriter, payload: unknown): Promise<ChangelogImportResult> {
  const items = (payload && typeof payload === 'object' ? (payload as Record<string, unknown>).entries : undefined)
  if (!Array.isArray(items) || !items.length || items.length > CHANGELOG_IMPORT_MAX) badRequest([`entries must be an array of 1 to ${CHANGELOG_IMPORT_MAX} entries`])
  const Parse = useParse()
  const config = getChangelogConfig(project)
  const result: ChangelogImportResult = { results: [], failed: [] }

  for (const [index, item] of items.entries()) {
    try {
      const { externalId, values, errors } = readChangelogImportItem(item)
      if (errors.length) badRequest(errors)
      const existing = await new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo('externalId', externalId).first(MASTER)
      const row = existing || new (Parse.Object.extend('ChangelogEntry'))() as ParseObject
      if (!existing) {
        if (!values.title) badRequest(['A title is required'])
        row.set('project', project)
        row.set('externalId', externalId)
        for (const field of ['feedbackPostIds', 'boardItemIds', 'conversationIds', 'commitShas'] as const) row.set(field, [])
        row.set('commentCount', 0)
        row.set('tag', 'improved')
        row.set('status', 'draft')
      }
      const { reviewStatus, reviewedBy, reviewedAt, reviewNotes, authorName, source, notifiedAt, ...entry } = values
      await applyEntryValues(project, row, entry, config, { notify: false })
      // History is not news: an imported published entry never goes to subscribers (unless it says when it did).
      if (notifiedAt !== undefined) notifiedAt === null ? row.unset('notifiedAt') : row.set('notifiedAt', notifiedAt)
      else if (!existing && entryStatus(row) === 'published') row.set('notifiedAt', new Date())
      // Nor are the followers of what it answers: the release it joins may publish later.
      if (!existing && entryStatus(row) === 'published') row.set('followersNotifiedAt', new Date())
      if (reviewStatus !== undefined) reviewStatus === null ? row.unset('reviewStatus') : row.set('reviewStatus', reviewStatus)
      if (reviewedBy !== undefined) row.set('reviewedBy', reviewedBy)
      if (reviewedAt !== undefined) reviewedAt === null ? row.unset('reviewedAt') : row.set('reviewedAt', reviewedAt)
      if (reviewNotes !== undefined) row.set('reviewNotes', reviewNotes)
      if (!existing || authorName !== undefined) row.set('authorName', authorName ?? writer.name)
      if (!existing || source !== undefined) row.set('source', source ?? writer.source)
      if (!existing) row.set('number', await allocateProjectNumber(project, 'changelogSeq', 'ChangelogEntry'))
      await row.save(null, MASTER)
      result.results.push({ index, id: row.id || '', externalId, slug: String(row.get('slug') || ''), created: !existing })
    } catch (error) {
      result.failed.push({ index, message: String((error as { statusMessage?: string }).statusMessage || (error as Error).message || 'Could not import the entry') })
    }
  }
  return result
}

/**
 * Fold 2 to 10 entries into one: create `entry` (as `createChangelogEntry` takes
 * it), then archive the sources. The merged entry also cites every commit the
 * sources did (so none is written up again) and links what they linked. Not
 * transactional: the merged entry exists before the first source is archived.
 */
export async function mergeChangelogEntries(project: ParseObject, writer: ChangelogWriter, payload: unknown): Promise<{ entry: ParseObject, archived: ParseObject[] }> {
  const { refs, entry, errors } = readChangelogMergeInput(payload)
  if (errors.length) badRequest(errors)
  const sources: ParseObject[] = []
  for (const ref of refs) {
    const row = await findChangelogEntry(project, ref)
    if (!row) throw createError({ statusCode: 404, statusMessage: `Entry not found: ${ref}` })
    if (entryStatus(row) === 'archived') badRequest([`Entry ${ref} is archived`])
    sources.push(row)
  }

  const shas = unique([...stringList(entry.commitShas), ...sources.flatMap(row => stringList(row.get('commitShas')))]).slice(0, 50)
  const merged = await createChangelogEntry(project, writer.agent, { ...entry, commitShas: shas }, { name: writer.name, source: writer.source }, { announce: false })
  for (const field of Object.values(LINK_FIELDS)) {
    const ids = unique([...stringList(merged.get(field)), ...sources.flatMap(row => stringList(row.get(field)))]).slice(0, CHANGELOG_LINKS_MAX)
    if (ids.length) merged.set(field, ids)
  }
  // Followers of what the sources linked were mailed when those went public: the merge is not news to them.
  const publishedSources = sources.filter(row => entryStatus(row) === 'published')
  if (publishedSources.length && publishedSources.every(row => row.get('followersNotifiedAt'))) merged.set('followersNotifiedAt', new Date())
  await merged.save(null, MASTER)
  // Announced only now, with everything the sources linked.
  if (entryStatus(merged) === 'published') await announcePublished(project, [merged])

  for (const row of sources) row.set('status', 'archived')
  await useParse().Object.saveAll(sources, MASTER)
  return { entry: merged, archived: sources }
}

/** Link or unlink one source (`id` or `#N`). Linking a conversation notes it on its timeline. */
export async function linkChangelogEntry(project: ParseObject, agent: ParseObject | undefined, row: ParseObject, kind: ChangelogLinkKind, id: string, linked: boolean): Promise<ParseObject> {
  let target: LinkTarget
  try {
    target = await resolveLinkTarget(project, kind, id)
  } catch (error) {
    // Unlinking something deleted since: drop the stale id as stored.
    const field = LINK_FIELDS[kind]
    if (linked || !stringList(row.get(field)).includes(id)) throw error
    row.remove(field, id)
    await row.save(null, MASTER)
    return await new (useParse()).Query('ChangelogEntry').get(row.id || '', MASTER)
  }
  await applyLink(row, target, linked, agent)
  // Re-read after the atomic op, so the response carries the stored arrays.
  return await new (useParse()).Query('ChangelogEntry').get(row.id || '', MASTER)
}

/** The body of POST …/links: `{ kind, id, linked }`. */
export function readChangelogLinkInput(payload: unknown): { kind: ChangelogLinkKind, id: string, linked: boolean } {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const kind = readLinkKind(raw.kind)
  const id = String(raw.id ?? '').trim()
  if (!id) badRequest(['id is required'])
  return { kind, id, linked: raw.linked !== false }
}

// ---- writes: releases -------------------------------------------------------

export async function createChangelogRelease(project: ParseObject, payload: unknown): Promise<ParseObject> {
  const { values, errors } = readChangelogReleaseInput(payload, { create: true })
  if (errors.length) badRequest(errors)
  const row = new (useParse().Object.extend('ChangelogRelease'))() as ParseObject
  row.set('project', project)
  row.set('version', values.version)
  row.set('title', values.title ?? '')
  row.set('summary', values.summary ?? '')
  row.set('status', values.status)
  const publishedAt = values.publishedAt ?? (values.status === 'published' ? new Date() : null)
  if (publishedAt) row.set('publishedAt', publishedAt)
  await row.save(null, MASTER)
  return row
}

export async function updateChangelogRelease(row: ParseObject, payload: unknown): Promise<ParseObject> {
  const { values, errors } = readChangelogReleaseInput(payload, { create: false })
  if (errors.length) badRequest(errors)
  for (const key of ['version', 'title', 'summary', 'status'] as const) {
    if (values[key] !== undefined) row.set(key, values[key])
  }
  if (values.publishedAt === null) row.unset('publishedAt')
  else if (values.publishedAt) row.set('publishedAt', values.publishedAt)
  if (row.get('status') === 'published' && !row.get('publishedAt')) row.set('publishedAt', new Date())
  await row.save(null, MASTER)
  return row
}

/**
 * Publish a release and every entry still a draft in it, dated with the
 * release. An entry an operator unpublished again afterwards stays that way.
 */
export async function publishChangelogRelease(project: ParseObject, row: ParseObject): Promise<ParseObject> {
  const Parse = useParse()
  const publishedAt = (row.get('publishedAt') as Date | undefined) || new Date()
  row.set('status', 'published')
  row.set('publishedAt', publishedAt)
  await row.save(null, MASTER)
  const drafts = await new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo('release', row).equalTo('status', 'draft').limit(1000).find(MASTER)
  for (const entry of drafts) {
    entry.set('status', 'published')
    if (!entry.get('publishedAt')) entry.set('publishedAt', publishedAt)
    stampPublish(entry, false)
  }
  if (drafts.length) await Parse.Object.saveAll(drafts, MASTER)
  await stampShippedIn(project, row)
  // Every published entry of the release is public now: the drafts just published, and those published
  // earlier while the release was a draft. Followers already told (`followersNotifiedAt`) are not told again.
  const shipped = await new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo('release', row).equalTo('status', 'published').doesNotExist('followersNotifiedAt').limit(1000).find(MASTER)
  await announcePublished(project, shipped)
  return row
}

/**
 * The posts behind a release's published entries learn which version shipped
 * them (`shippedIn`). Written straight to the rows: no status change, no event,
 * no email.
 */
async function stampShippedIn(project: ParseObject, release: ParseObject): Promise<void> {
  const Parse = useParse()
  const version = String(release.get('version') || '')
  const entries = await new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo('release', release).equalTo('status', 'published').select('feedbackPostIds').limit(1000).find(MASTER)
  const ids = unique(entries.flatMap(entry => stringList(entry.get('feedbackPostIds'))))
  if (!ids.length) return
  await eachBatch(() => new Parse.Query('FeedbackPost').equalTo('project', project).containedIn('objectId', ids), async (rows) => {
    const posts = rows.filter(post => post.get('shippedIn') !== version)
    for (const post of posts) post.set('shippedIn', version)
    if (posts.length) await Parse.Object.saveAll(posts, MASTER)
  }, { keys: ['shippedIn'] })
}

/** Delete a release. Its entries stay, as entries of no release. */
export async function deleteChangelogRelease(project: ParseObject, row: ParseObject): Promise<void> {
  const Parse = useParse()
  const entries = await new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo('release', row).limit(1000).find(MASTER)
  for (const entry of entries) entry.unset('release')
  if (entries.length) await Parse.Object.saveAll(entries, MASTER)
  await row.destroy(MASTER)
}

// ---- drafting from a source -------------------------------------------------

/**
 * With the project's `autoDraft` on, a feedback post or board item that has
 * just reached a done status gets a *draft* entry, unless an entry already
 * links it. The draft starts with only what is already public (see
 * `changelogPrefill`) and is never published for you. A board item brings along
 * the posts linked to it that no entry has yet. Tickets and error issues are
 * never drafted automatically. Returns the new entry, or null when nothing was drafted.
 */
export async function draftChangelogFor(project: ParseObject, kind: 'feedback' | 'board', row: ParseObject, agent?: ParseObject): Promise<ParseObject | null> {
  if (!getChangelogConfig(project).autoDraft) return null
  const Parse = useParse()
  const field = LINK_FIELDS[kind]
  if (await new Parse.Query('ChangelogEntry').equalTo('project', project).equalTo(field, row.id).first(MASTER)) return null

  const prefill = changelogPrefill(kind, kind === 'feedback'
    ? { title: row.get('title'), body: row.get('body'), type: row.get('type'), changelogTitle: row.get('changelogTitle'), changelogBody: row.get('changelogBody') }
    : { title: row.get('title'), publicDescription: row.get('publicDescription') })
  const payload: Record<string, unknown> = { title: (prefill.title || 'Update').slice(0, 200), body: prefill.body, tag: prefill.tag, status: 'draft', [field]: [row.id] }

  if (kind === 'board') {
    const postIds = stringList(row.get('feedbackPostIds'))
    if (postIds.length) {
      const taken = new Set((await new Parse.Query('ChangelogEntry').equalTo('project', project).containedIn('feedbackPostIds', postIds).select('feedbackPostIds').limit(1000).find(MASTER)).flatMap(entry => stringList(entry.get('feedbackPostIds'))))
      payload.feedbackPostIds = postIds.filter(id => !taken.has(id)).slice(0, CHANGELOG_LINKS_MAX)
    }
  }
  return await createChangelogEntry(project, agent, payload)
}
