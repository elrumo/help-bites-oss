// Releases from this machine instead of CI (docs/RELEASING.md):
//
//   bun scripts/release.mjs <X.Y.Z|patch|minor|major> [--only a,b] [--skip a,b] [--draft] [--dry-run] [--yes]
//
// Steps, in order: bump, test, commit (commit + tag + push), dockerhub, ghcr, github, changelog.
// --only runs just those, --skip drops some. Omit the version to reuse package.json's (the bump is then skipped), so a
// release that failed halfway resumes with e.g. `bun scripts/release.mjs --only dockerhub,ghcr,github,changelog`.
// The release commit says "[skip release]" so the tag push does not start .github/workflows/release.yml as well.
// Needs `docker login` (Docker Hub, and ghcr.io for ghcr), `gh auth login`, and the HELPBITES_* variables for changelog.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const STEPS = ['bump', 'test', 'commit', 'dockerhub', 'ghcr', 'github', 'changelog']
const IMAGE = 'elrumo/helpbites'
const root = fileURLToPath(new URL('..', import.meta.url))
const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: { only: { type: 'string' }, skip: { type: 'string' }, draft: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, yes: { type: 'boolean', short: 'y' } },
})
const dry = opt['dry-run']
const die = (message) => { console.error(message); process.exit(1) }
const read = name => readFileSync(join(root, name), 'utf8')
const sh = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim()
const run = (cmd, ...args) => {
  console.log(`$ ${[cmd, ...args].join(' ')}`)
  if (!dry) execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
}

const current = JSON.parse(read('package.json')).version
const [major, minor, patch] = current.split('.').map(Number)
const arg = positionals[0] || current
const version = { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[arg] ?? arg
if (!/^\d+\.\d+\.\d+$/.test(version)) die('Usage: bun scripts/release.mjs <X.Y.Z|patch|minor|major> [--only a,b] [--skip a,b] [--draft] [--dry-run] [--yes]')

const list = text => (text || '').split(',').map(s => s.trim()).filter(Boolean)
const [only, skip] = [list(opt.only), list(opt.skip)]
for (const step of [...only, ...skip]) if (!STEPS.includes(step)) die(`Unknown step "${step}". Steps: ${STEPS.join(', ')}`)
const steps = STEPS.filter(step => (!only.length || only.includes(step)) && !skip.includes(step) && (step !== 'bump' || version !== current))

console.log(`Release ${version} (package.json is ${current}): ${steps.join(', ') || 'nothing to do'}${dry ? ' [dry run]' : ''}`)
if (!steps.length) process.exit(0)
if (steps.includes('bump') && !dry && sh('git', 'status', '--porcelain')) die('The working tree has changes. Commit or stash them first: the release commit takes every tracked change.')
if (!dry && !opt.yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('This pushes to git, the registries and GitHub. Continue? [y/N] ')
  rl.close()
  if (!/^y/i.test(answer)) die('Cancelled.')
}

if (steps.includes('bump')) run('bun', 'scripts/bump-version.mjs', version)
if (steps.includes('test')) run('bun', 'test')

const tag = `v${version}`
if (steps.includes('commit')) {
  if (sh('git', 'status', '--porcelain')) run('git', 'commit', '-am', `Release ${version} [skip release]`)
  let tagged = true
  try { sh('git', 'rev-parse', '-q', '--verify', `refs/tags/${tag}`) } catch { tagged = false }
  if (!tagged) run('git', 'tag', tag)
  run('git', 'push')
  run('git', 'push', 'origin', tag)
}

const images = [['dockerhub', 'docker.io'], ['ghcr', 'ghcr.io']].filter(([step]) => steps.includes(step)).map(([, host]) => `${host}/${IMAGE}`)
if (images.length) {
  const tags = images.flatMap(image => [version, version.replace(/\.\d+$/, ''), 'latest'].map(t => ['-t', `${image}:${t}`]).flat())
  // Same build as CI: community edition, both architectures. The working tree is the context; .dockerignore drops .env.
  run('docker', 'buildx', 'build', '--platform', 'linux/amd64,linux/arm64', '--push',
    '--build-arg', 'HELPBITES_EDITION=community', '--build-arg', `GIT_SHA=${sh('git', 'rev-parse', 'HEAD')}`,
    '--label', 'org.opencontainers.image.licenses=AGPL-3.0-only', ...tags, '.')
  run('docker', 'run', '--rm', '--entrypoint', 'sh', `${images[0]}:${version}`, '-c', 'test ! -e /app/ee')
}

if (steps.includes('github')) {
  const section = read('CHANGELOG.md').split(/^## /m).find(s => new RegExp(`^${version.replace(/\./g, '\\.')}\\b`).test(s))
  if (!section && !dry) die(`CHANGELOG.md has no section for ${version}.`)
  const beta = read('shared/version.ts').includes("RELEASE_STAGE: 'beta' | null = 'beta'")
  const notes = join(tmpdir(), `helpbites-${version}-notes.md`)
  writeFileSync(notes, `Image: \`docker pull ${IMAGE}:${version}\`\n\n${(section || '').split('\n').slice(1).join('\n').trim()}\n`)
  run('gh', 'release', 'create', tag, '--title', `HelpBites ${version}${beta ? ' (beta)' : ''}`, '--notes-file', notes, '--verify-tag', ...(beta ? ['--prerelease'] : []))
}

if (steps.includes('changelog')) {
  if (!['HELPBITES_URL', 'HELPBITES_ADMIN_KEY', 'HELPBITES_PROJECT'].every(name => process.env[name])) console.warn('HELPBITES_URL, HELPBITES_ADMIN_KEY or HELPBITES_PROJECT is not set: the changelog script will do nothing.')
  run('bun', 'scripts/publish-changelog.mjs', '--version', version, ...(opt.draft ? ['--draft'] : []))
}

console.log(dry ? 'Dry run: nothing was changed.' : `Released ${version}.`)
