// Set a new password and/or email on an existing agent, by username.
// Master key hashes the password, same as a normal user update.
//   bun scripts/set-agent.mjs <username> password=NEW email=NEW@example.com
// Pass whichever of password= / email= you want to change (at least one).

import { assertEnv, parseFetch } from './parseRest.mjs'

const [username, ...rest] = process.argv.slice(2)
const patch = {}
for (const arg of rest) {
  const eq = arg.indexOf('=')
  const key = eq === -1 ? arg : arg.slice(0, eq)
  const value = eq === -1 ? '' : arg.slice(eq + 1)
  if (key === 'password' || key === 'email') patch[key] = value
}
if (!username || !patch.password && !patch.email) {
  console.error('usage: bun scripts/set-agent.mjs <username> [password=NEW] [email=NEW@example.com]')
  process.exit(1)
}

assertEnv()
const found = await parseFetch(`/users?limit=1&where=${encodeURIComponent(JSON.stringify({ username }))}`)
const user = found.body?.results?.[0]
if (!user) {
  console.error(`no agent with username "${username}"`)
  process.exit(1)
}
const res = await parseFetch(`/users/${user.objectId}`, { method: 'PUT', body: JSON.stringify(patch) })
if (!res.ok) {
  console.error(`failed: ${res.body?.error || res.status}`)
  process.exit(1)
}
console.log(`agent ${username} updated (${Object.keys(patch).join(', ')})`)
