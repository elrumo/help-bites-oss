import { CHANGELOG_TAGS, isChangelogTag, type ChangelogTag } from '#shared/changelog'

defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'getChangelog', security: [{}, { EndUserToken: [] }],
    summary: 'The public changelog',
    description: 'Published entries. By default grouped under their published releases (newest first), plus the published entries that belong to no release. Send any of `flat`, `limit`, `skip`, `tag`, `area`, `version` or `since` for one flat, paged list instead, newest first, each entry carrying its release’s `version`. An entry in a release that is still a draft is not public, nor is a draft or an archived entry; what an entry was made from is never returned. Public: pass the project public key as `?pk=` (or `X-Project-Key`). 404 unless the project’s changelog is public (`changelog.enabled`, or the feedback board live with its Changelog option on).',
    parameters: [
      { name: 'pk', in: 'query', schema: { type: 'string' }, description: 'Project public key' },
      { name: 'flat', in: 'query', schema: { type: 'boolean' }, description: 'One flat list instead of releases' },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      { name: 'skip', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
      { name: 'tag', in: 'query', schema: { type: 'string', enum: ['new', 'improved', 'fix', 'removed', 'breaking'] } },
      { name: 'area', in: 'query', schema: { type: 'string' } },
      { name: 'version', in: 'query', schema: { type: 'string' }, description: 'Only entries of the release with this version' },
      { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Only entries published after this' }
    ],
    responses: {
      200: { description: 'The changelog: `PublicChangelog`, or `{ entries, total, hasMore }` for a flat list.', content: { 'application/json': { schema: { oneOf: [{ '$ref': '#/components/schemas/PublicChangelog' }, { '$ref': '#/components/schemas/PublicChangelogPage' }] } } } },
      400: { description: 'An invalid `tag`, `since` or number.' },
      404: { description: 'Unknown project, or no public changelog.' }
    }
  }
})

const FLAT_PARAMS = ['flat', 'limit', 'skip', 'tag', 'area', 'version', 'since']

export default defineEventHandler(async (event) => {
  const { project, writer } = await resolveChangelogReader(event)
  // A signed-in caller's response is never shared; an anonymous one may be for a minute.
  setHeader(event, 'Cache-Control', optionalBearer(event) || writer ? 'no-store' : 'public, max-age=60')

  const query = getQuery(event)
  if (!FLAT_PARAMS.some(key => query[key] !== undefined)) return await listPublicChangelog(project)

  const errors: string[] = []
  const whole = (raw: unknown, label: string, fallback: number, min: number, max: number) => {
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${label} must be a whole number from ${min} to ${max}`); return fallback }
    return n
  }
  const limit = whole(query.limit, 'limit', 50, 1, 100)
  const skip = whole(query.skip, 'skip', 0, 0, 100_000)
  if (query.tag !== undefined && !isChangelogTag(query.tag)) errors.push(`tag must be one of ${CHANGELOG_TAGS.join(', ')}`)
  const since = query.since === undefined ? undefined : new Date(String(query.since))
  if (since && Number.isNaN(since.getTime())) errors.push('since is not a valid date')
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })

  return await listPublicChangelogEntries(project, {
    limit,
    skip,
    tag: query.tag === undefined ? undefined : query.tag as ChangelogTag,
    area: query.area === undefined ? undefined : String(query.area).toLowerCase(),
    version: query.version === undefined ? undefined : String(query.version),
    since
  })
})
