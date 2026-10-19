#!/usr/bin/env bun
// helpbites: run inside any git repo to turn its changes into entries on a
// HelpBites project's changelog. See README.md next to this file.
//
//   helpbites changelog                 uncommitted work → commit + changelog entries
//   helpbites changelog --since 2w      commits of the last 2 weeks (7d, 2w, 3m, a date, a git ref)
//
// Never pushes. A commit that already has an entry is never written up twice.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import {
  BATCH_MAX,
  DEFAULT_CHUNK,
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_TIMEOUT_MS,
  HISTORY_SCHEMA,
  WORKTREE_SCHEMA,
  buildHistoryPrompt,
  buildWorktreePrompt,
  chunk,
  collectCommitsContext,
  collectWorktreeContext,
  dropDuplicateTitles,
  formatCommitMessage,
  git,
  knownShas,
  listCommits,
  parseArgs,
  parseSince,
  runChangelogModel,
  systemPrompt,
  truncateDiff,
  unseenCommits,
  validateHistoryPayload,
  validateWorktreePayload
} from './lib.mjs'

const HELP = `helpbites changelog [options]

  (no --since)     read the uncommitted work, preview, then commit it and publish its entries
  --since <when>   write up commits not yet in the changelog: 7d, 2w, 3m, a date (2026-09-01) or a git ref (v1.2)
                   entries are drafts unless --publish

  --draft | --publish   entry status (default: published for uncommitted work, draft for --since)
  --dry-run             run the model and show everything; change nothing
  --yes, -y             skip the confirmation prompt
  --message <text>      use this as the commit subject
  --model <name>        default mimo-v2.6-pro (falls back to claude, then codex)
  --max-diff-bytes <n>  default ${DEFAULT_MAX_DIFF_BYTES}      --timeout <ms>  default ${DEFAULT_TIMEOUT_MS}      --chunk <n>  commits per model call, default ${DEFAULT_CHUNK}

  --url <https://…>     HELPBITES_URL, or "url" in .helpbites.json
  --key <ak_…>          HELPBITES_ADMIN_KEY (panel: sidebar → API keys). Prefer the env var.
  --project <ref>       HELPBITES_PROJECT or "project" in .helpbites.json: id, public key, slug or name`

// ---- output ------------------------------------------------------------------------

const style = code => text => `\x1b[${code}m${text}\x1b[0m`
const bold = style(1)
const dim = style(2)
const red = style(31)
const green = style(32)
const yellow = style(33)

function fail(message) {
  console.error(`\n${red('✗')} ${message}\n`)
  process.exit(1)
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

async function confirm(question, yes) {
  if (yes) return true
  // A non-interactive run that was not told --yes must not change anything on its own.
  if (!process.stdin.isTTY) fail('Not a terminal and --yes was not passed, so nothing was changed.')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`\n${question} [y/N] `)).trim().toLowerCase()
  rl.close()
  return answer === 'y' || answer === 'yes'
}

// ---- config and the API ----------------------------------------------------------------

function loadConfig(args) {
  const file = join(git(['rev-parse', '--show-toplevel']), '.helpbites.json')
  let saved = {}
  if (existsSync(file)) {
    try {
      saved = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      fail(`${file} is not valid JSON: ${error.message}`)
    }
  }
  return {
    url: String(args.values.url || process.env.HELPBITES_URL || saved.url || '').replace(/\/+$/, ''),
    key: String(args.values.key || process.env.HELPBITES_ADMIN_KEY || ''),
    project: String(args.values.project || process.env.HELPBITES_PROJECT || saved.project || ''),
    product: saved.product,
    voice: saved.voice,
    internal: Array.isArray(saved.internal) ? saved.internal.map(String) : []
  }
}

function client(base, key) {
  return async function api(pathname, { method = 'GET', body } = {}) {
    let res
    try {
      res = await fetch(`${base}${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      })
    } catch (error) {
      throw new Error(`Could not reach HelpBites at ${base}: ${error.message}`)
    }
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const error = new Error(res.status === 401
        ? 'HelpBites rejected the API key (401). Make one in the panel: sidebar → API keys.'
        : `${method} ${pathname} → ${res.status} ${json.statusMessage || json.message || ''}`.trim())
      error.status = res.status
      throw error
    }
    return json
  }
}

async function resolveProject(api, ref) {
  const { projects } = await api('/v1/admin/projects')
  const wanted = ref.toLowerCase()
  const found = projects.find(p => p.id === ref || p.publicKey === ref || p.slug === wanted || p.name.toLowerCase() === wanted)
  if (!found) throw new Error(`No project "${ref}". Yours: ${projects.map(p => `${p.name} (${p.id})`).join(', ') || 'none'}.`)
  return found
}

/** Before any model call or git write: the server is reachable, the key and project are right, and what the changelog already holds. */
async function preflight(config) {
  if (!config.url) fail('Set the HelpBites URL: --url, HELPBITES_URL, or "url" in .helpbites.json.')
  if (!config.key) fail('Set HELPBITES_ADMIN_KEY to an admin API key (panel: sidebar → API keys).')
  if (!config.project) fail('Set the project: --project, HELPBITES_PROJECT, or "project" in .helpbites.json.')
  const api = client(config.url, config.key)
  try {
    const project = await resolveProject(api, config.project)
    const { entries } = await api(`/v1/admin/changelog/entries?project=${encodeURIComponent(project.id)}`)
    return { api, project, existing: entries }
  } catch (error) {
    if (error.status === 404) fail('This HelpBites server has no changelog API yet (GET /v1/admin/changelog/entries returned 404). Deploy a version that has it.')
    return fail(error.message)
  }
}

/** POST in batches of 50. The server skips entries whose commit is already cited, so a re-send is harmless. */
async function post({ api, project }, entries) {
  const totals = { created: 0, skipped: [], failed: [] }
  for (const batch of chunk(entries, BATCH_MAX)) {
    const result = await api(`/v1/admin/changelog/entries/batch?project=${encodeURIComponent(project.id)}`, { method: 'POST', body: { entries: batch } })
    totals.created += result.created.length
    totals.skipped.push(...result.skipped.map(item => ({ ...item, title: batch[item.index].title })))
    totals.failed.push(...result.failed.map(item => ({ ...item, entry: batch[item.index] })))
  }
  return totals
}

function report(totals) {
  console.log(`${green('✓')} Added ${plural(totals.created, 'changelog entry', 'changelog entries')}.`)
  for (const item of totals.skipped) console.log(`${yellow('!')} Skipped "${item.title}": commit ${item.commitSha.slice(0, 10)} is already in entry ${item.entryId}.`)
  for (const item of totals.failed) {
    console.error(`${red('✗')} "${item.entry.title}" was not added: ${item.message}`)
    console.error(dim(item.entry.body.split('\n').map(line => `    ${line}`).join('\n')))
  }
}

// ---- preview ---------------------------------------------------------------------------

function previewEntries(entries, status) {
  console.log(`\n${bold(`Changelog entries (${entries.length})`)}${dim(` — as ${status}`)}`)
  if (!entries.length) console.log(dim('  none — nothing here is user-facing'))
  for (const entry of entries) {
    console.log(`\n  ${bold(`[${entry.tag}]`)} ${entry.title}${entry.commitShas ? dim(`  ${entry.publishedAt.slice(0, 10)} · ${plural(entry.commitShas.length, 'commit', 'commits')}`) : ''}`)
    const lines = entry.body.split('\n')
    for (const line of lines.slice(0, 4)) console.log(`    ${dim(line)}`)
    if (lines.length > 4) console.log(dim('    …'))
  }
}

function noteDuplicates(dropped) {
  for (const entry of dropped) console.log(`${yellow('!')} Left out "${entry.title}": an entry with that title already exists.`)
}

// ---- uncommitted work -------------------------------------------------------------------

async function worktree(args, config) {
  const status = args.flags.has('draft') ? 'draft' : 'published'
  if (!git(['status', '--porcelain=v1']).trim()) {
    console.log(`${green('✓')} Working tree is clean: nothing to commit. To cover commits already made, use ${bold('--since')} (e.g. --since 1w).`)
    return
  }

  const target = await preflight(config)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }) || 'HEAD'
  const context = collectWorktreeContext()
  const maxDiffBytes = Number(args.values['max-diff-bytes'] || DEFAULT_MAX_DIFF_BYTES)
  const truncation = truncateDiff(context.diff, maxDiffBytes)

  const model = args.values.model || 'mimo-v2.6-pro'
  console.log(dim(`Asking ${model} to read ${truncation.total} changed file(s)…`))
  const generated = await runChangelogModel(
    buildWorktreePrompt({ ...context, diff: truncation.text, branch }, config),
    { schema: WORKTREE_SCHEMA, model, systemPrompt: systemPrompt(config), timeoutMs: Number(args.values.timeout || DEFAULT_TIMEOUT_MS) }
  ).catch(error => fail(error.message))

  let payload
  try {
    payload = validateWorktreePayload(generated.payload)
  } catch (error) {
    fail(`${error.message}\n\nNothing was committed.`)
  }
  console.log(dim(`Generated with ${generated.provider}.`))
  if (args.values.message) payload.commit.subject = args.values.message

  const { kept, dropped } = dropDuplicateTitles(payload.entries, target.existing.map(entry => entry.title))

  console.log(`\n${bold('Branch')}   ${branch}`)
  console.log(`${bold('Files')}    ${context.files.length} staged by \`git add -A\``)
  for (const file of context.files) console.log(`  ${dim(file)}`)
  if (truncation.truncated) console.log(yellow(`\n! diff truncated: ${truncation.includedInFull} of ${truncation.total} files sent in full`))
  if (context.sensitive.length) console.log(red(`\n! These look like secrets and \`git add -A\` would commit them: ${context.sensitive.join(', ')}`))
  console.log(`\n${bold('Commit message')}\n  ${payload.commit.subject}`)
  for (const line of payload.commit.body.split('\n').filter(Boolean)) console.log(`  ${dim(line)}`)
  previewEntries(kept, status)
  noteDuplicates(dropped)

  if (args.flags.has('dry-run')) return console.log(`\n${dim('--dry-run: nothing committed, nothing posted.')}\n`)
  if (context.sensitive.length && args.flags.has('yes')) fail('Refusing to commit files that look like secrets with --yes. Add them to .gitignore, or run without --yes and confirm.\n\nNothing was committed.')
  if (!await confirm(`Commit ${plural(context.files.length, 'file', 'files')}${kept.length ? ` and ${status === 'draft' ? 'add' : 'publish'} ${plural(kept.length, 'entry', 'entries')}` : ''}?`, args.flags.has('yes'))) {
    return console.log(`\n${dim('Cancelled: nothing committed.')}\n`)
  }

  git(['add', '-A'])
  // The message goes in on stdin so quoting and backticks cannot bite.
  execFileSync('git', ['commit', '-F', '-'], { input: formatCommitMessage(payload.commit), encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] })
  console.log(`\n${green('✓')} Committed.`)
  if (!kept.length) return console.log(`${dim('Nothing user-facing in this change: no changelog entries added.')}\n`)

  // The entries wear the commit's author date, not the clock at post time.
  const [sha, authoredAt] = git(['log', '-1', '--format=%H%n%aI']).split('\n')
  const stamp = { commitShas: [sha], publishedAt: new Date(authoredAt).toISOString(), status }
  try {
    const totals = await post(target, kept.map(entry => ({ ...entry, ...stamp })))
    report(totals)
    if (totals.failed.length) process.exit(2)
    console.log()
  } catch (error) {
    console.error(`\n${yellow('!')} The commit landed but the entries did not post: ${error.message}`)
    console.error(`  Fix that, then write the commit up with: ${bold(`helpbites changelog --since HEAD~1${status === 'draft' ? '' : ' --publish'}`)}\n`)
    process.exit(2)
  }
}

// ---- history ----------------------------------------------------------------------------

async function history(args, config) {
  const since = parseSince(args.values.since)
  const status = args.flags.has('publish') ? 'published' : 'draft'
  const target = await preflight(config)

  const commits = listCommits(since)
  const fresh = unseenCommits(commits, knownShas(target.existing))
  console.log(`${plural(commits.length, 'commit', 'commits')} in ${since.label}; ${commits.length - fresh.length} already in the changelog.`)
  if (!fresh.length) return console.log(`${green('✓')} Nothing new to write up.`)

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }) || 'HEAD'
  const model = args.values.model || 'mimo-v2.6-pro'
  const size = Number(args.values.chunk || DEFAULT_CHUNK)
  if (!Number.isInteger(size) || size < 1) fail('--chunk needs a whole number above zero.')
  const chunks = chunk(fresh, size)

  const entries = []
  for (const [index, commitsOfChunk] of chunks.entries()) {
    console.log(dim(`[${index + 1}/${chunks.length}] Asking ${model} about ${plural(commitsOfChunk.length, 'commit', 'commits')}…`))
    const context = collectCommitsContext(commitsOfChunk)
    const truncation = truncateDiff(context.diff, Number(args.values['max-diff-bytes'] || DEFAULT_MAX_DIFF_BYTES))
    const generated = await runChangelogModel(
      buildHistoryPrompt({ commits: commitsOfChunk, stat: context.stat, diff: truncation.text, branch }, config),
      { schema: HISTORY_SCHEMA, model, systemPrompt: systemPrompt(config), timeoutMs: Number(args.values.timeout || DEFAULT_TIMEOUT_MS) }
    ).catch(error => fail(error.message))
    let result
    try {
      result = validateHistoryPayload(generated.payload, commitsOfChunk)
    } catch (error) {
      fail(`${error.message}\n\nNothing was added.`)
    }
    for (const title of result.dropped) console.log(`${yellow('!')} Left out "${title}": it cites no commit from the list.`)
    entries.push(...result.entries)
  }

  const { kept, dropped } = dropDuplicateTitles(entries, target.existing.map(entry => entry.title))
  previewEntries(kept, status)
  noteDuplicates(dropped)
  if (!kept.length) return console.log(`\n${dim('Nothing user-facing in these commits: no entries added.')}\n`)

  if (args.flags.has('dry-run')) return console.log(`\n${dim('--dry-run: nothing posted.')}\n`)
  if (!await confirm(`${status === 'draft' ? 'Add' : 'Publish'} ${plural(kept.length, 'entry', 'entries')}?`, args.flags.has('yes'))) return console.log(`\n${dim('Cancelled: nothing posted.')}\n`)

  try {
    const totals = await post(target, kept.map(entry => ({ ...entry, status })))
    report(totals)
    if (totals.failed.length) process.exit(2)
    console.log()
  } catch (error) {
    fail(`${error.message}\n  Nothing is lost: run the same command again; commits already written up are skipped.`)
  }
}

// ---- main ---------------------------------------------------------------------------------

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    return fail(error.message)
  }
  if (args.flags.has('help') || !args._.length) return console.log(HELP)
  if (args._[0] !== 'changelog' || args._.length > 1) return fail(`Unknown command "${args._.join(' ')}". Try: helpbites changelog --help`)
  if (args.flags.has('draft') && args.flags.has('publish')) return fail('Pass --draft or --publish, not both.')

  git(['rev-parse', '--is-inside-work-tree'])
  const config = loadConfig(args)
  return args.values.since === undefined ? await worktree(args, config) : await history(args, config)
}

main().catch(error => fail(error.message))
