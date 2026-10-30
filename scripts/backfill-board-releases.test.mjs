// bun scripts/backfill-board-releases.test.mjs — self-check for the pure planner.
import assert from 'node:assert/strict'
import { planBoardReleases } from './backfill-board-releases.mjs'

const plan = planBoardReleases({
  legacy: [
    { objectId: 'r1', project: 'p1', title: ' 2.5.0 ' },
    { objectId: 'r2', project: 'p1', title: '2.5.0' },
    { objectId: 'r3', project: 'p1', title: '2.4.0' },
    { objectId: 'r4', project: 'p2', title: '2.5.0' }
  ],
  existing: [{ objectId: 'c9', project: 'p1', version: '2.4.0' }],
  cards: [{ objectId: 'k1', releaseId: 'r1' }, { objectId: 'k2', releaseId: 'r2' }, { objectId: 'k3', releaseId: 'r3' }, { objectId: 'k4', releaseId: 'r4' }, { objectId: 'k5', releaseId: 'c9' }]
})

// Two cards named the same release share one new release; an existing version is reused, not created.
assert.deepEqual(plan.creates.map(c => [c.project, c.version]), [['p1', '2.5.0'], ['p2', '2.5.0']])
assert.deepEqual(plan.moves.map(m => [m.cardId, m.key]), [['k1', 'p1\n2.5.0'], ['k2', 'p1\n2.5.0'], ['k3', 'p1\n2.4.0'], ['k4', 'p2\n2.5.0']])
// A card already on a changelog release is not a move.
assert.ok(!plan.moves.some(m => m.cardId === 'k5'))
console.log('backfill-board-releases: ok')
