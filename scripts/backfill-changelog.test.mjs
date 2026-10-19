// bun scripts/backfill-changelog.test.mjs — self-check for the pure planner.
import assert from 'node:assert/strict'
import { planChangelog } from './backfill-changelog.mjs'

const post = (objectId, fields = {}) => ({ objectId, title: `Post ${objectId}`, body: '', type: 'feature', status: 'done', showOnChangelog: true, createdAt: '2026-01-01T00:00:00.000Z', ...fields })
const done = iso => ({ iso })
const plan = (posts, extra = {}) => planChangelog({ posts, doneKeys: new Set(['done']), linked: new Set(), versions: new Set(), after: 0, ...extra })

const out = plan([
  post('b', { completedAt: done('2026-03-01T00:00:00.000Z'), changelogTitle: 'CSV export', changelogBody: 'Export as CSV', shippedIn: ' 2.4 ' }),
  post('a', { completedAt: done('2026-02-01T00:00:00.000Z'), type: 'bug', title: 'Crash on save', body: 'It crashes', shippedIn: '2.4' }),
  post('c', { completedAt: done('2026-04-01T00:00:00.000Z'), type: 'other' })
])
assert.deepEqual(out.entries.map(e => [e.postId, e.number]), [['a', 1], ['b', 2], ['c', 3]], 'oldest first, numbered after the highest')
assert.deepEqual(out.entries.map(e => e.tag), ['fix', 'new', 'improved'], 'tag from the post type')
assert.equal(out.entries[1].title, 'CSV export', 'the changelog title wins')
assert.equal(out.entries[1].body, 'Export as CSV')
assert.equal(out.entries[0].body, 'It crashes', 'the post text stands in without changelog text')
assert.deepEqual(out.releases, [{ version: '2.4', publishedAt: '2026-03-01T00:00:00.000Z' }], 'one release per shared version, dated with its newest entry')
assert.equal(out.entries[2].version, '', 'no shippedIn, no release')

assert.deepEqual(plan([post('a', { hidden: true }), post('b', { showOnChangelog: false }), post('c', { status: 'open' })]).entries, [], 'hidden, unmarked and not-done posts stay out')
assert.deepEqual(plan([post('a')], { linked: new Set(['a']) }).entries, [], 'a post already in an entry is left alone')
assert.deepEqual(plan([post('a', { shippedIn: '2.4' })], { versions: new Set(['2.4']) }).releases, [], 'an existing release is reused, not duplicated')
assert.equal(plan([post('a')], { after: 9 }).entries[0].number, 10, 'numbers continue after the highest in use')
assert.equal(plan([post('a', { title: '' })]).entries[0].title, 'Update', 'an untitled post still gets a title')
console.log('✓ backfill-changelog planner')
