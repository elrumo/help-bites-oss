import { parseFeedbackRefs, stripNonProse } from './feedback'

// `#12` in what a developer writes on GitHub: commit messages, pull request
// titles and descriptions, branch names. It names one of the project's own
// items: a board item when the project's board is on and has that number,
// else the feedback post with that number (docs/GITHUB.md). A closing keyword
// right before it (`fixes #12`) says the work finishes the item.
//
// Pure, so the webhook, the tests and the docs share one set of rules. The
// prose rules are the feedback board's own (`parseFeedbackRefs`): code, links
// and `owner/repo#12` (an issue in another repository) are never references,
// and a number of six digits or more reads as a colour, not an item.

export type GithubRefMention = { number: number, closes: boolean }

/** Most references one commit, pull request or branch can carry. */
export const GITHUB_REFS_MAX = 50

// A keyword GitHub itself treats as closing, straight before the number (a colon is allowed).
const CLOSING = /(?:^|[\s([{,;:*])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?::\s*|\s+)#(\d{1,5})(?![\d\w])/gi

// `fix/12-login`, `feature/42-widget`, `issue-12`, `gh-12`: a work-type or issue word, then the number.
const BRANCH = /(?:^|\/)(?:(?:issues?|tickets?|gh|hb)[-_/]?|(?:fix|bugfix|hotfix|bug|feat|feature|chore)\/)#?(\d{1,5})(?![\d\w])/gi

function numbersOf(pattern: RegExp, text: string): number[] {
  const out: number[] = []
  for (const match of text.matchAll(pattern)) {
    const number = Number(match[1])
    if (number >= 1 && !out.includes(number)) out.push(number)
  }
  return out
}

/** References in prose, in order of first appearance; `closes` when any mention has a closing keyword before it. */
export function parseGithubRefs(text: string): GithubRefMention[] {
  const prose = stripNonProse(text)
  const closing = new Set(numbersOf(CLOSING, prose))
  return parseFeedbackRefs(text).concat([...closing]).filter((n, i, all) => all.indexOf(n) === i).slice(0, GITHUB_REFS_MAX).map(number => ({ number, closes: closing.has(number) }))
}

/** Numbers a branch name points at. A branch never closes anything: merging its pull request does. */
export function parseBranchRefs(branch: string): number[] {
  const name = String(branch || '').replace(/^refs\/heads\//, '')
  return [...new Set([...parseFeedbackRefs(name), ...numbersOf(BRANCH, name)])].slice(0, GITHUB_REFS_MAX)
}

/**
 * References in a commit message. GitHub appends the pull request's own number
 * to a squash commit's subject (`Add dark mode (#34)`) and writes `Merge pull
 * request #34 from …` for a merge: those name the PR, not an item, so they are
 * left out.
 */
export function commitMessageRefs(message: string): GithubRefMention[] {
  const lines = String(message || '').replace(/\r\n/g, '\n').split('\n')
  const subject = (lines[0] || '').replace(/^Merge pull request #\d+ from \S+/i, '').replace(/\s*\(#\d+\)\s*$/, '')
  return parseGithubRefs([subject, ...lines.slice(1)].join('\n'))
}

/** References in a pull request: title and description (with keywords), then its branch. Its own number is not one. */
export function pullRequestRefs(pr: { number?: number, title?: string, body?: string, branch?: string }): GithubRefMention[] {
  const mentions = parseGithubRefs(`${pr.title || ''}\n${pr.body || ''}`)
  for (const number of parseBranchRefs(pr.branch || '')) if (!mentions.some(m => m.number === number)) mentions.push({ number, closes: false })
  return mentions.filter(m => m.number !== pr.number).slice(0, GITHUB_REFS_MAX)
}

export type GithubRefTarget = 'board' | 'feedback'

/**
 * Which of the project's items `#N` means: the board item when the board is on
 * and has an item numbered N, else the feedback post numbered N, else nothing.
 */
export function pickRefTarget(boardEnabled: boolean, boardHas: boolean, postHas: boolean): GithubRefTarget | null {
  if (boardEnabled && boardHas) return 'board'
  return postHas ? 'feedback' : null
}

export const GITHUB_REF_KINDS = ['commit', 'pull_request'] as const
export type GithubRefKind = typeof GITHUB_REF_KINDS[number]

/** A commit or pull request linked to a board item or a feedback post. */
export type GithubRefLink = {
  id: string
  targetKind: GithubRefTarget
  targetId: string
  kind: GithubRefKind
  /** The commit sha, or the pull request number. */
  ref: string
  repo: string
  title: string
  url: string
  /** A closing keyword said so. */
  closes: boolean
  at: string | null
}
