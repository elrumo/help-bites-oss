import { createError } from 'h3'
import { COMMIT_CHUNK, COMMIT_GROUNDING, COMMIT_MAX, chunk, commitPrompt, readCommitDrafts, usableCommits, type CommitInfo } from '#shared/changelogCommits'
import { citedCommitShas, createChangelogEntries, getChangelogConfig } from './changelog'
import { listRepoCommits, projectRepos } from './github'

// Changelog entries written by AI from a project's GitHub commits (read-only;
// only commit messages are sent, never code). Two ways in, one job:
//   - a person presses Generate (all commits, or the last N days): always drafts;
//   - a push to a repo's default branch (the GitHub webhook), when the project
//     turned it on: drafts too, unless it also turned on auto-publish.
// Every entry cites its commits, so a commit is written up once however often
// this runs, and a draft waits in the usual review queue until a person approves it.

export type ChangelogRun = { state: 'running' | 'done' | 'failed', startedAt: string, finishedAt?: string, created: number, skipped: number, truncated?: boolean, error?: string }

export function readChangelogRun(project: ParseObject): ChangelogRun | null {
  const run = project.get('changelogRun')
  return run && typeof run === 'object' ? run as ChangelogRun : null
}

async function saveRun(project: ParseObject, run: ChangelogRun): Promise<void> {
  project.set('changelogRun', run)
  await project.save(null, MASTER)
}

type Input = { projectId: string, auto?: boolean, days?: number | null, commits?: CommitInfo[] }

/** Queue a run: `commits` (a push) or `days` (null = everything the cap allows) say what to read. */
export async function queueChangelogCommits(project: ParseObject, input: Omit<Input, 'projectId'>): Promise<void> {
  await saveRun(project, { state: 'running', startedAt: new Date().toISOString(), created: 0, skipped: 0 })
  await enqueueJob('changelog.commits', { ...input, projectId: project.id }, { workspaceId: await workspaceIdOfProject(project.id || '') })
}

/** Newest commits of every repo of the project, `days` back (null = all), at most COMMIT_MAX in all. */
async function readRepoCommits(project: ParseObject, days: number | null): Promise<CommitInfo[]> {
  const repos = projectRepos(project)
  if (!repos.length) throw createError({ statusCode: 400, statusMessage: 'This project has no GitHub repos. Connect GitHub in Settings and pick its repos first.' })
  const since = days ? new Date(Date.now() - days * 86_400_000) : null
  const settled = await Promise.allSettled(repos.map(repo => listRepoCommits(repo, since, COMMIT_MAX)))
  const ok = settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
  if (!ok.length) throw createError({ statusCode: 502, statusMessage: 'Could not read any of this project\'s repos on GitHub. Check the connection in Settings.' })
  return ok.flat()
}

/** The job: read commits, ask the model, create entries (drafts unless this is a push and the project auto-publishes). */
export async function runChangelogCommits(payload: Record<string, any>): Promise<void> {
  const project = await loadProjectUnscoped(String(payload.projectId || '')).catch(() => null)
  if (!project) return
  const run: ChangelogRun = { state: 'running', startedAt: new Date().toISOString(), created: 0, skipped: 0 }
  try {
    const route = await resolveAi(await workspaceOfRow(project))
    if (!route) throw createError({ statusCode: 501, statusMessage: 'No AI provider is configured. Add one in the workspace AI settings, or set LITELLM_API_BASE_URL on the server.' })
    const all = Array.isArray(payload.commits) ? payload.commits as CommitInfo[] : await readRepoCommits(project, Number(payload.days) > 0 ? Number(payload.days) : null)
    const usable = usableCommits(all)
    run.truncated = usable.length > COMMIT_MAX
    // Read the setting now, not when the push arrived: turning auto-publish off stops what is already queued.
    const publish = payload.auto === true && getChangelogConfig(project).commitAi.autoPublish
    const known = await citedCommitShas(project, usable.slice(0, COMMIT_MAX).map(c => c.sha))
    const fresh = usable.slice(0, COMMIT_MAX).filter(c => !known.has(c.sha))
    run.skipped = usable.length - fresh.length

    for (const part of chunk(fresh, COMMIT_CHUNK)) {
      const { text } = await chatCompletion(route, { messages: [{ role: 'system', content: COMMIT_GROUNDING }, { role: 'user', content: commitPrompt(part) }], temperature: 0.2, max_tokens: 3000 }, { timeoutMs: 120_000 })
      const drafts = readCommitDrafts(text, part)
      if (!drafts.length) continue
      const result = await createChangelogEntries(project, undefined, { entries: drafts.map(d => ({ ...d, status: publish ? 'published' : 'draft' })) }, { name: 'AI', source: 'internal', ai: true })
      run.created += result.created.length
    }
    await saveRun(project, { ...run, state: 'done', finishedAt: new Date().toISOString() })
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    await saveRun(project, { ...run, state: 'failed', finishedAt: new Date().toISOString(), error: String((error as { statusMessage?: string }).statusMessage || (error as Error).message).slice(0, 300) }).catch(() => {})
    // A missing provider, a spent budget or an unusable repo will not fix itself on a retry; a network blip will.
    if (!status || (status >= 500 && status !== 501)) throw error
  }
}

/**
 * A GitHub `push` event: queue a run for every project that uses the repo and
 * asked for it. Only the default branch counts. Returns how many were queued.
 * ponytail: GitHub lists at most 20 commits per push; a bigger push is only partly seen (Generate catches up).
 */
export async function handleGithubPush(payload: any): Promise<number> {
  const repoId = Number(payload?.repository?.id)
  const branch = String(payload?.repository?.default_branch || '')
  if (!repoId || !branch || payload.ref !== `refs/heads/${branch}` || payload.deleted === true) return 0
  const commits: CommitInfo[] = (Array.isArray(payload.commits) ? payload.commits : []).map((c: any) => ({ sha: String(c?.id || ''), message: String(c?.message || '').slice(0, 1000), date: String(c?.timestamp || '') }))
  if (!usableCommits(commits).length) return 0
  const projects = await new (useParse()).Query('Project').equalTo('repoIds', repoId).limit(100).find(MASTER)
  let queued = 0
  for (const project of projects) {
    if (!getChangelogConfig(project).commitAi.onPush) continue
    try {
      // A busy repo must not run up the AI bill: past this, pushes wait for the next Generate.
      await rateLimit(`sb:rl:clpush:${project.id}`, LIMITS.changelogPushPerProject.limit, LIMITS.changelogPushPerProject.window)
      await queueChangelogCommits(project, { auto: true, commits })
      queued++
    } catch (error) {
      console.warn('[changelog] push not queued:', (error as Error).message)
    }
  }
  return queued
}
