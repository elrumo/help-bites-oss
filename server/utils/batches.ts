import { MASTER, type ParseObject, type useParse } from './parse'

// Reading more rows than one query returns. Parse caps every find at its
// maxLimit (the hosted edition sets PARSE_SERVER_MAX_LIMIT=1000) and quietly
// cuts a bigger `limit` down to it, so a read that wants everything pages
// instead: by objectId, ascending, each page starting after the last one's id.
// Never `skip`: it gets slower the deeper it goes, and rows that change
// between pages make it miss or repeat some. Paging by id stays right when
// the caller edits or deletes each page as it comes.

type ParseQuery = InstanceType<ReturnType<typeof useParse>['Query']>

/** The most rows one query asks Parse for. */
export const PARSE_MAX_LIMIT = 1000

/**
 * Hand `fn` every row `makeQuery` matches, `batchSize` at a time (never more
 * than PARSE_MAX_LIMIT). `makeQuery` builds a fresh query per page; its order
 * is replaced by objectId, so sort in memory when order matters. `keys` limits
 * the fields read. Returns how many rows there were.
 */
export async function eachBatch(makeQuery: () => ParseQuery, fn: (rows: ParseObject[]) => unknown, options: { batchSize?: number, keys?: string[] } = {}): Promise<number> {
  const size = Math.min(Math.max(Math.floor(options.batchSize || 500), 1), PARSE_MAX_LIMIT)
  let after = ''
  let total = 0
  for (;;) {
    const query = makeQuery()
    if (after) query.greaterThan('objectId', after)
    if (options.keys) query.select(...options.keys)
    const rows = await query.ascending('objectId').limit(size).find(MASTER)
    total += rows.length
    if (rows.length) await fn(rows)
    after = rows.at(-1)?.id || ''
    if (rows.length < size || !after) return total
  }
}

/**
 * Every row `makeQuery` matches, read in batches, for work that needs them all
 * at once. More than `max` throws rather than quietly working on some of them.
 */
export async function collectAll(makeQuery: () => ParseQuery, options: { max: number, batchSize?: number, keys?: string[] }): Promise<ParseObject[]> {
  const rows: ParseObject[] = []
  await eachBatch(makeQuery, (page) => {
    rows.push(...page)
    if (rows.length > options.max) throw new Error(`Too many ${page[0]!.className} rows to load at once (more than ${options.max})`)
  }, options)
  return rows
}
