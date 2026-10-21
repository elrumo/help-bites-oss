import { describe, expect, test } from 'bun:test'
import { commitMessageRefs, parseBranchRefs, parseGithubRefs, pickRefTarget, pullRequestRefs } from '../shared/githubRefs'

const numbers = (mentions: { number: number }[]) => mentions.map(m => m.number)

describe('parseGithubRefs', () => {
  test('plain #N, in order, once each', () => {
    expect(parseGithubRefs('Same as #12 and (#4), again #12')).toEqual([{ number: 12, closes: false }, { number: 4, closes: false }])
    expect(parseGithubRefs('#7 at the start\nand #8 on a new line')).toEqual([{ number: 7, closes: false }, { number: 8, closes: false }])
  })

  test('closing keywords mark the number they stand before', () => {
    for (const word of ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved', 'Fixes', 'RESOLVED']) {
      expect(parseGithubRefs(`${word} #5`)).toEqual([{ number: 5, closes: true }])
    }
    expect(parseGithubRefs('Fixes: #5')).toEqual([{ number: 5, closes: true }])
    expect(parseGithubRefs('Closes #1, #2 and fixes #3')).toEqual([{ number: 1, closes: true }, { number: 2, closes: false }, { number: 3, closes: true }])
  })

  test('a keyword must be a word of its own and sit right before the number', () => {
    expect(parseGithubRefs('bugfix #5')).toEqual([{ number: 5, closes: false }])
    expect(parseGithubRefs('prefixes #5')).toEqual([{ number: 5, closes: false }])
    expect(parseGithubRefs('see #5, which fixes the other thing')).toEqual([{ number: 5, closes: false }])
    expect(parseGithubRefs('fixes the bug from #5')).toEqual([{ number: 5, closes: false }])
  })

  test('code, links, entities and other repositories are not references', () => {
    expect(parseGithubRefs('`#5` ```\n#6\n``` https://x.dev/a#7 x#8 &#123;')).toEqual([])
    expect(parseGithubRefs('fixes `#5` and closes https://github.com/o/r/issues/9')).toEqual([])
    expect(parseGithubRefs('Fixes owner/repo#12')).toEqual([])
    expect(parseGithubRefs('see owner/repo#12 and #13')).toEqual([{ number: 13, closes: false }])
    expect(parseGithubRefs('[#14](https://x.test/14)')).toEqual([{ number: 14, closes: false }])
  })

  test('six digits and more read as a colour, zero is nothing', () => {
    expect(parseGithubRefs('#ffffff #123456 #1234567 fixes #999999')).toEqual([])
    expect(parseGithubRefs('#99999 and #0')).toEqual([{ number: 99999, closes: false }])
  })

  test('at most fifty', () => {
    const many = Array.from({ length: 80 }, (_, i) => `#${i + 1}`).join(' ')
    expect(parseGithubRefs(many)).toHaveLength(50)
  })
})

describe('parseBranchRefs', () => {
  test('a work-type or issue word before a number', () => {
    expect(parseBranchRefs('fix/12-login-bug')).toEqual([12])
    expect(parseBranchRefs('feature/42-widget')).toEqual([42])
    expect(parseBranchRefs('refs/heads/issue-7')).toEqual([7])
    expect(parseBranchRefs('gh-9-dark-mode')).toEqual([9])
    expect(parseBranchRefs('user/ada/bugfix/31-crash')).toEqual([31])
    expect(parseBranchRefs('feature/#15')).toEqual([15])
  })

  test('numbers that are only part of a name are not references', () => {
    expect(parseBranchRefs('feature/2fa')).toEqual([])
    expect(parseBranchRefs('release/2024-10')).toEqual([])
    expect(parseBranchRefs('v2-redesign')).toEqual([])
    expect(parseBranchRefs('main')).toEqual([])
    expect(parseBranchRefs('fix/123456-too-long')).toEqual([])
  })
})

describe('commitMessageRefs', () => {
  test('references in the subject and the body', () => {
    expect(commitMessageRefs('Add export\n\nCloses #12\nSee also #13')).toEqual([{ number: 12, closes: true }, { number: 13, closes: false }])
  })

  test('the pull request number GitHub appends or merges is not an item', () => {
    expect(commitMessageRefs('Add dark mode (#34)')).toEqual([])
    expect(commitMessageRefs('Add dark mode, fixes #12 (#34)')).toEqual([{ number: 12, closes: true }])
    expect(commitMessageRefs('Merge pull request #34 from ada/fix/12-login\n\nFix login')).toEqual([])
    expect(commitMessageRefs('Merge pull request #34 from ada/dark\n\nCloses #12')).toEqual([{ number: 12, closes: true }])
    expect(commitMessageRefs('Windows line endings\r\n\r\nfixes #3\r\n')).toEqual([{ number: 3, closes: true }])
  })
})

describe('pullRequestRefs', () => {
  test('title, description and branch, with keywords only from the words', () => {
    const mentions = pullRequestRefs({ number: 34, title: 'Fix the login redirect (fixes #12)', body: 'Also touches #15.\n\nCloses #16', branch: 'fix/17-login' })
    expect(mentions).toEqual([{ number: 12, closes: true }, { number: 15, closes: false }, { number: 16, closes: true }, { number: 17, closes: false }])
  })

  test('a branch number the words already name keeps its keyword, and the PR\'s own number is dropped', () => {
    expect(pullRequestRefs({ number: 34, title: 'Closes #12', branch: 'fix/12-x' })).toEqual([{ number: 12, closes: true }])
    expect(pullRequestRefs({ number: 34, title: 'Follow-up to #34', branch: '' })).toEqual([])
    // Item numbers are their own sequence: a closing keyword names the item even when the PR has the same number.
    expect(pullRequestRefs({ number: 12, title: 'Fix login', body: 'Fixes #12', branch: '' })).toEqual([{ number: 12, closes: true }])
  })

  test('nothing to find', () => {
    expect(numbers(pullRequestRefs({ number: 1, title: 'Bump deps', body: '', branch: 'dependabot/npm/foo' }))).toEqual([])
    expect(pullRequestRefs({})).toEqual([])
  })
})

describe('pickRefTarget', () => {
  test('the board item wins when the board is on and has it', () => {
    expect(pickRefTarget(true, true, true)).toBe('board')
    expect(pickRefTarget(true, true, false)).toBe('board')
  })
  test('otherwise the feedback post', () => {
    expect(pickRefTarget(true, false, true)).toBe('feedback')
    expect(pickRefTarget(false, true, true)).toBe('feedback')
  })
  test('or nothing', () => {
    expect(pickRefTarget(false, true, false)).toBeNull()
    expect(pickRefTarget(true, false, false)).toBeNull()
  })
})
