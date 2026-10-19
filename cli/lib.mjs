// The parts of `helpbites changelog` worth testing on their own: diff budgeting,
// reading what a model hands back, validating it, and the duplicate checks. Git
// and the model CLIs sit at the bottom.

import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHANGELOG_TAGS } from '../shared/changelog'
import { FEEDBACK_BODY_MAX_LENGTH, FEEDBACK_TITLE_MAX_LENGTH } from '../shared/feedback'

export const DEFAULT_MAX_DIFF_BYTES = 120_000
export const DEFAULT_TIMEOUT_MS = 300_000
export const DEFAULT_CHUNK = 30
/** What the server takes in one POST …/entries/batch. */
export const BATCH_MAX = 50
const MAX_UNTRACKED_BYTES = 20_000
const MAX_UNTRACKED_TOTAL_BYTES = 60_000
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Paths whose contents are never worth sending to a model: huge, generated, or secret. */
export const EXCLUDED_PATHSPECS = [
  ':(exclude)*.lock',
  ':(exclude)pnpm-lock.yaml',
  ':(exclude)bun.lockb',
  ':(exclude)package-lock.json',
  ':(exclude)*.min.*',
  ':(exclude)*.map',
  ':(exclude).env*',
  ':(exclude)*/.env*',
  ':(exclude)*.pem',
  ':(exclude)*.key',
  ':(exclude)*.p12'
]

// Matched before an untracked file is read off disk: `git ls-files --others` lists key material happily.
const SECRET_PATTERNS = [/(^|\/)\.env/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /secret/i, /credential/i]

export function isSensitivePath(path) {
  return SECRET_PATTERNS.some(pattern => pattern.test(path))
}

// ---- arguments -----------------------------------------------------------------

const BOOLEAN_FLAGS = new Set(['yes', 'draft', 'publish', 'dry-run', 'help'])
const VALUE_FLAGS = new Set(['since', 'message', 'model', 'max-diff-bytes', 'timeout', 'chunk', 'url', 'key', 'project'])

/** `{ _: positionals, flags: Set, values: {} }`. Unknown options are an error, so a typo never becomes a silent value. */
export function parseArgs(argv) {
  const args = { _: [], flags: new Set(), values: {} }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-y') args.flags.add('yes')
    else if (arg === '-h') args.flags.add('help')
    else if (!arg.startsWith('--')) args._.push(arg)
    else {
      const [name, inline] = arg.slice(2).split(/=(.*)/s)
      if (BOOLEAN_FLAGS.has(name)) args.flags.add(name)
      else if (VALUE_FLAGS.has(name)) {
        const value = inline ?? argv[++i]
        if (value === undefined) throw new Error(`--${name} needs a value`)
        args.values[name] = value
      } else throw new Error(`Unknown option --${name}`)
    }
  }
  return args
}

/**
 * `7d`, `2w`, `3m` (days, weeks, months), a date (`2026-09-01`), or a git ref
 * (`v1.2`, `abc123`: its commits up to HEAD). Returns the `git log` arguments.
 */
export function parseSince(value) {
  const text = String(value || '').trim()
  if (!text || text.startsWith('-')) throw new Error(`--since needs 7d, 2w, 3m, a date or a git ref (got "${text}")`)
  const relative = text.match(/^(\d+)\s*([dwm])$/i)
  if (relative) {
    const count = Number(relative[1])
    if (!count) throw new Error('--since needs a number above zero')
    const unit = { d: 'day', w: 'week', m: 'month' }[relative[2].toLowerCase()] + (count === 1 ? '' : 's')
    return { args: [`--since=${count} ${unit} ago`], label: `the last ${count} ${unit}` }
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return { args: [`--since=${text}`], label: `since ${text}` }
  return { args: [`${text}..HEAD`], label: `${text}..HEAD` }
}

// ---- diffs ---------------------------------------------------------------------

/** A unified diff split per file: `[{ path, text }]`, in order. */
export function splitDiffByFile(diff) {
  if (!diff) return []
  const files = []
  let current = null
  for (const line of diff.split('\n')) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (header) {
      if (current) files.push(current)
      current = { path: header[2], lines: [line] }
    } else if (current) current.lines.push(line)
  }
  if (current) files.push(current)
  return files.map(file => ({ path: file.path, text: file.lines.join('\n') }))
}

/**
 * Keeps a diff under `maxBytes` without one enormous file crowding out every
 * small, meaningful edit: each file gets an equal share, what small files do not
 * use goes to the large ones, and a file that still does not fit is truncated,
 * never dropped. (`maxBytes` counts characters.)
 */
export function truncateDiff(diff, maxBytes = DEFAULT_MAX_DIFF_BYTES) {
  const files = splitDiffByFile(diff)
  if (!files.length) return { text: '', includedInFull: 0, total: 0, truncated: false }
  const totalBytes = files.reduce((sum, file) => sum + file.text.length, 0)
  if (totalBytes <= maxBytes) return { text: diff, includedInFull: files.length, total: files.length, truncated: false }

  const share = Math.floor(maxBytes / files.length)
  const small = files.filter(file => file.text.length <= share)
  const large = files.filter(file => file.text.length > share)
  const largeShare = large.length ? Math.floor((maxBytes - small.reduce((sum, file) => sum + file.text.length, 0)) / large.length) : 0

  let includedInFull = 0
  const parts = files.map((file) => {
    const budget = file.text.length <= share ? file.text.length : largeShare
    if (file.text.length <= budget) {
      includedInFull++
      return file.text
    }
    const kept = file.text.slice(0, Math.max(budget, 200))
    return `${kept}\n… [${file.path}: ${file.text.length - kept.length} more bytes omitted]`
  })
  return { text: `[diff truncated: ${includedInFull} of ${files.length} files included in full]\n\n${parts.join('\n')}`, includedInFull, total: files.length, truncated: true }
}

// ---- commits and duplicates ------------------------------------------------------

/** Output of `git log --format=%H%x1f%aI%x1f%s%x1f%b%x1e` as `[{ sha, date, subject, body }]`. */
export function parseCommits(raw) {
  return raw.split('\x1e').map(record => record.trim()).filter(Boolean).map((record) => {
    const [sha, date, subject, body = ''] = record.split('\x1f')
    return { sha, date, subject, body: body.trim() }
  })
}

export function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Every commit SHA the project's entries already cite. */
export const knownShas = entries => new Set(entries.flatMap(entry => entry.commitShas || []))

export const unseenCommits = (commits, known) => commits.filter(commit => !known.has(commit.sha))

export const titleKey = title => String(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Entries whose title matches an existing one (or an earlier one in the list) are dropped: a second guard for rewritten history, where SHAs no longer match. */
export function dropDuplicateTitles(entries, existingTitles) {
  const seen = new Set(existingTitles.map(titleKey))
  const kept = []
  const dropped = []
  for (const entry of entries) {
    const key = titleKey(entry.title)
    if (seen.has(key)) dropped.push(entry)
    else {
      seen.add(key)
      kept.push(entry)
    }
  }
  return { kept, dropped }
}

// ---- reading and validating the model's answer ---------------------------------------

const modelError = event => new Error(`Model reported an error: ${event.error?.data?.message || event.error?.name || 'unknown'}`)

/**
 * The answer inside whatever the model CLI printed: the `claude` JSON envelope
 * (`result` is an object, a JSON string, or one in a ```json fence), or a stream
 * of JSON events (`mimo --format json`), whose last payload is the answer.
 */
export function parseClaudeJson(stdout) {
  const parse = text => JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  const from = (value) => {
    if (typeof value === 'string') {
      try {
        return parse(value)
      } catch {
        throw new Error(`Model returned text rather than JSON:\n${value.slice(0, 400)}`)
      }
    }
    if (!value || typeof value !== 'object') return null
    if (value.is_error) throw new Error(`Claude reported an error: ${value.result || value.subtype || 'unknown'}`)
    if (value.type === 'error') throw modelError(value)
    if (value.result !== undefined) return value.result && typeof value.result === 'object' ? value.result : from(value.result)
    for (const child of [...Object.values(value)].reverse()) {
      try {
        const found = from(child)
        if (found) return found
      } catch { /* event metadata is not the answer */ }
    }
    return null
  }

  let parsed
  try {
    parsed = parse(stdout)
  } catch {
    for (const line of stdout.trim().split('\n').reverse()) {
      let event
      try { event = JSON.parse(line) } catch { continue }
      // A failed call (e.g. 402 insufficient balance) exits 0 with an error event: surface it so the next provider runs.
      if (event?.type === 'error') throw modelError(event)
      try {
        const found = from(event)
        if (found) return found
      } catch { /* try the preceding event */ }
    }
    throw new Error('Model did not return JSON. Re-run with --message to write the commit yourself.')
  }
  return from(parsed) || parsed
}

function cleanEntry(entry, where) {
  const title = String(entry?.title || '').trim()
  const body = String(entry?.body || '').trim()
  if (!title) throw new Error(`${where}.title is empty.`)
  if (!body) throw new Error(`${where}.body is empty.`)
  if (title.length > FEEDBACK_TITLE_MAX_LENGTH) throw new Error(`${where}.title is ${title.length} chars; the limit is ${FEEDBACK_TITLE_MAX_LENGTH}.`)
  if (body.length > FEEDBACK_BODY_MAX_LENGTH) throw new Error(`${where}.body is ${body.length} chars; the limit is ${FEEDBACK_BODY_MAX_LENGTH}.`)
  if (!CHANGELOG_TAGS.includes(entry?.tag)) throw new Error(`${where}.tag is "${entry?.tag}"; expected one of ${CHANGELOG_TAGS.join(', ')}.`)
  return { title, body, tag: entry.tag }
}

function entriesOf(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Expected an object with `entries`.')
  if (payload.entries !== undefined && !Array.isArray(payload.entries)) throw new Error('`entries` must be an array.')
  return payload.entries || []
}

/**
 * `{ commit, entries }` or a throw: nothing is committed on a bad payload. An
 * empty `entries` is valid and expected for a refactor, a test-only change or a
 * dependency bump.
 */
export function validateWorktreePayload(payload) {
  const entries = entriesOf(payload)
  const subject = String(payload.commit?.subject || '').trim()
  if (!subject) throw new Error('Missing commit.subject.')
  if (subject.length > 72) throw new Error(`Commit subject is ${subject.length} chars; the limit is 72.`)
  return {
    commit: { subject, body: String(payload.commit?.body || '').trim() },
    entries: entries.map((entry, index) => cleanEntry(entry, `entries[${index}]`))
  }
}

/**
 * The history answer: entries that each cite the commits they describe. A cite
 * resolves by prefix against `commits` (the model sees 10-character ids); one
 * that matches nothing is ignored, and an entry left with no commit is dropped,
 * because without a commit the server cannot recognise it next time.
 * Returns `{ entries: [{ title, body, tag, commitShas, publishedAt }], dropped: [title] }`.
 */
export function validateHistoryPayload(payload, commits) {
  const entries = []
  const dropped = []
  entriesOf(payload).forEach((raw, index) => {
    const entry = cleanEntry(raw, `entries[${index}]`)
    const cited = [...new Set((Array.isArray(raw.commits) ? raw.commits : []).map(id => String(id).trim().toLowerCase()).filter(id => id.length >= 7))]
    const matched = commits.filter(commit => cited.some(id => commit.sha.startsWith(id)))
    if (!matched.length) return dropped.push(entry.title)
    const newest = Math.max(...matched.map(commit => new Date(commit.date).getTime()))
    entries.push({ ...entry, commitShas: matched.map(commit => commit.sha), publishedAt: new Date(newest).toISOString() })
  })
  return { entries, dropped }
}

/** Full commit message for `git commit -F -`. */
export function formatCommitMessage(commit) {
  return commit.body ? `${commit.subject}\n\n${commit.body}\n` : `${commit.subject}\n`
}

// ---- prompts -------------------------------------------------------------------------

const ENTRY_PROPERTIES = {
  title: { type: 'string', maxLength: 100 },
  body: { type: 'string', maxLength: 4000 },
  tag: { enum: CHANGELOG_TAGS }
}

export const WORKTREE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['commit', 'entries'],
  properties: {
    commit: {
      type: 'object',
      additionalProperties: false,
      required: ['subject'],
      properties: { subject: { type: 'string', maxLength: 72 }, body: { type: 'string', maxLength: 2000 } }
    },
    entries: {
      type: 'array',
      maxItems: 5,
      items: { type: 'object', additionalProperties: false, required: ['title', 'body', 'tag'], properties: ENTRY_PROPERTIES }
    }
  }
}

export const HISTORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['entries'],
  properties: {
    entries: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'body', 'tag', 'commits'],
        properties: { ...ENTRY_PROPERTIES, commits: { type: 'array', minItems: 1, items: { type: 'string' } } }
      }
    }
  }
}

/** `config` is the repo's .helpbites.json: `product`, `voice`, `internal` (path prefixes). */
export function systemPrompt({ product, voice } = {}) {
  return [
    `You write release notes for ${product || 'a software product'}.`,
    `Voice: ${voice || 'plain and direct, as the person who builds it'}.`,
    'Be concrete: say what changed and why it matters to someone using the product.',
    'No marketing adjectives, no "we are excited to announce", no exclamation marks.'
  ].join(' ')
}

function entryRules({ internal = [] } = {}, max) {
  return `   - Only include a change a person using the product would notice. Refactors, tests, tooling, dependency bumps, regenerated translations, internal cleanups and admin-only changes get NO entry.
   - It is correct and expected to return an empty \`entries\` array for a change that is entirely internal. Do not invent one.${internal.length ? `\n   - A change that only touches these paths is internal, even if it looks like a feature: ${internal.map(path => `\`${path}\``).join(', ')}.` : ''}
   - One entry per distinct change, at most ${max}. Do not split one feature into several entries.
   - \`body\` is markdown, no heading above \`###\`, no raw HTML (it is published as is), a short paragraph or two.
   - \`title\` follows Common Changelog (https://common-changelog.org §2.4.1): imperative mood, starting with a present-tense verb: "Add depth-map relief to clay", not "Depth-map relief in clay". It must be self-describing, i.e. readable with no category heading above it: "Support CentOS", never "Support of CentOS".
   - \`tag\` maps onto Common Changelog's categories. Pick the effect on the reader, not the size of the diff:
     - new = Added (something that did not exist)
     - improved = Changed (existing behaviour is different)
     - removed = Removed (something is gone)
     - fix = Fixed (something was broken and now works)
     - breaking = a change callers must act on. Prefer this over \`improved\` whenever existing code, files or workflows stop working unchanged, and say so in the title.`
}

const fence = (heading, text, lang = '') => `## ${heading}\n\`\`\`${lang}\n${text}\n\`\`\`\n`

export function buildWorktreePrompt({ status, stat, diff, untracked, branch }, config) {
  return `Here is the uncommitted work in a repository on branch \`${branch}\`.

Return JSON with two things:

1. \`commit\`: a conventional-commit subject (\`feat:\`, \`fix:\`, \`refactor:\`, \`chore:\`, \`docs:\`, \`test:\`) of at most 72 characters, plus an optional body explaining the why when it is not obvious.

2. \`entries\`: public changelog entries, one per user-facing change.
${entryRules(config, 5)}

${fence('git status', status || '(clean)')}
${fence('git diff --stat', stat || '(none)')}${untracked ? `\n${fence('New files', untracked)}` : ''}
${fence('git diff', diff || '(none)', 'diff')}`
}

export function buildHistoryPrompt({ commits, stat, diff, branch }, config) {
  const list = commits.map((commit) => {
    const body = commit.body.replace(/\s+/g, ' ').slice(0, 400)
    return `- ${commit.sha.slice(0, 10)} ${commit.date.slice(0, 10)} ${commit.subject}${body ? `\n    ${body}` : ''}`
  }).join('\n')
  return `Here are ${commits.length} commits from a repository on branch \`${branch}\`, oldest first, and the combined diff of all of them.

Return JSON with \`entries\`: public changelog entries, one per user-facing change.
${entryRules(config, 20)}
   - \`commits\` lists the commits above (their 10-character ids) that the entry describes. Every entry needs at least one. A commit may appear in several entries, and a commit with no user-facing change appears in none.

${fence('Commits', list)}
${fence('git diff --stat', stat || '(none)')}
${fence('git diff', diff || '(none)', 'diff')}`
}

// ---- git -------------------------------------------------------------------------------

export function git(args, { allowFail = false, input } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input, stdio: ['pipe', 'pipe', 'pipe'] }).trimEnd()
  } catch (error) {
    if (allowFail) return ''
    throw new Error(`git ${args.join(' ')} failed: ${String(error.stderr || error.message).trim()}`)
  }
}

const withoutBinary = diff => diff.replace(/^Binary files .* differ$/gm, '[binary file omitted]')

/** The uncommitted work: status, stat, the diff against HEAD, and the contents of new files (git diff cannot see them). */
export function collectWorktreeContext() {
  const status = git(['status', '--porcelain=v1'])
  const stat = git(['diff', '--stat', 'HEAD'], { allowFail: true })
  const diff = withoutBinary(git(['diff', 'HEAD', '--', '.', ...EXCLUDED_PATHSPECS], { allowFail: true }))
  const untrackedPaths = git(['ls-files', '--others', '--exclude-standard'], { allowFail: true }).split('\n').filter(Boolean)
  const untracked = untrackedPaths.map((path) => {
    if (isSensitivePath(path)) return `--- ${path}\n[skipped: looks like it holds credentials]`
    try {
      const contents = readFileSync(path, 'utf8')
      return contents.length > MAX_UNTRACKED_BYTES ? `--- ${path}\n${contents.slice(0, MAX_UNTRACKED_BYTES)}\n… [truncated]` : `--- ${path}\n${contents}`
    } catch {
      return `--- ${path}\n[binary or unreadable]`
    }
  }).join('\n\n')
  // A per-file cap alone is no cap when a whole new directory shows up.
  const cappedUntracked = untracked.length > MAX_UNTRACKED_TOTAL_BYTES ? `${untracked.slice(0, MAX_UNTRACKED_TOTAL_BYTES)}\n… [new files truncated]` : untracked
  // `git add -A` commits whatever is not gitignored: name what looks like a secret (status shows a new directory as one line, so list files).
  const changedPaths = [...git(['diff', '--name-only', 'HEAD'], { allowFail: true }).split('\n'), ...untrackedPaths].filter(Boolean)
  return { status, stat, diff, untracked: cappedUntracked, files: status.split('\n').filter(Boolean).map(line => line.slice(3)), sensitive: changedPaths.filter(isSensitivePath) }
}

/** Commits of a `parseSince` result, oldest first, merges left out. */
export function listCommits(since) {
  return parseCommits(git(['log', '--no-merges', '--reverse', '--format=%H%x1f%aI%x1f%s%x1f%b%x1e', ...since.args]))
}

/**
 * The net diff of a run of commits, oldest to newest. It also covers commits in
 * between that were left out as already written up; fine for a changelog.
 */
export function collectCommitsContext(commits) {
  const base = git(['rev-parse', '--verify', '--quiet', `${commits[0].sha}^`], { allowFail: true }) || EMPTY_TREE
  const last = commits[commits.length - 1].sha
  return {
    stat: git(['diff', '--stat', base, last], { allowFail: true }),
    diff: withoutBinary(git(['diff', base, last, '--', '.', ...EXCLUDED_PATHSPECS], { allowFail: true }))
  }
}

// ---- running a model CLI -----------------------------------------------------------------

function runCommand(command, args, { prompt, timeoutMs, cleanup = () => {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      callback(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(reject, new Error(`${command} did not answer within ${Math.round(timeoutMs / 1000)}s.`))
    }, timeoutMs)
    child.stdout.on('data', data => (stdout += data))
    child.stderr.on('data', data => (stderr += data))
    child.on('error', error => finish(reject, new Error(`Could not run \`${command}\`: ${error.message}`)))
    child.on('close', code => code === 0 ? finish(resolve, stdout) : finish(reject, new Error(`${command} exited ${code}: ${stderr.trim().slice(0, 500)}`)))
    child.stdin.end(prompt || '')
  })
}

/**
 * Flags for a headless `claude` call that strip what the CLI would stuff into
 * the context on each run (about 34k input tokens down to about 7k) and skip
 * connecting to every configured MCP server (13s versus minutes). Nothing here
 * needs a tool: the whole input arrives on stdin and the only output is JSON.
 */
function claudeArgs({ schema, model = 'sonnet', systemPrompt }) {
  return ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--model', model,
    '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config', '--tools', '', '--disable-slash-commands',
    '--setting-sources', '', '--system-prompt', systemPrompt]
}

function runMimo(prompt, { model, systemPrompt, timeoutMs }) {
  const directory = mkdtempSync(join(tmpdir(), 'helpbites-changelog-'))
  const promptPath = join(directory, 'prompt.md')
  writeFileSync(promptPath, `${systemPrompt}\n\n${prompt}`)
  // The message goes first: `--file` is an array flag and swallows every positional after it.
  const args = ['run', 'Read the attached prompt and return exactly the JSON it requests. Do not use tools.',
    '--pure', '--format', 'json', '--model', model.includes('/') ? model : `xiaomi/${model}`, '--file', promptPath]
  return runCommand('mimo', args, { timeoutMs, cleanup: () => rmSync(directory, { recursive: true, force: true }) })
}

/**
 * MiMo Pro, then Claude, then Codex, each through its local CLI; Claude first
 * when `model` is not a MiMo model (`claude` rejects those). Only `claude`
 * enforces the schema (`--json-schema`); the others get it in the prompt, or
 * they invent the shape.
 */
export async function runChangelogModel(prompt, { schema, model, systemPrompt, timeoutMs }) {
  const mimo = /mimo/i.test(model || '')
  const shaped = `${prompt}\n\nReply with only JSON that matches this JSON Schema:\n${JSON.stringify(schema)}`
  const providers = {
    mimo: ['MiMo Pro', () => runMimo(shaped, { model: mimo ? model : 'mimo-v2.6-pro', systemPrompt, timeoutMs })],
    claude: ['Claude', () => runCommand('claude', claudeArgs({ schema, model: mimo ? undefined : model, systemPrompt }), { prompt, timeoutMs })],
    codex: ['Codex', () => runCommand('codex', ['exec', '--sandbox', 'read-only', '--color', 'never', '-'], { prompt: `${systemPrompt}\n\n${shaped}`, timeoutMs })]
  }
  const order = mimo ? ['mimo', 'claude', 'codex'] : ['claude', 'codex', 'mimo']
  const failures = []
  for (const key of order) {
    const [name, run] = providers[key]
    try {
      return { provider: name, payload: parseClaudeJson(await run()) }
    } catch (error) {
      failures.push(`${name}: ${error.message}`)
      console.warn(`[helpbites] ${name} failed (${error.message.split('\n')[0].slice(0, 120)}); trying the next provider.`)
    }
  }
  throw new Error(`No changelog model succeeded. ${failures.join(' | ')}`)
}
