import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  chunk,
  collectCommitsContext,
  collectWorktreeContext,
  dropDuplicateTitles,
  isSensitivePath,
  knownShas,
  listCommits,
  parseArgs,
  parseClaudeJson,
  parseCommits,
  parseSince,
  titleKey,
  truncateDiff,
  unseenCommits,
  validateHistoryPayload,
  validateWorktreePayload
} from '../cli/lib.mjs'

const sha = (char: string) => char.repeat(40)
const commit = (char: string, date: string, subject = 'x') => ({ sha: sha(char), date, subject, body: '' })

describe('arguments', () => {
  test('commands, flags and values; -y is --yes; --since=7d works inline', () => {
    const args = parseArgs(['changelog', '--since', '2w', '-y', '--draft', '--model=sonnet'])
    expect(args._).toEqual(['changelog'])
    expect(args.values).toEqual({ since: '2w', model: 'sonnet' })
    expect([...args.flags].sort()).toEqual(['draft', 'yes'])
  })

  test('a boolean flag never swallows the next word, and typos are errors', () => {
    expect(parseArgs(['--draft', 'changelog'])._).toEqual(['changelog'])
    expect(() => parseArgs(['--sinse', '7d'])).toThrow('Unknown option --sinse')
    expect(() => parseArgs(['--since'])).toThrow('needs a value')
  })
})

describe('--since', () => {
  test('days, weeks and months become git approxidate; singular reads right', () => {
    expect(parseSince('7d')).toEqual({ args: ['--since=7 days ago'], label: 'the last 7 days' })
    expect(parseSince('1w').args).toEqual(['--since=1 week ago'])
    expect(parseSince('3M').args).toEqual(['--since=3 months ago'])
  })

  test('a date, or else a git ref up to HEAD; nothing that looks like an option', () => {
    expect(parseSince('2026-09-01').args).toEqual(['--since=2026-09-01'])
    expect(parseSince('v1.2').args).toEqual(['v1.2..HEAD'])
    expect(() => parseSince('--all')).toThrow()
    expect(() => parseSince('')).toThrow()
    expect(() => parseSince('0d')).toThrow('above zero')
  })
})

describe('what is sent to the model', () => {
  test('secrets are recognised by path', () => {
    for (const path of ['.env', 'app/.env.local', 'certs/site.pem', 'id.key', 'config/secrets.json', 'aws-credentials']) expect(isSensitivePath(path)).toBe(true)
    for (const path of ['src/index.ts', 'docs/environment.md']) expect(isSensitivePath(path)).toBe(false)
  })

  test('a diff under budget is untouched; over budget a huge file is cut, never dropped, and small ones stay whole', () => {
    const file = (path: string, lines: number) => `diff --git a/${path} b/${path}\n${'+line\n'.repeat(lines)}`
    const small = file('small.ts', 3)
    expect(truncateDiff(small, 10_000)).toMatchObject({ truncated: false, text: small })

    const diff = `${small}\n${file('huge.ts', 5000)}`
    const cut = truncateDiff(diff, 2000)
    expect(cut.truncated).toBe(true)
    expect(cut.total).toBe(2)
    expect(cut.includedInFull).toBe(1)
    expect(cut.text).toContain(small)
    expect(cut.text).toContain('[huge.ts:')
    expect(cut.text.length).toBeLessThan(2400)
  })
})

describe('reading the model output', () => {
  test('the claude envelope, with the answer as an object or as fenced JSON', () => {
    const answer = { entries: [] }
    expect(parseClaudeJson(JSON.stringify({ type: 'result', result: answer }))).toEqual(answer)
    expect(parseClaudeJson(JSON.stringify({ result: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` }))).toEqual(answer)
  })

  test('a stream of events: the last payload wins, an error event throws so the next provider runs', () => {
    const lines = [{ type: 'start' }, { type: 'text', part: { text: JSON.stringify({ entries: [{ title: 'a' }] }) } }].map(e => JSON.stringify(e)).join('\n')
    expect(parseClaudeJson(lines)).toEqual({ entries: [{ title: 'a' }] })
    expect(() => parseClaudeJson(`${JSON.stringify({ type: 'start' })}\n${JSON.stringify({ type: 'error', error: { name: 'Insufficient balance' } })}`)).toThrow('Insufficient balance')
    expect(() => parseClaudeJson('not json at all')).toThrow('did not return JSON')
  })
})

describe('validating the answer', () => {
  const entry = { title: 'Add CSV export', body: 'Export your library.', tag: 'new' }

  test('uncommitted work: a commit subject and clean entries; no entries is fine', () => {
    expect(validateWorktreePayload({ commit: { subject: ' feat: csv ' }, entries: [entry] })).toEqual({ commit: { subject: 'feat: csv', body: '' }, entries: [entry] })
    expect(validateWorktreePayload({ commit: { subject: 'chore: bump' } }).entries).toEqual([])
    expect(() => validateWorktreePayload({ commit: { subject: 'x'.repeat(73) }, entries: [] })).toThrow('limit is 72')
    expect(() => validateWorktreePayload({ commit: { subject: 'ok' }, entries: [{ ...entry, tag: 'huge' }] })).toThrow('entries[0].tag')
    expect(() => validateWorktreePayload({ commit: { subject: 'ok' }, entries: [{ ...entry, title: 'x'.repeat(201) }] })).toThrow('limit is 200')
  })

  test('history: cites resolve by prefix to full SHAs, the date is the newest cited commit, uncited entries are dropped', () => {
    const commits = [commit('a', '2026-09-01T10:00:00+02:00'), commit('b', '2026-09-03T10:00:00+02:00'), commit('c', '2026-09-05T10:00:00+02:00')]
    const { entries, dropped } = validateHistoryPayload({
      entries: [
        { ...entry, commits: [sha('a').slice(0, 10), sha('b').slice(0, 10).toUpperCase(), 'zzzzzzzzzz'] },
        { ...entry, title: 'Invented', commits: ['0000000000'] },
        { ...entry, title: 'No cites' }
      ]
    }, commits)
    expect(entries).toEqual([{ ...entry, commitShas: [sha('a'), sha('b')], publishedAt: '2026-09-03T08:00:00.000Z' }])
    expect(dropped).toEqual(['Invented', 'No cites'])
  })
})

describe('never writing a commit up twice', () => {
  test('commits whose SHA an entry already cites are left out', () => {
    const known = knownShas([{ commitShas: [sha('a')] }, { commitShas: [sha('b'), sha('c')] }, {}])
    expect(unseenCommits([commit('a', 'd'), commit('d', 'd'), commit('c', 'd'), commit('e', 'd')], known).map(c => c.sha[0])).toEqual(['d', 'e'])
  })

  test('a title that already exists is dropped, however it is cased or punctuated, and so is a repeat within the list', () => {
    expect(titleKey('  Add CSV export! ')).toBe('add csv export')
    const { kept, dropped } = dropDuplicateTitles(
      [{ title: 'Add CSV export.' }, { title: 'Fix login' }, { title: 'fix  LOGIN' }],
      ['Add CSV Export']
    )
    expect(kept).toEqual([{ title: 'Fix login' }])
    expect(dropped).toHaveLength(2)
  })

  test('chunking keeps order and sizes', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('git', () => {
  test('commits are listed oldest first within --since, and a root commit diffs against the empty tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helpbites-cli-test-'))
    const cwd = process.cwd()
    const run = (args: string[], date?: string) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) }
    })
    try {
      run(['init', '-q'])
      const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()
      for (const [name, daysAgo] of [['old', 40], ['mid', 5], ['new', 1]] as const) {
        writeFileSync(join(dir, `${name}.txt`), `${name}\n`)
        run(['add', '-A'])
        run(['commit', '-q', '-m', `add ${name}`, '-m', `body of ${name}`], day(daysAgo))
      }
      process.chdir(dir)

      const recent = listCommits(parseSince('1w'))
      expect(recent.map(c => c.subject)).toEqual(['add mid', 'add new'])
      expect(recent[0].body).toBe('body of mid')
      expect(listCommits(parseSince('3m'))).toHaveLength(3)
      expect(listCommits(parseSince(recent[0].sha)).map(c => c.subject)).toEqual(['add new'])

      const all = listCommits(parseSince('3m'))
      expect(collectCommitsContext(all).diff).toContain('old.txt')
      expect(collectCommitsContext(all.slice(1)).diff).not.toContain('old.txt')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('secrets never reach the diff or the new-file text, and are named so the commit can be refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helpbites-cli-test-'))
    const cwd = process.cwd()
    const run = (args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' })
    try {
      run(['init', '-q'])
      writeFileSync(join(dir, '.env'), 'TOKEN=old-leaked-value\n')
      writeFileSync(join(dir, 'app.ts'), 'export const a = 1\n')
      run(['add', '-A'])
      run(['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.env'), 'TOKEN=tracked-leaked-value\n')
      writeFileSync(join(dir, 'app.ts'), 'export const a = 2\n')
      writeFileSync(join(dir, '.env.local'), 'TOKEN=untracked-leaked-value\n')
      mkdirSync(join(dir, 'certs'))
      writeFileSync(join(dir, 'certs', 'site.pem'), 'pem-leaked-value\n')
      writeFileSync(join(dir, 'notes.ts'), 'export const fine = true\n')
      process.chdir(dir)

      const context = collectWorktreeContext()
      const sent = `${context.stat}${context.diff}${context.untracked}`
      expect(sent).not.toMatch(/leaked-value/)
      expect(context.diff).toContain('app.ts')
      expect(context.untracked).toContain('export const fine = true')
      expect([...context.sensitive].sort()).toEqual(['.env', '.env.local', 'certs/site.pem'])
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('parseCommits reads the log format', () => {
    const raw = `${sha('a')}\x1f2026-09-01T10:00:00+02:00\x1fsubject\x1fa body\nover two lines\n\x1e\n${sha('b')}\x1f2026-09-02T10:00:00+02:00\x1fsecond\x1f\x1e\n`
    expect(parseCommits(raw)).toEqual([
      { sha: sha('a'), date: '2026-09-01T10:00:00+02:00', subject: 'subject', body: 'a body\nover two lines' },
      { sha: sha('b'), date: '2026-09-02T10:00:00+02:00', subject: 'second', body: '' }
    ])
  })
})
