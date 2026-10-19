// Create an agent (an operator login for the admin panel) and put it in a
// workspace. The class CLP is master-only, so this script (or the app) is the
// only way one can be created.
//
//   bun scripts/add-agent.mjs <username> <password> [email] [--workspace=<id>] [--role=owner|admin|agent]
//   AGENT_USER=… AGENT_PASS=… AGENT_EMAIL=… bun scripts/add-agent.mjs
//
// Args take precedence; each falls back to its env var. Without --workspace
// it joins the oldest workspace (an install with one has nothing to choose);
// on a fresh install it creates that first workspace. The role defaults to
// admin, what a teammate added from the panel gets.

import { assertEnv, parseFetch } from './parseRest.mjs'

const flags = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')))
const [argUser, argPass, argEmail] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const username = argUser || process.env.AGENT_USER
const password = argPass || process.env.AGENT_PASS
const email = argEmail || process.env.AGENT_EMAIL
const role = flags.role || 'admin'
if (!username || !password || !['owner', 'admin', 'agent'].includes(role)) {
  console.error('usage: bun scripts/add-agent.mjs <username> <password> [email] [--workspace=<id>] [--role=owner|admin|agent]  (or set AGENT_USER / AGENT_PASS / AGENT_EMAIL)')
  process.exit(1)
}

assertEnv()
const pointer = (className, objectId) => ({ __type: 'Pointer', className, objectId })
const fail = (what, res) => {
  console.error(`${what} failed: ${res.body?.error || res.status}`)
  process.exit(1)
}

let workspaceId = flags.workspace || ''
if (!workspaceId) {
  const found = await parseFetch(`/classes/Workspace?${new URLSearchParams({ order: 'createdAt', limit: '1', keys: 'objectId' })}`)
  workspaceId = found.body?.results?.[0]?.objectId || ''
}

const res = await parseFetch('/users', {
  method: 'POST',
  body: JSON.stringify({ username, password, ...(email ? { email } : {}) })
})
if (!res.ok) fail('create', res)
const userId = res.body.objectId

// Nothing to join yet: this agent starts the first workspace, as its owner.
const firstOwner = !workspaceId
if (firstOwner) {
  const created = await parseFetch('/classes/Workspace', { method: 'POST', body: JSON.stringify({ name: process.env.DEFAULT_WORKSPACE_NAME?.trim() || 'HelpBites', status: 'active', owner: pointer('_User', userId) }) })
  if (!created.ok) fail('create workspace', created)
  workspaceId = created.body.objectId
}
const member = await parseFetch('/classes/WorkspaceMember', {
  method: 'POST',
  body: JSON.stringify({ workspace: pointer('Workspace', workspaceId), user: pointer('_User', userId), role: firstOwner ? 'owner' : role })
})
if (!member.ok) fail('membership', member)
await parseFetch(`/users/${userId}`, { method: 'PUT', body: JSON.stringify({ defaultWorkspace: pointer('Workspace', workspaceId) }) })
console.log(`agent ${username} created (${userId}), ${firstOwner ? 'owner' : role} of workspace ${workspaceId}`)
