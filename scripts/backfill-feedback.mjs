// One-off backfill for boards that existed before post numbers and follows:
//   - numbers every unnumbered post, oldest first, after the board's highest
//     number, and moves the project's counter past them;
//   - makes each post's author and public commenters follow it, so status and
//     comment emails keep reaching the people they reached before.
//
//   bun scripts/backfill-feedback.mjs           # dry run: what would change
//   bun scripts/backfill-feedback.mjs --apply   # write
//
// Idempotent: numbered posts and existing follows are left alone. Run it once
// after deploying, before anyone posts (a post made in between simply takes
// the next number; nothing collides).

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
const time = post => new Date(post.postedAt?.iso || post.createdAt).getTime()

/** Pure: which posts get which numbers. Exported for the self-check. */
export function planNumbers(posts) {
  let next = Math.max(0, ...posts.map(p => Number(p.number) || 0))
  return posts.filter(p => !p.number).sort((a, b) => time(a) - time(b)).map(p => ({ id: p.objectId, number: ++next }))
}

/** Pure: author + public commenters per post, minus the follows that exist. */
export function planFollows(posts, comments, subscriptions) {
  const have = new Set(subscriptions.map(s => `${s.post.objectId}:${s.subscriberId}`))
  const want = new Map()
  const add = (postId, id) => {
    if (!id || have.has(`${postId}:${id}`)) return
    if (!want.has(postId)) want.set(postId, new Set())
    want.get(postId).add(id)
  }
  for (const post of posts) add(post.objectId, post.authorExternalId)
  for (const comment of comments) if (!comment.visibility || comment.visibility === 'public') add(comment.post.objectId, comment.authorExternalId)
  return [...want].flatMap(([postId, ids]) => [...ids].map(subscriberId => ({ postId, subscriberId })))
}

async function main() {
  assertEnv()
  const projects = await findAll('Project', {}, 'name,feedbackPostSeq')
  for (const project of projects) {
    const where = { project: pointer('Project', project.objectId) }
    const posts = await findAll('FeedbackPost', where, 'number,postedAt,authorExternalId')
    if (!posts.length) continue
    const [comments, subscriptions] = await Promise.all([
      findAll('FeedbackComment', where, 'post,authorExternalId,visibility'),
      findAll('FeedbackSubscription', where, 'post,subscriberId')
    ])
    const numbers = planNumbers(posts)
    const follows = planFollows(posts, comments, subscriptions)
    const top = Math.max(0, ...posts.map(p => Number(p.number) || 0), ...numbers.map(n => n.number))
    console.log(`${project.name || project.objectId}: ${posts.length} posts, ${numbers.length} to number, ${follows.length} follows to add, counter ${project.feedbackPostSeq || 0} → ${Math.max(top, project.feedbackPostSeq || 0)}`)
    if (!APPLY) continue

    await batch(numbers.map(({ id, number }) => ({ method: 'PUT', path: `${mount()}/classes/FeedbackPost/${id}`, body: { number } })))
    const now = { __type: 'Date', iso: new Date().toISOString() }
    await batch(follows.map(({ postId, subscriberId }) => ({ method: 'POST', path: `${mount()}/classes/FeedbackSubscription`, body: { project: pointer('Project', project.objectId), post: pointer('FeedbackPost', postId), subscriberId, muted: false, lastReadAt: now } })))
    if (top > (project.feedbackPostSeq || 0)) {
      const { ok, body } = await parseFetch(`/classes/Project/${project.objectId}`, { method: 'PUT', body: JSON.stringify({ feedbackPostSeq: top }) })
      if (!ok) throw new Error(`counter update failed: ${JSON.stringify(body)}`)
    }
  }
  if (!APPLY) console.log('\nDry run. Re-run with --apply to write.')
}

if (import.meta.main) await main()
