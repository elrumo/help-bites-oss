import { createSign, randomBytes } from 'node:crypto'
import { createError } from 'h3'
import { matchRepoPath, type FramePath, type PromptFile } from '#shared/errors'
import { hasRootSecret, readLinkToken, signLinkToken } from './secrets'

// GitHub, as a GitHub App the server owner registers once (docs/GITHUB.md).
// A workspace connects by installing that app on a GitHub account or
// organisation (the installation: who it is and which repos it may see);
// nothing secret is stored, because installation tokens are minted on demand
// from the app's private key and live an hour. Each project then lists the
// repos (from any of the workspace's installations) it uses: for AI error
// notes and legal documents, which read them, never write.

export type GithubInstallation = { id: string, account: string, type: string, avatar: string, connectedBy: string, connectedAt: string }
export type GithubRepo = { id: number, fullName: string, private: boolean, defaultBranch: string }
export type ProjectRepo = { installationId: string, id: number, fullName: string, defaultBranch: string }

const API = 'https://api.github.com'
const SETTINGS_KEY = 'githubInstallations'
const STATE_TTL_MS = 15 * 60 * 1000
const MAX_REPO_PAGES = 5
export const MAX_PROJECT_REPOS = 10

const env = (key: string) => String(process.env[`GITHUB_APP_${key}`] || '').trim()

/** The app is registered (GITHUB_APP_*) and the server can sign the install link. */
export function githubConfigured(): boolean {
  return ['ID', 'SLUG', 'PRIVATE_KEY', 'CLIENT_ID', 'CLIENT_SECRET'].every(key => env(key)) && hasRootSecret()
}

function requireGithub(): void {
  if (!githubConfigured()) throw createError({ statusCode: 501, statusMessage: 'GitHub is not set up on this server. Register a GitHub App and set GITHUB_APP_* (docs/GITHUB.md).' })
}

// ---- calling GitHub -----------------------------------------------------------

async function gh<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'helpbites', authorization: `Bearer ${token}`, ...init.headers }
  })
  if (response.status === 404) throw createError({ statusCode: 410, statusMessage: 'GitHub no longer has that installation or repository. Disconnect it and connect again.' })
  if (!response.ok) throw createError({ statusCode: 502, statusMessage: `GitHub answered ${response.status}` })
  return await response.json() as T
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** The app's own short-lived JWT (RS256), which asks GitHub for installation tokens. */
export function appJwt(now = Math.floor(Date.now() / 1000)): string {
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 9 * 60, iss: env('ID') })}`
  return `${body}.${createSign('RSA-SHA256').update(body).sign(env('PRIVATE_KEY').replace(/\\n/g, '\n')).toString('base64url')}`
}

const tokens = new Map<string, { token: string, expiresAt: number }>()

/** A token for one installation, reused until a minute before it expires. */
export async function installationToken(installationId: string): Promise<string> {
  requireGithub()
  const hit = tokens.get(installationId)
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token
  const fresh = await gh<{ token: string, expires_at: string }>(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, appJwt(), { method: 'POST' })
  if (tokens.size > 500) tokens.delete(tokens.keys().next().value!)
  tokens.set(installationId, { token: fresh.token, expiresAt: Date.parse(fresh.expires_at) })
  return fresh.token
}

/** Every repo an installation may see (the first MAX_REPO_PAGES × 100). */
export async function listInstallationRepos(installationId: string): Promise<GithubRepo[]> {
  const token = await installationToken(installationId)
  const repos: GithubRepo[] = []
  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    const { repositories } = await gh<{ repositories: Array<{ id: number, full_name: string, private: boolean, default_branch: string }> }>(`/installation/repositories?per_page=100&page=${page}`, token)
    repos.push(...repositories.map(r => ({ id: r.id, fullName: r.full_name, private: r.private, defaultBranch: r.default_branch })))
    if (repositories.length < 100) break
  }
  return repos.sort((a, b) => a.fullName.localeCompare(b.fullName))
}

// ---- a workspace's installations ----------------------------------------------

export function listInstallations(workspace: ParseObject): GithubInstallation[] {
  const list = (workspace.get('settings') as Record<string, unknown> | undefined)?.[SETTINGS_KEY]
  return Array.isArray(list) ? list as GithubInstallation[] : []
}

async function saveInstallations(workspace: ParseObject, list: GithubInstallation[]): Promise<void> {
  workspace.set('settings', { ...(workspace.get('settings') as Record<string, unknown> || {}), [SETTINGS_KEY]: list })
  await workspace.save(null, MASTER)
  await invalidate('workspace', workspace.id || '')
}

function requireInstallation(workspace: ParseObject, id: string): GithubInstallation {
  const found = listInstallations(workspace).find(item => item.id === id)
  if (!found) throw createError({ statusCode: 404, statusMessage: 'GitHub connection not found' })
  return found
}

export async function removeInstallation(workspace: ParseObject, id: string): Promise<void> {
  requireInstallation(workspace, id)
  const projects = await new (useParse()).Query('Project').equalTo('workspace', workspace).exists('repos').limit(1000).find(MASTER)
  const using = projects.filter(project => projectRepos(project).some(repo => repo.installationId === id))
  if (using.length) throw createError({ statusCode: 409, statusMessage: `${using.length} project${using.length === 1 ? ' uses' : 's use'} repos from this connection. Remove ${using.length === 1 ? 'its' : 'their'} repos first.` })
  await saveInstallations(workspace, listInstallations(workspace).filter(item => item.id !== id))
  tokens.delete(id)
}

export async function installationRepos(workspace: ParseObject, id: string): Promise<GithubRepo[]> {
  requireInstallation(workspace, id)
  return listInstallationRepos(id)
}

// ---- connecting: install the app, come back signed -----------------------------

/** Where to send the browser to install the app. The state binds the return trip to this workspace and person. */
export function installUrl(workspaceId: string, userId: string): string {
  requireGithub()
  const state = signLinkToken('github-install', JSON.stringify({ w: workspaceId, u: userId, exp: Date.now() + STATE_TTL_MS, n: randomBytes(6).toString('hex') }))
  return `https://github.com/apps/${encodeURIComponent(env('SLUG'))}/installations/new?state=${encodeURIComponent(state)}`
}

function readState(state: string): { workspaceId: string, userId: string } {
  try {
    const parsed = JSON.parse(readLinkToken('github-install', state) || '')
    if (parsed.w && parsed.u && parsed.exp > Date.now()) return { workspaceId: String(parsed.w), userId: String(parsed.u) }
  } catch { /* falls through */ }
  throw createError({ statusCode: 400, statusMessage: 'This GitHub link expired. Start again from Settings.' })
}

/**
 * GitHub sends the browser back with the installation id and, because the app
 * asks for user authorization, an OAuth code. The id alone is not proof: anyone
 * can put another account's installation id in a URL. The code is: it must
 * belong to a person who can see that installation.
 */
export async function completeInstall(input: { state: string, code: string, installationId: string }): Promise<void> {
  requireGithub()
  const { workspaceId, userId } = readState(input.state)
  const installationId = input.installationId.replace(/\D/g, '')
  if (!installationId || !input.code) throw createError({ statusCode: 400, statusMessage: 'GitHub did not return an installation. Try again.' })
  const exchanged = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'helpbites' },
    body: JSON.stringify({ client_id: env('CLIENT_ID'), client_secret: env('CLIENT_SECRET'), code: input.code })
  }).then(r => r.json() as Promise<{ access_token?: string }>).catch(() => ({} as { access_token?: string }))
  if (!exchanged.access_token) throw createError({ statusCode: 400, statusMessage: 'GitHub did not confirm who you are. Try again.' })
  let owned = false
  for (let page = 1; page <= MAX_REPO_PAGES && !owned; page++) {
    const { installations } = await gh<{ installations: Array<{ id: number }> }>(`/user/installations?per_page=100&page=${page}`, exchanged.access_token)
    owned = installations.some(item => String(item.id) === installationId)
    if (installations.length < 100) break
  }
  if (!owned) throw createError({ statusCode: 403, statusMessage: 'Your GitHub account cannot access that installation.' })
  const info = await gh<{ account: { login: string, type: string, avatar_url: string } }>(`/app/installations/${installationId}`, appJwt())
  const workspace = await getWorkspace(workspaceId)
  if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
  const entry: GithubInstallation = { id: installationId, account: info.account.login, type: info.account.type, avatar: info.account.avatar_url, connectedBy: userId, connectedAt: new Date().toISOString() }
  await saveInstallations(workspace, [...listInstallations(workspace).filter(item => item.id !== installationId), entry])
}

// ---- a project's repos -----------------------------------------------------------

export function projectRepos(project: ParseObject): ProjectRepo[] {
  const list = project.get('repos')
  return Array.isArray(list) ? list as ProjectRepo[] : []
}

/**
 * Replaces a project's repos. Each pick is checked against what GitHub says the
 * installation can see, so a stored repo is always one the workspace may read,
 * with GitHub's own spelling of its name.
 */
export async function setProjectRepos(workspace: ParseObject, project: ParseObject, picks: Array<{ installationId: string, id: number }>): Promise<ProjectRepo[]> {
  if (picks.length > MAX_PROJECT_REPOS) throw createError({ statusCode: 400, statusMessage: `A project can use up to ${MAX_PROJECT_REPOS} repos` })
  const catalog = new Map<string, GithubRepo[]>()
  const repos: ProjectRepo[] = []
  for (const pick of picks) {
    const installationId = String(pick.installationId || '')
    requireInstallation(workspace, installationId)
    if (!catalog.has(installationId)) catalog.set(installationId, await listInstallationRepos(installationId))
    const repo = catalog.get(installationId)!.find(item => item.id === Number(pick.id))
    if (!repo) throw createError({ statusCode: 400, statusMessage: 'One of those repos is not available to the GitHub connection. Reload and pick again.' })
    if (!repos.some(item => item.id === repo.id)) repos.push({ installationId, id: repo.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch })
  }
  project.set('repos', repos)
  await project.save(null, MASTER)
  return repos
}

// ---- reading a project's code (read-only) -----------------------------------------

const MAX_FILE_BYTES = 100_000

/** One file at the repo's default branch, or null when it is missing, a directory or too big to be worth sending. */
export async function readRepoFile(repo: ProjectRepo, path: string): Promise<string | null> {
  const token = await installationToken(repo.installationId)
  const file = await gh<{ type?: string, size?: number, content?: string, encoding?: string }>(`/repos/${repo.fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(repo.defaultBranch)}`, token).catch(() => null)
  if (!file || file.type !== 'file' || file.encoding !== 'base64' || !file.content || (file.size || 0) > MAX_FILE_BYTES) return null
  return Buffer.from(file.content, 'base64').toString('utf8')
}

/** Every file path at the default branch (GitHub truncates the list for huge repos; those just match less). */
async function repoFilePaths(repo: ProjectRepo): Promise<string[]> {
  const token = await installationToken(repo.installationId)
  const tree = await gh<{ tree: Array<{ path: string, type: string }> }>(`/repos/${repo.fullName}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`, token).catch(() => null)
  return (tree?.tree || []).filter(item => item.type === 'blob').map(item => item.path)
}

export const MAX_PROMPT_FILES = 3

/**
 * The project's own source for the files an error passed through: at most
 * MAX_PROMPT_FILES, each matched to exactly one repo path by suffix. Nothing
 * (and no error) when GitHub isn't set up or the project has no repos.
 */
export async function frameFiles(project: ParseObject, frames: FramePath[]): Promise<PromptFile[]> {
  const repos = projectRepos(project)
  if (!repos.length || !frames.length || !githubConfigured()) return []
  try {
    const trees = await Promise.all(repos.map(async repo => ({ repo, paths: await repoFilePaths(repo) })))
    const files: PromptFile[] = []
    for (const frame of frames) {
      if (files.length >= MAX_PROMPT_FILES) break
      const hits = trees.flatMap(({ repo, paths }) => { const path = matchRepoPath(frame.path, paths); return path ? [{ repo, path }] : [] })
      if (hits.length !== 1) continue
      const text = await readRepoFile(hits[0]!.repo, hits[0]!.path)
      if (text) files.push({ repo: hits[0]!.repo.fullName, path: hits[0]!.path, line: frame.line, text })
    }
    return files
  } catch (error) {
    console.warn('[github] could not read repo files for the AI note:', (error as Error).message)
    return []
  }
}

// ---- reading a repo (never writing) -----------------------------------------------

/** Dependency manifests worth reading: they say which SDKs and services a project uses. */
const MANIFESTS = new Set(['package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'Gemfile', 'go.mod', 'Cargo.toml', 'composer.json', 'pubspec.yaml', 'Podfile', 'build.gradle', 'build.gradle.kts', 'pom.xml'])
const MAX_MANIFESTS = 8
const MAX_MANIFEST_BYTES = 200_000

export type RepoSnapshot = { repo: string, tree: string[], files: Array<{ path: string, content: string }> }

/** Which blobs of a repo tree to read: manifests near the top, not in vendored code, smallest paths first. */
export function pickManifests(tree: Array<{ path: string, type: string, size?: number }>): string[] {
  return tree
    .filter(item => item.type === 'blob' && MANIFESTS.has(item.path.slice(item.path.lastIndexOf('/') + 1)) && (item.size ?? 0) <= MAX_MANIFEST_BYTES)
    .map(item => item.path)
    .filter(path => path.split('/').length <= 3 && !/(^|\/)(node_modules|vendor|Pods|\.git|third_party)\//.test(path))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_MANIFESTS)
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** The file list of a repo's default branch and the text of a few manifests. A manifest that cannot be read is skipped. */
export async function fetchRepoSnapshot(repo: ProjectRepo): Promise<RepoSnapshot> {
  const token = await installationToken(repo.installationId)
  const root = `/repos/${encodePath(repo.fullName)}`
  const { tree } = await gh<{ tree: Array<{ path: string, type: string, size?: number }> }>(`${root}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`, token)
  const files = await Promise.all(pickManifests(tree).map(async (path) => {
    try {
      const file = await gh<{ content?: string, encoding?: string }>(`${root}/contents/${encodePath(path)}?ref=${encodeURIComponent(repo.defaultBranch)}`, token)
      return file.encoding === 'base64' && file.content ? { path, content: Buffer.from(file.content, 'base64').toString('utf8') } : null
    } catch { return null }
  }))
  return { repo: repo.fullName, tree: tree.filter(item => item.type === 'blob').map(item => item.path), files: files.filter((file): file is { path: string, content: string } => !!file) }
}
