// Starts a release: bun scripts/bump-version.mjs 0.3.0   (docs/RELEASING.md)
// Sets the number in package.json and the native app's project.yml, files CHANGELOG.md's Unreleased bullets under
// "## <version> — <today>", and regenerates the Xcode project (needs XcodeGen). Review the diff, then commit and tag.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2] || ''
if (!/^\d+\.\d+\.\d+$/.test(version)) { console.error('Usage: bun scripts/bump-version.mjs <major.minor.patch>'); process.exit(1) }
const file = name => new URL(`../${name}`, import.meta.url)
const edit = (name, change) => writeFileSync(file(name), change(readFileSync(file(name), 'utf8')))

edit('package.json', text => text.replace(/("version": ")[^"]+/, `$1${version}`))
edit('helpbites-native/project.yml', text => text.replace(/(MARKETING_VERSION: ).+/, `$1${version}`))
edit('CHANGELOG.md', (text) => {
  if (new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(text)) throw new Error(`CHANGELOG.md already has ${version}`)
  return text.replace(/^## Unreleased\n\n?/m, `## Unreleased\n\n## ${version} — ${new Date().toISOString().slice(0, 10)}\n\n`)
})
try { execFileSync('xcodegen', ['generate'], { cwd: new URL('../helpbites-native', import.meta.url), stdio: 'inherit' }) }
catch { console.warn('XcodeGen not run: run `xcodegen generate` in helpbites-native/ before committing (the Xcode project holds the number too).') }
console.log(`Bumped to ${version}. Next: review CHANGELOG.md's new section, bun test, commit, git tag v${version}, git push --tags.`)
