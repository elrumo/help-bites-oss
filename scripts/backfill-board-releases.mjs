// One-off backfill for boards that planned releases as cards (kind `release`) before a
// release was a changelog release. Planning and the changelog now share one list of releases:
//   - each release card becomes a changelog release of its project (a draft, named by its title),
//     or is matched to the changelog release with that version when one already exists;
//   - the cards that shipped in it (`releaseId`, on tasks and epics) point at that changelog release;
//   - the release card itself is kept as a plain card (kind `task`), so nothing is deleted. Remove it
//     from the board once you have checked the release.
//
//   bun scripts/backfill-board-releases.mjs           # dry run: what would change
//   bun scripts/backfill-board-releases.mjs --apply   # write
//
// Idempotent: a card already pointing at a changelog release, and a version that already has one, are
// left alone; a second run finds no release cards left to convert.

import { CHANGELOG_VERSION_MAX_LENGTH } from '../shared/changelog.ts'
import { assertEnv, parseFetch, env } from './parseRest.mjs'

const APPLY = process.argv.includes('--apply')
const PAGE = 1000

async function findAll(className, where, keys) {
  const out = []
  for (let skip = 0; ; skip += PAGE) {
    const query = new URLSearchParams({ where: JSON.stringify(where), limit: String(PAGE), skip: String(skip), order: 'createdAt', ...(keys ? { keys } : {}) })
    const { ok, status, body } = await parseFetch(`/classes/${className}?${query}`)
    if (!ok) throw new Error(`${className} query failed (${status}): ${JSON.stringify(body)}`)
    out.push(...body.results)
    if (body.results.length < PAGE) return out
  }
}

// Batch paths carry the server's mount path (`/parse` in PARSE_URL).
const mount = () => new URL(env('PARSE_URL')).pathname.replace(/\/+$/, '')

async function batch(requests) {
  for (let i = 0; i < requests.length; i += 50) {
    const { ok, status, body } = await parseFetch('/batch', { method: 'POST', body: JSON.stringify({ requests: requests.slice(i, i + 50) }) })
    if (!ok) throw new Error(`batch failed (${status}): ${JSON.stringify(body)}`)
    const failed = body.filter(r => r.error)
    if (failed.length) throw new Error(`batch had ${failed.length} failures: ${JSON.stringify(failed[0].error)}`)
  }
}

const pointer = (className, objectId) => ({ __type: 'Pointer', className, objectId })
const keyOf = (project, version) => `${project}\n${version.trim().toLowerCase()}`

/**
 * Pure: what to do. `legacy` are the release cards ({ objectId, project, title }), `existing` the
 * project's changelog releases ({ objectId, project, version }), `cards` the items that name a release
 * card ({ objectId, releaseId }). Each release card maps to a key (project and version); a key with no
 * changelog release yet is created once, however many cards share it. Exported for the self-check.
 */
export function planBoardReleases({ legacy, existing, cards }) {
  const known = new Set(existing.map(release => keyOf(release.project, release.version)))
  const creates = new Map()
  const keyByLegacy = new Map()
  for (const item of legacy) {
    const version = String(item.title || '').trim().slice(0, CHANGELOG_VERSION_MAX_LENGTH) || 'Untitled release'
    const key = keyOf(item.project, version)
    keyByLegacy.set(item.objectId, { key, project: item.project, version })
    if (!known.has(key) && !creates.has(key)) creates.set(key, { key, project: item.project, version })
  }
  const moves = cards.filter(card => keyByLegacy.has(card.releaseId)).map(card => ({ cardId: card.objectId, key: keyByLegacy.get(card.releaseId).key }))
  return { creates: [...creates.values()], moves, keyByLegacy }
}

async function main() {
  assertEnv()
  const legacy = await findAll('BoardItem', { kind: 'release' }, 'title,project')
  if (!legacy.length) return console.log('No release cards to convert.')
  const projectIds = [...new Set(legacy.map(item => item.project.objectId))]
  const existing = (await findAll('ChangelogRelease', { project: { $in: projectIds.map(id => pointer('Project', id)) } }, 'version,project'))
    .map(row => ({ objectId: row.objectId, project: row.project.objectId, version: row.version }))
  const cardRows = []
  for (let i = 0; i < legacy.length; i += 100) {
    const ids = legacy.slice(i, i + 100).map(item => item.objectId)
    cardRows.push(...await findAll('BoardItem', { releaseId: { $in: ids } }, 'releaseId'))
  }
  const { creates, moves } = planBoardReleases({
    legacy: legacy.map(item => ({ objectId: item.objectId, project: item.project.objectId, title: item.title })),
    existing,
    cards: cardRows.map(row => ({ objectId: row.objectId, releaseId: row.releaseId }))
  })
  console.log(`${legacy.length} release cards: ${creates.length} changelog releases to create, ${moves.length} cards to point at one.`)
  for (const create of creates) console.log(`  create ${create.version} (${create.project})`)
  if (!APPLY) return console.log('\nDry run. Re-run with --apply to write.')

  const releaseIds = new Map(existing.map(release => [keyOf(release.project, release.version), release.objectId]))
  for (const create of creates) {
    const { ok, body } = await parseFetch('/classes/ChangelogRelease', { method: 'POST', body: JSON.stringify({ project: pointer('Project', create.project), version: create.version, title: '', summary: '', status: 'draft' }) })
    if (!ok) throw new Error(`release failed: ${JSON.stringify(body)}`)
    releaseIds.set(create.key, body.objectId)
  }
  await batch(moves.map(move => ({
    method: 'PUT',
    path: `${mount()}/classes/BoardItem/${move.cardId}`,
    body: { releaseId: releaseIds.get(move.key) }
  })))
  await batch(legacy.map(item => ({ method: 'PUT', path: `${mount()}/classes/BoardItem/${item.objectId}`, body: { kind: 'task' } })))
  console.log(`Done: ${creates.length} releases created, ${moves.length} cards moved, ${legacy.length} release cards kept as tasks.`)
}

if (import.meta.main) await main()
