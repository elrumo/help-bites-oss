// Moves an install from before workspaces into them, and keeps it there.
//
// An install that has data but no workspace gets one ("HelpBites", or
// DEFAULT_WORKSPACE_NAME): its oldest operator becomes the owner and every
// other operator an admin, which is the power they all had before. Every
// project, API key and project-less row (master templates, shared
// components, folders, assistants, knowledge models) lands in it, and the
// install-wide error-tracker settings become the workspace's.
//
// On later boots it only heals: a row that should name a workspace but does
// not takes its project's, or the oldest workspace's. In the community
// edition an operator with no workspace (made with an old add-agent) joins
// the oldest as an admin; the hosted edition never adopts anyone.
//
//   bun scripts/migrate-workspaces.mjs           # dry run: what would change
//   bun scripts/migrate-workspaces.mjs --apply   # write (the container does this on boot)
//
// Idempotent: a second run plans nothing.

import { assertEnv, env, parseFetch } from './parseRest.mjs'

const PAGE = 500
const BATCH = 50

// Rows that name their workspace themselves: project-less ones can't borrow a project's.
export const WORKSPACE_CLASSES = ['Project', 'AdminApiKey', 'KnowledgeModel', 'SupportAgent', 'EmailTemplate', 'EmailFolder', 'EmailComponent']

const pointer = (className, objectId) => ({ __type: 'Pointer', className, objectId })
const idOf = value => (value && typeof value === 'object' ? value.objectId : '') || ''

/** Whether this install needs its first workspace: it has data but none. */
export function needsDefaultWorkspace({ workspaceCount, userCount, projectCount }) {
  return workspaceCount === 0 && (userCount > 0 || projectCount > 0)
}

/**
 * Memberships for operators that have none. On the first run everyone joins
 * (the oldest as owner); later, only the community edition adopts them.
 */
export function planMemberships({ users, memberUserIds, workspaceId, firstRun, adoptOrphans }) {
  const members = new Set(memberUserIds)
  const sorted = [...users].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  const creates = []
  const defaults = []
  for (const [i, user] of sorted.entries()) {
    if (!members.has(user.objectId) && (firstRun || adoptOrphans)) {
      creates.push({ workspace: pointer('Workspace', workspaceId), user: pointer('_User', user.objectId), role: firstRun && i === 0 ? 'owner' : 'admin' })
      members.add(user.objectId)
    }
    if (!idOf(user.defaultWorkspace) && members.has(user.objectId)) defaults.push(user.objectId)
  }
  return { creates, defaults }
}

/**
 * The workspace a row without one belongs to: its project's, else its
 * operator's (API keys), else the oldest workspace.
 */
export function workspaceForRow(row, { projectWorkspace, userWorkspace, fallbackId }) {
  const viaProject = projectWorkspace.get(idOf(row.project))
  if (viaProject) return viaProject
  const viaAgent = userWorkspace.get(idOf(row.agent))
  if (viaAgent) return viaAgent
  return fallbackId
}

/** Project-less mail a workspace sent (not the system's own) belongs to it. */
export function emailLogNeedsWorkspace(row) {
  return !idOf(row.project) && !idOf(row.workspace) && row.source !== 'system'
}

async function list(className, where, keys) {
  const rows = []
  let after = ''
  for (;;) {
    const query = new URLSearchParams({ where: JSON.stringify(after ? { ...where, objectId: { $gt: after } } : where), order: 'objectId', limit: String(PAGE), ...(keys ? { keys } : {}) })
    const { ok, status, body } = await parseFetch(`/classes/${className}?${query}`)
    if (!ok) throw new Error(`${className} query failed (${status}): ${JSON.stringify(body)}`)
    rows.push(...(body.results || []))
    if ((body.results || []).length < PAGE) return rows
    after = rows.at(-1).objectId
  }
}

async function count(className, where = {}) {
  const query = new URLSearchParams({ where: JSON.stringify(where), count: '1', limit: '0' })
  const { ok, status, body } = await parseFetch(`/classes/${className}?${query}`)
  if (!ok) throw new Error(`${className} count failed (${status}): ${JSON.stringify(body)}`)
  return body.count || 0
}

async function batch(requests, apply) {
  for (let i = 0; apply && i < requests.length; i += BATCH) {
    const res = await parseFetch('/batch', { method: 'POST', body: JSON.stringify({ requests: requests.slice(i, i + BATCH) }) })
    if (!res.ok) throw new Error(`batch failed (${res.status}): ${JSON.stringify(res.body)}`)
    const failed = (res.body || []).find(item => item.error)
    if (failed) throw new Error(`batch item failed: ${JSON.stringify(failed.error)}`)
  }
}

async function main() {
  assertEnv()
  const apply = process.argv.includes('--apply')
  const mount = new URL(env('PARSE_URL')).pathname.replace(/\/+$/, '')
  const cloud = process.env.HELPBITES_EDITION === 'cloud'
  const log = []

  let workspaces = await list('Workspace', {}, 'objectId,createdAt')
  const users = await list('_User', {}, 'objectId,createdAt,defaultWorkspace')
  const firstRun = needsDefaultWorkspace({ workspaceCount: workspaces.length, userCount: users.length, projectCount: await count('Project') })
  if (!workspaces.length && !firstRun) {
    console.log('Fresh install: nothing to migrate (the first sign-up creates the workspace).')
    return
  }

  if (firstRun) {
    const oldest = [...users].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0]
    const config = await parseFetch('/config')
    const errorTrackers = config.ok ? config.body?.params?.errorTrackers : null
    const body = { name: process.env.DEFAULT_WORKSPACE_NAME?.trim() || 'HelpBites', status: 'active', ...(oldest ? { owner: pointer('_User', oldest.objectId) } : {}), ...(errorTrackers ? { settings: { errorTrackers } } : {}) }
    log.push(`+ workspace "${body.name}"${errorTrackers ? ' (with the install-wide error tracker settings)' : ''}`)
    if (apply) {
      const res = await parseFetch('/classes/Workspace', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) throw new Error(`create workspace failed: ${JSON.stringify(res.body)}`)
      workspaces = [{ objectId: res.body.objectId, createdAt: res.body.createdAt }]
    } else {
      workspaces = [{ objectId: 'NEW', createdAt: '' }]
    }
  }
  const fallbackId = [...workspaces].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0].objectId

  // Operators
  const memberRows = await list('WorkspaceMember', {}, 'user,workspace')
  const { creates, defaults } = planMemberships({ users, memberUserIds: memberRows.map(row => idOf(row.user)), workspaceId: fallbackId, firstRun, adoptOrphans: !cloud })
  if (creates.length) log.push(`+ ${creates.length} membership(s)`)
  await batch(creates.map(body => ({ method: 'POST', path: `${mount}/classes/WorkspaceMember`, body })), apply)
  const userWorkspace = new Map(memberRows.map(row => [idOf(row.user), idOf(row.workspace)]))
  for (const row of creates) if (!userWorkspace.has(row.user.objectId)) userWorkspace.set(row.user.objectId, row.workspace.objectId)
  if (defaults.length) log.push(`~ ${defaults.length} operator(s) get a default workspace`)
  await batch(defaults.map(id => ({ method: 'PUT', path: `${mount}/users/${id}`, body: { defaultWorkspace: pointer('Workspace', userWorkspace.get(id) || fallbackId) } })), apply)

  // Rows that name their workspace
  const projectWorkspace = new Map((await list('Project', { workspace: { $exists: true } }, 'workspace')).map(row => [row.objectId, idOf(row.workspace)]))
  for (const className of WORKSPACE_CLASSES) {
    const rows = await list(className, { workspace: { $exists: false } }, 'project,agent')
    if (!rows.length) continue
    const updates = rows.map((row) => {
      const workspaceId = className === 'Project' ? fallbackId : workspaceForRow(row, { projectWorkspace, userWorkspace, fallbackId })
      if (className === 'Project') projectWorkspace.set(row.objectId, workspaceId)
      return { method: 'PUT', path: `${mount}/classes/${className}/${row.objectId}`, body: { workspace: pointer('Workspace', workspaceId) } }
    })
    log.push(`~ ${className}: ${updates.length} row(s) placed in a workspace`)
    await batch(updates, apply)
  }

  // Workspace mail sent without a project (first run only: there was one workspace)
  if (firstRun) {
    const logs = (await list('EmailLog', { project: { $exists: false }, workspace: { $exists: false } }, 'project,workspace,source')).filter(emailLogNeedsWorkspace)
    if (logs.length) log.push(`~ EmailLog: ${logs.length} project-less row(s) placed in the workspace`)
    await batch(logs.map(row => ({ method: 'PUT', path: `${mount}/classes/EmailLog/${row.objectId}`, body: { workspace: pointer('Workspace', fallbackId) } })), apply)
  }

  console.log(log.length ? log.join('\n') : 'Workspaces up to date.')
  if (!apply && log.length) console.log('\nDry run; re-run with --apply.')
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message || error)
    process.exit(1)
  })
}
