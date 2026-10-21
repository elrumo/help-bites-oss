import { compileSegmentFilter, segmentRelationsNeeded, type RelationField, type RelationIds, type SegmentFilter } from '#shared/segments'
import { collectAll } from './batches'
import { errorConfigOf, errorLinksOf, latestErrorEvent, listIssues, type ErrorIssue } from './errorTracking'
import { pointerId, useParse, type ParseObject } from './parse'
import { useRedis } from './redis'

// The segment fields that are answered by looking at a person's other
// records: an open conversation, a vote, an error, a finished onboarding. Each
// resolver returns the ids of this project's contacts it is true for; the
// segment compiles them into an `objectId` clause (shared/segments.ts). Capped
// so a huge project cannot build an unbounded `$in`: past the cap the query
// fails loudly instead of quietly matching a part.

export const RELATION_CAP = 20_000

const chunks = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size))

async function endUserIdsByExternalId(project: ParseObject, externalIds: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const part of chunks([...new Set(externalIds.filter(Boolean))], 500)) {
    const rows = await collectAll(() => new (useParse()).Query('EndUser').equalTo('project', project).containedIn('externalId', part), { max: RELATION_CAP, keys: ['objectId'] })
    ids.push(...rows.map(r => r.id || ''))
  }
  return ids.filter(Boolean)
}

/** Contacts with a conversation that is still open or waiting, and not archived. */
export async function contactsWithOpenConversation(project: ParseObject): Promise<string[]> {
  const rows = await collectAll(() => new (useParse()).Query('Conversation').equalTo('project', project).containedIn('statusCategory', ['open', 'pending']).doesNotExist('archivedAt'), { max: RELATION_CAP, keys: ['endUser'] })
  return [...new Set(rows.map(r => pointerId(r.get('endUser'))).filter(Boolean))]
}

/** Contacts who voted on at least one feedback post. Votes name the voter by their external id. */
export async function contactsWhoVoted(project: ParseObject): Promise<string[]> {
  const votes = await collectAll(() => new (useParse()).Query('FeedbackVote').equalTo('project', project), { max: RELATION_CAP, keys: ['voterId'] })
  return endUserIdsByExternalId(project, votes.map(v => String(v.get('voterId') || '')))
}

/** Contacts who finished a published onboarding flow (skipping does not count). */
export async function contactsWhoFinishedOnboarding(project: ParseObject): Promise<string[]> {
  const rows = await collectAll(() => new (useParse()).Query('OnboardingCompletion').equalTo('project', project).equalTo('outcome', 'completed'), { max: RELATION_CAP, keys: ['endUser'] })
  return [...new Set(rows.map(r => pointerId(r.get('endUser'))).filter(Boolean))]
}

// ---- errors ------------------------------------------------------------------------

/** The user id an error event was reported for (Sentry-style `user.id`), wherever the tracker puts it. */
export function errorEventUserId(event: unknown): string {
  const e = (event && typeof event === 'object' ? event : {}) as Record<string, any>
  const id = e.user?.id ?? e.context?.user?.id ?? e.contexts?.user?.id ?? e.data?.user?.id ?? e.entries?.find?.((x: any) => x?.type === 'user')?.data?.id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : ''
}

const ERRORS_CACHE_SECONDS = 600
const ERRORS_ISSUES = 50

/**
 * External ids of the people hit by the project's open errors: the latest
 * event of each of its newest unresolved issues, in every connected tracker.
 * Best effort and cached for ten minutes, because every issue is one call to
 * the tracker: an error older than the newest 50 open issues is not seen.
 */
export async function errorUserExternalIds(project: ParseObject): Promise<string[]> {
  if (!errorLinksOf(project).length || !errorConfigOf(project).dsn) return []
  const key = `sb:errusers:${project.id}`
  try {
    const cached = await useRedis().get(key)
    if (cached) return JSON.parse(cached) as string[]
  } catch {}
  const { issues } = await listIssues(project, { status: 'unresolved', limit: ERRORS_ISSUES })
  const found = new Set<string>()
  for (const part of chunks(issues.slice(0, ERRORS_ISSUES) as ErrorIssue[], 10)) {
    await Promise.all(part.map(async (issue) => {
      try {
        const id = errorEventUserId(await latestErrorEvent(project, issue.provider, issue.id, issue.linkId))
        if (id) found.add(id)
      } catch {}
    }))
  }
  const ids = [...found]
  try { await useRedis().set(key, JSON.stringify(ids), 'EX', ERRORS_CACHE_SECONDS) } catch {}
  return ids
}

export async function contactsWithErrors(project: ParseObject): Promise<string[]> {
  return endUserIdsByExternalId(project, await errorUserExternalIds(project))
}

const RESOLVERS: Record<RelationField, (project: ParseObject) => Promise<string[]>> = {
  hasOpenConversation: contactsWithOpenConversation,
  votedOnPost: contactsWhoVoted,
  finishedOnboarding: contactsWhoFinishedOnboarding,
  hasErrors: contactsWithErrors
}

/** Look up every relation a filter uses. */
export async function resolveRelations(project: ParseObject, filter: SegmentFilter): Promise<RelationIds> {
  const out: RelationIds = {}
  await Promise.all(segmentRelationsNeeded(filter).map(async (field) => { out[field] = await RESOLVERS[field](project) }))
  return out
}

/** A segment as a Parse `where`, with its relation fields looked up for this project. */
export async function resolveSegmentWhere(project: ParseObject, filter: SegmentFilter): Promise<Record<string, unknown>> {
  return compileSegmentFilter(filter, new Date(), await resolveRelations(project, filter))
}
