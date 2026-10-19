// List every agent (each _User in this Parse) and the workspaces they are in.
// Master-key only, like the app.
//   bun scripts/list-agents.mjs
import { assertEnv, parseFetch } from './parseRest.mjs'

assertEnv()
const res = await parseFetch('/users?limit=1000&order=username&keys=username,email,createdAt')
if (!res.ok) {
  console.error(`failed: ${res.body?.error || res.status}`)
  process.exit(1)
}
const members = await parseFetch(`/classes/WorkspaceMember?${new URLSearchParams({ limit: '10000', include: 'workspace', keys: 'user,role,workspace.name' })}`)
const byUser = new Map()
for (const m of members.body?.results || []) {
  const list = byUser.get(m.user?.objectId) || []
  list.push(`${m.workspace?.name || m.workspace?.objectId} (${m.role})`)
  byUser.set(m.user?.objectId, list)
}
const users = res.body.results || []
for (const u of users) {
  console.log(`${u.objectId}  ${u.username}${u.email ? `  <${u.email}>` : ''}  ${u.createdAt}  ${(byUser.get(u.objectId) || ['no workspace']).join(', ')}`)
}
console.log(`\n${users.length} agent(s)`)
