// bun scripts/migrate-changelog-public.test.mjs — self-check for the pure planner.
import assert from 'node:assert/strict'
import { planChangelogPublic } from './migrate-changelog-public.mjs'

// A project the board published the changelog for gets its own switch, once.
assert.deepEqual(planChangelogPublic({ feedback: { enabled: true }, changelog: { autoDraft: true } }), { changelogPublicMigrated: true, changelog: { autoDraft: true, enabled: true } })
assert.deepEqual(planChangelogPublic({ feedback: { enabled: true, changelog: true } }), { changelogPublicMigrated: true, changelog: { enabled: true } })
assert.equal(planChangelogPublic({ feedback: { enabled: true }, changelogPublicMigrated: true }), null)

// Projects that were not public are only stamped.
assert.deepEqual(planChangelogPublic({}), { changelogPublicMigrated: true })
assert.deepEqual(planChangelogPublic({ feedback: { enabled: false } }), { changelogPublicMigrated: true })
assert.deepEqual(planChangelogPublic({ feedback: { enabled: true, changelog: false } }), { changelogPublicMigrated: true })
assert.deepEqual(planChangelogPublic({ feedback: { enabled: true }, changelog: { enabled: true } }), { changelogPublicMigrated: true })

console.log('migrate-changelog-public: ok')
