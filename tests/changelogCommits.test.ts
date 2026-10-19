import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { chunk, commitPrompt, readCommitDrafts, usableCommits, type CommitInfo } from '../shared/changelogCommits'
import { normalizeChangelogConfig } from '../shared/changelog'
import { verifyGithubSignature } from '../server/utils/github'

const sha = (n: number) => n.toString(16).padStart(40, '0')
const commit = (n: number, message: string, date = `2026-10-0${n}T10:00:00Z`): CommitInfo => ({ sha: sha(n), message, date })

describe('usableCommits', () => {
  test('drops merges, empties, repeats and bad SHAs; newest first', () => {
    const out = usableCommits([commit(1, 'Add CSV export'), commit(2, 'Merge branch main into x'), commit(3, '  '), commit(1, 'Add CSV export'), { sha: 'abc', message: 'short sha', date: '' }, commit(4, 'Fix login')])
    expect(out.map(c => c.sha)).toEqual([sha(4), sha(1)])
  })
})

describe('readCommitDrafts', () => {
  const commits = [commit(1, 'a'), commit(2, 'b'), commit(3, 'c')]
  test('maps c-ids to full SHAs and drops what the model invented', () => {
    const reply = '```json\n{"entries":[{"title":"CSV export","body":"Export your library.","tag":"new","commits":["c1","c3"]},{"title":"Ghost","body":"x","tag":"fix","commits":["c9"]},{"title":"","commits":["c2"]},{"title":"Odd tag","tag":"nope","commits":["c2"]}]}\n```'
    const drafts = readCommitDrafts(reply, commits)
    expect(drafts).toEqual([
      { title: 'CSV export', body: 'Export your library.', tag: 'new', commitShas: [sha(1), sha(3)] },
      { title: 'Odd tag', body: '', tag: 'improved', commitShas: [sha(2)] }
    ])
  })
  test('garbage gives nothing', () => {
    expect(readCommitDrafts('sorry, no', commits)).toEqual([])
  })
})

test('the prompt numbers commits and flattens messages', () => {
  expect(commitPrompt([commit(1, 'Title\n\nlong body')])).toContain('c1 | 2026-10-01 | Title / long body')
})

test('chunk splits evenly', () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
})

test('commitAi config defaults off and changes only the keys sent', () => {
  expect(normalizeChangelogConfig({}).commitAi).toEqual({ onPush: false, autoPublish: false })
  expect(normalizeChangelogConfig({ commitAi: { onPush: true } }).commitAi).toEqual({ onPush: true, autoPublish: false })
})

test('GitHub signatures: valid passes, tampered or missing secret fails', () => {
  const body = '{"ref":"refs/heads/main"}'
  const header = `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`
  expect(verifyGithubSignature(body, header, 's3cret')).toBe(true)
  expect(verifyGithubSignature(`${body} `, header, 's3cret')).toBe(false)
  expect(verifyGithubSignature(body, header, '')).toBe(false)
  expect(verifyGithubSignature(body, 'sha256=00', 's3cret')).toBe(false)
})
