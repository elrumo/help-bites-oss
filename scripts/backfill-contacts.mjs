// One-off backfill for EndUser rows from before the CRM:
//   - lowercases `email`, so lookups by address (sign-ups, imports, syncs,
//     identity tokens adopting an email-only contact) are exact;
//   - sets `subscription: 'none'` where it is missing, so segments and
//     audiences see everyone;
//   - fills `origin` (how they were added: an app user, a sync, an import…)
//     from what the row says, for contacts from before it was kept, so the
//     people list and segments can filter by it.
// Nobody is subscribed by it: marketing consent only comes from the person.
//
//   bun scripts/backfill-contacts.mjs           # dry run: what would change
//   bun scripts/backfill-contacts.mjs --apply   # write
//
// Idempotent. Pages by objectId, so it is safe while the app keeps writing.

import { guessContactOrigin } from '../shared/contacts.ts'
import { assertEnv, env, parseFetch } from './parseRest.mjs'

const APPLY = process.argv.includes('--apply')
const PAGE = 500

export function contactFix(row) {
  const fix = {}
  const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : ''
  if (email && email !== row.email) fix.email = email
  if (!row.subscription) fix.subscription = 'none'
  if (!row.origin) {
    const origin = guessContactOrigin(row)
    if (origin) fix.origin = { ...origin, at: row.createdAt || null }
  }
  return Object.keys(fix).length ? fix : null
}

async function main() {
  assertEnv()
  const mount = new URL(env('PARSE_URL')).pathname.replace(/\/+$/, '')
  let after = ''
  let seen = 0
  let changed = 0
  for (;;) {
    const where = after ? { objectId: { $gt: after } } : {}
    const query = new URLSearchParams({ where: JSON.stringify(where), order: 'objectId', limit: String(PAGE), keys: 'objectId,email,subscription,origin,externalId,sources,consent,leadForms,anonymous,createdAt' })
    const { ok, status, body } = await parseFetch(`/classes/EndUser?${query}`)
    if (!ok) throw new Error(`EndUser query failed (${status}): ${JSON.stringify(body)}`)
    const rows = body.results || []
    seen += rows.length
    const requests = rows.flatMap((row) => {
      const fix = contactFix(row)
      return fix ? [{ method: 'PUT', path: `${mount}/classes/EndUser/${row.objectId}`, body: fix }] : []
    })
    changed += requests.length
    for (let i = 0; APPLY && i < requests.length; i += 50) {
      const res = await parseFetch('/batch', { method: 'POST', body: JSON.stringify({ requests: requests.slice(i, i + 50) }) })
      if (!res.ok) throw new Error(`batch failed (${res.status}): ${JSON.stringify(res.body)}`)
    }
    if (rows.length < PAGE) break
    after = rows.at(-1).objectId
  }
  console.log(`${seen} contacts, ${changed} ${APPLY ? 'updated' : 'to update (dry run; pass --apply)'}`)
}

if (import.meta.main) await main()
