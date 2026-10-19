// Creates the app's own Meilisearch API key and prints it: the app's indexes
// only, and only the actions the app, ensure-search.mjs and reindex.mjs use.
// Meili is publicly reachable in production, so the app should carry this key
// instead of the master key, which can mint keys and delete every index.
//
//   bun scripts/meili-key.mjs        # needs MEILI_URL and MEILI_MASTER_KEY
//
// Idempotent. Meili derives a key's value from its uid and the master key, so
// a fixed uid prints the same key on every run. A key whose indexes or actions
// differ from the lists below is recreated, keeping its value.

import { env } from './parseRest.mjs'

const UID = 'b1b6b71a-c556-4060-8b36-2e7e84f51e67'
const INDEXES = ['knowledge', 'conversations', 'endusers']
// Every Meili call in server/utils/meili.ts, ensure-search.mjs and reindex.mjs.
// Not `experimental.update`: vectorStore is stable since Meili 1.13, so the
// PATCH /experimental-features they still send is refused and ignored.
const ACTIONS = [
  'search',
  'documents.add',
  'documents.delete',
  'indexes.create',
  'settings.update',
  'tasks.get'
]

async function meili(path, method = 'GET', body) {
  const res = await fetch(`${env('MEILI_URL').replace(/\/+$/, '')}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('MEILI_MASTER_KEY')}` },
    body: body ? JSON.stringify(body) : undefined
  })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) }
}

const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && b.every(v => a.includes(v))
const failure = res => res.body?.message || `HTTP ${res.status}`

async function main() {
  let res = await meili(`/keys/${UID}`)
  if (!res.ok && res.status !== 404) throw new Error(`Could not read the key: ${failure(res)}`)

  if (res.ok && !(sameSet(res.body.indexes, INDEXES) && sameSet(res.body.actions, ACTIONS))) {
    // A key's indexes and actions cannot be edited; recreated with the same uid, it keeps its value.
    const removed = await meili(`/keys/${UID}`, 'DELETE')
    if (!removed.ok) throw new Error(`Could not replace the key: ${failure(removed)}`)
    res = { ok: false }
    console.log('~ key out of date, recreating')
  }

  if (!res.ok) {
    res = await meili('/keys', 'POST', {
      uid: UID,
      name: 'help-bites app',
      description: 'The help-bites app container. Managed by scripts/meili-key.mjs.',
      indexes: INDEXES,
      actions: ACTIONS,
      expiresAt: null
    })
    if (!res.ok) throw new Error(`Could not create the key: ${failure(res)}`)
    console.log('+ key created')
  }

  console.log(`\nMEILI_API_KEY=${res.body.key}\n`)
  console.log(`Indexes: ${INDEXES.join(', ')}`)
  console.log(`Actions: ${ACTIONS.join(', ')}\n`)
  console.log('Next:')
  console.log('  1. Set MEILI_API_KEY (above) in the app\'s environment.')
  console.log('  2. Remove MEILI_MASTER_KEY from the app\'s environment; only sb-meili needs it.')
  console.log('  3. Restart the app. Until then it warns that it is using the master key.')
}

main().catch((error) => { console.error(error.message || error); process.exit(1) })
