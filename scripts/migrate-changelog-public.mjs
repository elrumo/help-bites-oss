// Gives every project that published its changelog through the feedback board
// (board live with its Changelog option on) its own switch: changelog.enabled.
// The public changelog no longer follows the board, so without this those
// projects would go dark.
//
// A project is touched once: the first run stamps `changelogPublicMigrated`
// (new projects are created with it), so turning the changelog off later sticks.
//
//   bun scripts/migrate-changelog-public.mjs           # dry run: what would change
//   bun scripts/migrate-changelog-public.mjs --apply   # write (the container does this on boot)

import { assertEnv, parseFetch } from './parseRest.mjs'

const PAGE = 500
const BATCH = 50

/** What a project that has not been migrated needs: the stamp, and `changelog.enabled` if the board was publishing it. */
export function planChangelogPublic(project) {
  if (project.changelogPublicMigrated === true) return null
  const wasPublic = project.feedback?.enabled === true && project.feedback?.changelog !== false
  const changelog = project.changelog && typeof project.changelog === 'object' ? project.changelog : {}
  return { changelogPublicMigrated: true, ...(wasPublic && changelog.enabled !== true ? { changelog: { ...changelog, enabled: true } } : {}) }
}

async function projects() {
  const rows = []
  let after = ''
  for (;;) {
    const where = { changelogPublicMigrated: { $ne: true }, ...(after ? { objectId: { $gt: after } } : {}) }
    const query = new URLSearchParams({ where: JSON.stringify(where), order: 'objectId', limit: String(PAGE), keys: 'feedback,changelog,changelogPublicMigrated,name' })
    const { ok, status, body } = await parseFetch(`/classes/Project?${query}`)
    if (!ok) throw new Error(`Project query failed (${status}): ${JSON.stringify(body)}`)
    rows.push(...(body.results || []))
    if ((body.results || []).length < PAGE) return rows
    after = rows.at(-1).objectId
  }
}

async function main() {
  assertEnv()
  const apply = process.argv.includes('--apply')
  const mount = new URL(process.env.PARSE_URL).pathname.replace(/\/+$/, '')
  const updates = (await projects()).map(row => ({ row, body: planChangelogPublic(row) })).filter(item => item.body)
  const switchedOn = updates.filter(item => item.body.changelog)
  for (const { row } of switchedOn) console.log(`~ ${row.name || row.objectId}: changelog made public on its own`)
  for (let i = 0; apply && i < updates.length; i += BATCH) {
    const requests = updates.slice(i, i + BATCH).map(({ row, body }) => ({ method: 'PUT', path: `${mount}/classes/Project/${row.objectId}`, body }))
    const res = await parseFetch('/batch', { method: 'POST', body: JSON.stringify({ requests }) })
    if (!res.ok) throw new Error(`batch failed (${res.status}): ${JSON.stringify(res.body)}`)
    const failed = (res.body || []).find(item => item.error)
    if (failed) throw new Error(`batch item failed: ${JSON.stringify(failed.error)}`)
  }
  console.log(updates.length ? `${switchedOn.length} project(s) switched on, ${updates.length} stamped.` : 'Changelog switches up to date.')
  if (!apply && updates.length) console.log('\nDry run; re-run with --apply.')
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message || error)
    process.exit(1)
  })
}
