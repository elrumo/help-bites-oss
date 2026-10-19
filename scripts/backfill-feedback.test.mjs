// bun scripts/backfill-feedback.test.mjs — self-check for the pure planners.
import assert from 'node:assert/strict'
import { planFollows, planNumbers } from './backfill-feedback.mjs'

const at = iso => ({ iso })
assert.deepEqual(
  planNumbers([{ objectId: 'b', postedAt: at('2024-02-01') }, { objectId: 'a', postedAt: at('2024-01-01') }, { objectId: 'n', number: 7 }]),
  [{ id: 'a', number: 8 }, { id: 'b', number: 9 }],
  'unnumbered posts follow the highest number, oldest first'
)
assert.deepEqual(planNumbers([{ objectId: 'n', number: 1 }]), [], 'numbered posts are left alone')

const post = (objectId, authorExternalId) => ({ objectId, authorExternalId })
const ref = objectId => ({ objectId })
assert.deepEqual(
  planFollows(
    [post('p1', 'u1'), post('p2', '')],
    [{ post: ref('p1'), authorExternalId: 'u2' }, { post: ref('p1'), authorExternalId: 'u1' }, { post: ref('p2'), authorExternalId: 'u3', visibility: 'internal' }],
    [{ post: ref('p1'), subscriberId: 'u2' }]
  ),
  [{ postId: 'p1', subscriberId: 'u1' }],
  'authors and public commenters follow; existing follows and team notes are skipped'
)
console.log('✓ backfill-feedback planners')
