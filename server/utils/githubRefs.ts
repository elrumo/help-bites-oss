import { commitMessageRefs, pickRefTarget, pullRequestRefs, type GithubRefKind, type GithubRefLink, type GithubRefMention, type GithubRefTarget } from '#shared/githubRefs'
import { feedbackStatusCategory } from '#shared/feedback'
import { getBoardConfig, updateBoardItem } from './board'
import { emitDomainEvent } from './domainEvents'
import { iso, pointerId, type ParseObject } from './parse'

// What GitHub says about the project's items. A commit pushed to the default
// branch, or a pull request merged into it, that mentions `#12` is recorded as
// a `GithubRef` on the board item or feedback post it names (the rules for
// which is in shared/githubRefs.ts and docs/GITHUB.md). A closing keyword
// (`fixes #12`) also moves the board item to the board's first done status,
// through the same path a manual move takes, so linked posts follow, followers
// are mailed and a changelog draft appears as the board is set up to do.
// Recording is idempotent: a commit or PR is stored once per item, however
// often GitHub redelivers it.

export type GithubRefSource = {
  kind: GithubRefKind
  /** The commit sha, or the pull request number. */
  ref: string
  repo: string
  title: string
  url: string
  at: Date
  mentions: GithubRefMention[]
}

type Target = { kind: GithubRefTarget, id: string, number: number, row: ParseObject }

/**
 * The actor for changes GitHub causes. It is an unsaved user that only carries
 * a name: audit trails and changelog authorship read "GitHub", and nothing
 * tries to point at a person who does not exist.
 */
export function githubActor(): ParseObject {
  const actor = new (useParse().User)()
  actor.set('name', 'GitHub')
  actor.set('username', 'GitHub')
  return actor
}

/** The items `#N` mentions name in this project: the board item when the board is on and has it, else the post. */
async function resolveTargets(project: ParseObject, mentions: GithubRefMention[]): Promise<Map<number, Target>> {
  const Parse = useParse()
  const numbers = mentions.map(m => m.number)
  const found = new Map<number, Target>()
  if (!numbers.length) return found
  const boardEnabled = getBoardConfig(project).enabled
  const items = boardEnabled ? await new Parse.Query('BoardItem').equalTo('project', project).containedIn('number', numbers).limit(numbers.length).find(MASTER) : []
  const itemByNumber = new Map(items.map(row => [Number(row.get('number')), row]))
  const missing = numbers.filter(n => !itemByNumber.has(n))
  const posts = missing.length ? await new Parse.Query('FeedbackPost').equalTo('project', project).containedIn('number', missing).limit(missing.length).find(MASTER) : []
  const postByNumber = new Map(posts.map(row => [Number(row.get('number')), row]))
  for (const number of numbers) {
    const kind = pickRefTarget(boardEnabled, itemByNumber.has(number), postByNumber.has(number))
    const row = kind === 'board' ? itemByNumber.get(number) : kind === 'feedback' ? postByNumber.get(number) : undefined
    if (kind && row) found.set(number, { kind, id: row.id || '', number, row })
  }
  return found
}

/** Store one commit or PR against one target. `created` is false when it was already there. */
async function upsertRef(project: ParseObject, target: Target, source: GithubRefSource, closes: boolean): Promise<{ created: boolean }> {
  const Parse = useParse()
  const key = `sb:ghref:${project.id}:${target.kind}:${target.id}:${source.kind}:${source.ref}`
  const held = await runExclusive(key, 20, async () => {
    const existing = await new Parse.Query('GithubRef').equalTo('project', project).equalTo('targetKind', target.kind).equalTo('targetId', target.id).equalTo('kind', source.kind).equalTo('ref', source.ref).first(MASTER)
    if (existing) {
      // A later delivery that carries the keyword (a PR edited before merging) upgrades the link.
      if (closes && existing.get('closes') !== true) { existing.set('closes', true); await existing.save(null, MASTER) }
      return false
    }
    const row = new (Parse.Object.extend('GithubRef'))() as ParseObject
    row.set('project', project)
    row.set('targetKind', target.kind)
    row.set('targetId', target.id)
    row.set('kind', source.kind)
    row.set('ref', source.ref)
    row.set('repo', source.repo)
    row.set('title', source.title.slice(0, 300))
    row.set('url', source.url.slice(0, 500))
    row.set('closes', closes)
    row.set('at', source.at)
    await row.save(null, MASTER)
    return true
  }, { failOpen: true })
  return { created: held.ran ? held.value : false }
}

/** `fixes #12` on a board item that is still open: to the board's first done status. Never reopens, un-cancels or touches posts. */
async function closeBoardItem(project: ParseObject, target: Target): Promise<boolean> {
  const board = getBoardConfig(project)
  const done = board.statuses.find(status => status.category === 'done')
  const category = feedbackStatusCategory(board, String(target.row.get('status') || ''))
  if (!done || category === 'done' || category === 'closed') return false
  try {
    await updateBoardItem(project, githubActor(), target.row, { status: done.key })
    return true
  } catch (error) {
    console.error('[github] could not move board item', target.id, (error as Error).message)
    return false
  }
}

export type RecordedRefs = { targets: { kind: GithubRefTarget, id: string, number: number, closes: boolean }[], closed: string[] }

/** Record what a commit or pull request mentions in one project. */
export async function recordGithubRefs(project: ParseObject, source: GithubRefSource): Promise<RecordedRefs> {
  const out: RecordedRefs = { targets: [], closed: [] }
  if (!source.mentions.length) return out
  const targets = await resolveTargets(project, source.mentions)
  for (const mention of source.mentions) {
    const target = targets.get(mention.number)
    if (!target) continue
    const { created } = await upsertRef(project, target, source, mention.closes)
    out.targets.push({ kind: target.kind, id: target.id, number: target.number, closes: mention.closes })
    if (created && source.kind === 'commit') {
      await emitDomainEvent(project, 'github.commit.referenced', { sha: source.ref, repo: source.repo, targetKind: target.kind, targetId: target.id, number: target.number, closes: mention.closes })
    }
    if (mention.closes && target.kind === 'board' && await closeBoardItem(project, target)) out.closed.push(target.id)
  }
  return out
}

/** The projects that use a repo (by the ids saved when their repos were picked) and whose workspace is active. */
async function projectsOfRepo(repoId: number): Promise<ParseObject[]> {
  if (!repoId) return []
  const projects = await new (useParse()).Query('Project').equalTo('repoIds', repoId).limit(100).find(MASTER)
  const active: ParseObject[] = []
  for (const project of projects) if (await workspaceIsActive(pointerId(project.get('workspace')))) active.push(project)
  return active
}

const firstLine = (text: string) => text.split('\n')[0]!.trim().slice(0, 200)

/** A GitHub `push` event: every commit on the default branch that mentions an item. Returns how many references were recorded. */
export async function recordPushRefs(payload: any): Promise<number> {
  const repoId = Number(payload?.repository?.id)
  const branch = String(payload?.repository?.default_branch || '')
  if (!repoId || !branch || payload.ref !== `refs/heads/${branch}` || payload.deleted === true) return 0
  const repo = String(payload.repository.full_name || '')
  const commits = (Array.isArray(payload.commits) ? payload.commits : []).slice(0, 100).flatMap((c: any) => {
    const message = String(c?.message || '').slice(0, 5000)
    const mentions = commitMessageRefs(message)
    const sha = String(c?.id || '')
    return mentions.length && sha ? [{ kind: 'commit' as const, ref: sha, repo, title: firstLine(message), url: String(c?.url || ''), at: new Date(String(c?.timestamp || '')), mentions }] : []
  })
  if (!commits.length) return 0
  let recorded = 0
  for (const project of await projectsOfRepo(repoId)) {
    for (const commit of commits) {
      try {
        recorded += (await recordGithubRefs(project, { ...commit, at: Number.isNaN(commit.at.getTime()) ? new Date() : commit.at })).targets.length
      } catch (error) {
        console.warn('[github] could not record a commit reference:', (error as Error).message)
      }
    }
  }
  return recorded
}

/**
 * A GitHub `pull_request` event: a merge into the default branch is recorded
 * against every item its title, description and branch name mention, and
 * announced on the event bus. Any other action is ignored. An install that was
 * never given the Pull requests permission simply never sends this event.
 */
export async function handleGithubPullRequest(payload: any): Promise<number> {
  const pr = payload?.pull_request
  const repoId = Number(payload?.repository?.id)
  const branch = String(payload?.repository?.default_branch || '')
  if (payload?.action !== 'closed' || pr?.merged !== true || !repoId || !branch || String(pr?.base?.ref || '') !== branch) return 0
  const number = Number(pr.number)
  if (!Number.isInteger(number) || number < 1) return 0
  const repo = String(payload.repository.full_name || '')
  const title = String(pr.title || '').slice(0, 300)
  const url = String(pr.html_url || '')
  const mentions = pullRequestRefs({ number, title, body: String(pr.body || '').slice(0, 20_000), branch: String(pr.head?.ref || '') })
  const at = new Date(String(pr.merged_at || ''))
  let recorded = 0
  for (const project of await projectsOfRepo(repoId)) {
    try {
      const result = await recordGithubRefs(project, { kind: 'pull_request', ref: String(number), repo, title, url, at: Number.isNaN(at.getTime()) ? new Date() : at, mentions })
      recorded += result.targets.length
      await emitDomainEvent(project, 'github.pull_request.merged', {
        number, repo, title, url,
        targets: result.targets.map(t => ({ kind: t.kind, id: t.id, closes: t.closes })),
        // Board items this merge moved to done (a closing keyword on one that was still open).
        closed: result.closed
      })
    } catch (error) {
      console.warn('[github] could not record a merged pull request:', (error as Error).message)
    }
  }
  return recorded
}

// ---- reading ------------------------------------------------------------------

export function serializeGithubRef(row: ParseObject): GithubRefLink {
  return {
    id: row.id || '',
    targetKind: row.get('targetKind') === 'feedback' ? 'feedback' : 'board',
    targetId: String(row.get('targetId') || ''),
    kind: row.get('kind') === 'pull_request' ? 'pull_request' : 'commit',
    ref: String(row.get('ref') || ''),
    repo: String(row.get('repo') || ''),
    title: String(row.get('title') || ''),
    url: String(row.get('url') || ''),
    closes: row.get('closes') === true,
    at: iso(row.get('at'))
  }
}

/** Commits and pull requests linked to one board item or post of the project, newest first. */
export async function listGithubRefs(project: ParseObject, kind: GithubRefTarget, targetId: string): Promise<GithubRefLink[]> {
  const rows = await new (useParse()).Query('GithubRef').equalTo('project', project).equalTo('targetKind', kind).equalTo('targetId', targetId).descending('at').limit(200).find(MASTER)
  return rows.map(serializeGithubRef)
}
