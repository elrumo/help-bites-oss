// One-off backfill for changelogs that lived on feedback posts (`showOnChangelog`,
// `changelogTitle`, `changelogBody`, `shippedIn`) before changelog entries had
// their own class:
//   - every done, visible post marked for the changelog becomes a *published*
//     entry linked to it (title and text as the changelog showed them, dated
//     with the post's `completedAt`);
//   - posts that share a `shippedIn` get a published release of that version.
//
//   bun scripts/backfill-changelog.mjs           # dry run: what would change
//   bun scripts/backfill-changelog.mjs --apply   # write
//
// Idempotent: a post already linked from an entry, and a version that already
// has a release, are left alone. Posts are not changed. Run it once after
// deploying, before the public changelog is read from entries — until then it
// shows nothing for these projects.

import { changelogPrefill } from '../shared/changelog.ts'
import { feedbackStatusCategory, normalizeFeedbackConfig } from '../shared/feedback.ts'
import { assertEnv, env, parseFetch } from './parseRest.mjs'

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
const date = iso => ({ __type: 'Date', iso })
const doneAt = post => post.completedAt?.iso || post.createdAt

/**
 * Pure: the entries and releases to create. `doneKeys` are the feedback
 * statuses in the done category; `linked` the post ids an entry already links;
 * `versions` the versions that already have a release; `after` the highest
 * entry number in use. Exported for the self-check.
 */
export function planChangelog({ posts, doneKeys, linked, versions, after }) {
  const wanted = posts
    .filter(post => post.showOnChangelog === true && post.hidden !== true && doneKeys.has(post.status) && !linked.has(post.objectId))
    .sort((a, b) => doneAt(a).localeCompare(doneAt(b)))
  let next = after
  const entries = wanted.map((post) => {
    const prefill = changelogPrefill('feedback', post)
    return {
      postId: post.objectId,
      number: ++next,
      title: (prefill.title || 'Update').slice(0, 200),
      body: prefill.body,
      tag: prefill.tag,
      version: String(post.shippedIn || '').trim(),
      publishedAt: doneAt(post)
    }
  })
  // A release is dated with its newest entry.
  const newest = new Map()
  for (const entry of entries) if (entry.version && entry.publishedAt >= (newest.get(entry.version) || '')) newest.set(entry.version, entry.publishedAt)
  const releases = [...newest].filter(([version]) => !versions.has(version)).map(([version, publishedAt]) => ({ version, publishedAt }))
  return { entries, releases }
}

async function main() {
  assertEnv()
  const projects = await findAll('Project', {}, 'name,feedback,changelogSeq')
  for (const project of projects) {
    const where = { project: pointer('Project', project.objectId) }
    const posts = await findAll('FeedbackPost', { ...where, showOnChangelog: true }, 'title,body,type,status,hidden,showOnChangelog,changelogTitle,changelogBody,shippedIn,completedAt')
    if (!posts.length) continue
    const config = normalizeFeedbackConfig(project.feedback)
    const doneKeys = new Set(config.statuses.filter(s => feedbackStatusCategory(config, s.key) === 'done').map(s => s.key))
    const [entryRows, releaseRows] = await Promise.all([
      findAll('ChangelogEntry', where, 'number,feedbackPostIds'),
      findAll('ChangelogRelease', where, 'version')
    ])
    const releaseIds = new Map(releaseRows.map(r => [r.version, r.objectId]))
    const after = Math.max(0, Number(project.changelogSeq) || 0, ...entryRows.map(r => Number(r.number) || 0))
    const { entries, releases } = planChangelog({
      posts,
      doneKeys,
      linked: new Set(entryRows.flatMap(r => r.feedbackPostIds || [])),
      versions: new Set(releaseIds.keys()),
      after
    })
    console.log(`${project.name || project.objectId}: ${posts.length} marked posts, ${entries.length} entries and ${releases.length} releases to create, counter ${project.changelogSeq || 0} → ${Math.max(after, ...entries.map(e => e.number))}`)
    if (!APPLY || !entries.length) continue

    for (const release of releases) {
      const { ok, body } = await parseFetch('/classes/ChangelogRelease', { method: 'POST', body: JSON.stringify({ ...where, version: release.version, title: '', summary: '', status: 'published', publishedAt: date(release.publishedAt) }) })
      if (!ok) throw new Error(`release failed: ${JSON.stringify(body)}`)
      releaseIds.set(release.version, body.objectId)
    }
    await batch(entries.map(entry => ({
      method: 'POST',
      path: `${mount()}/classes/ChangelogEntry`,
      body: {
        ...where,
        number: entry.number,
        title: entry.title,
        body: entry.body,
        tag: entry.tag,
        status: 'published',
        publishedAt: date(entry.publishedAt),
        ...(entry.version && releaseIds.has(entry.version) ? { release: pointer('ChangelogRelease', releaseIds.get(entry.version)) } : {}),
        feedbackPostIds: [entry.postId],
        boardItemIds: [],
        conversationIds: []
      }
    })))
    const top = Math.max(...entries.map(e => e.number))
    const { ok, body } = await parseFetch(`/classes/Project/${project.objectId}`, { method: 'PUT', body: JSON.stringify({ changelogSeq: Math.max(top, Number(project.changelogSeq) || 0) }) })
    if (!ok) throw new Error(`counter update failed: ${JSON.stringify(body)}`)
  }
  if (!APPLY) console.log('\nDry run. Re-run with --apply to write.')
}

if (import.meta.main) await main()
