// Archives the native app and uploads it to TestFlight: bun run testflight [ios] [macos] [--notes=<file>] [--dry-run]
// (no platform = both). --notes sets the file's text (at most 4000 characters) as each build's "What to Test", once
// App Store Connect lists the build (a few minutes). Needs Xcode and, in .env or the shell, an App Store Connect API key:
//   APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID,
//   APP_STORE_CONNECT_PRIVATE_KEY  (the .p8 contents, "\n"-escaped or base64 also fine, or a path to the .p8)
// Optional: APPLE_TEAM_ID (default: the team of your local "Apple Development" certificate).
// Signing is automatic and cloud-managed through the key, so no certificates or profiles to install. The build
// number is the current UTC time (YYYYMMDDHHMM), passed on the command line so no file changes. Bump the version
// itself with `bun run release:bump` (docs/RELEASING.md).
import { execFileSync, spawnSync } from 'node:child_process'
import { sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const picked = args.filter(a => !a.startsWith('--'))
const bad = picked.filter(p => !['ios', 'macos'].includes(p))
if (bad.length) { console.error('Usage: bun run testflight [ios] [macos] [--notes=<file>] [--dry-run]'); process.exit(1) }
const platforms = picked.length ? picked : ['ios', 'macos']
const notesFile = args.find(a => a.startsWith('--notes='))?.slice('--notes='.length)
const notes = notesFile ? readFileSync(notesFile, 'utf8').trim() : ''
if (notes.length > 4000) { console.error(`${notesFile} has ${notes.length} characters; TestFlight takes 4000`); process.exit(1) }

const need = name => process.env[name]?.trim() || (console.error(`Missing ${name} (see the header of scripts/testflight.mjs)`), process.exit(1))
const keyId = need('APP_STORE_CONNECT_KEY_ID')
const issuer = need('APP_STORE_CONNECT_ISSUER_ID')
let key = need('APP_STORE_CONNECT_PRIVATE_KEY')
if (!key.includes('BEGIN')) key = existsSync(key) ? readFileSync(key, 'utf8') : Buffer.from(key, 'base64').toString('utf8')
key = key.replace(/\\n/g, '\n')
if (!key.includes('BEGIN PRIVATE KEY')) { console.error('APP_STORE_CONNECT_PRIVATE_KEY is not a .p8 private key'); process.exit(1) }

const team = process.env.APPLE_TEAM_ID?.trim() || (() => {
  try {
    const pem = execFileSync('security', ['find-certificate', '-c', 'Apple Development', '-p'], { encoding: 'utf8' })
    return execFileSync('openssl', ['x509', '-noout', '-subject', '-nameopt', 'multiline'], { input: pem, encoding: 'utf8' }).match(/organizationalUnitName\s*=\s*(\w+)/)?.[1]
  }
  catch { return undefined }
})()
if (!team) { console.error('No team found: set APPLE_TEAM_ID (developer.apple.com > Membership)'); process.exit(1) }

const work = mkdtempSync(join(tmpdir(), 'helpbites-testflight-'))
const keyFile = join(work, `AuthKey_${keyId}.p8`)
writeFileSync(keyFile, key, { mode: 0o600 })
const done = () => rmSync(work, { recursive: true, force: true })
process.on('exit', done)

const build = new Date().toISOString().replace(/\D/g, '').slice(0, 12)
const auth = ['-allowProvisioningUpdates', '-authenticationKeyPath', keyFile, '-authenticationKeyID', keyId, '-authenticationKeyIssuerID', issuer]
const project = new URL('../helpbites-native/HelpBitesNative.xcodeproj', import.meta.url).pathname
const exportPlist = join(work, 'ExportOptions.plist')
// destination=upload sends the build straight to App Store Connect (TestFlight) instead of writing an .ipa/.pkg.
writeFileSync(exportPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>upload</string>
<key>teamID</key><string>${team}</string>
<key>signingStyle</key><string>automatic</string>
<key>uploadSymbols</key><true/>
</dict></plist>
`)

const run = (cmd) => {
  console.log(`\n$ xcodebuild ${cmd.join(' ')}`)
  if (dry) return
  if (spawnSync('xcodebuild', cmd, { stdio: 'inherit' }).status !== 0) { console.error('xcodebuild failed'); process.exit(1) }
}

let bundleId
for (const platform of platforms) {
  const archive = join(work, `${platform}.xcarchive`)
  const destination = platform === 'ios' ? 'generic/platform=iOS' : 'generic/platform=macOS'
  console.log(`\n== ${platform}: build ${build}, team ${team} ==`)
  run(['archive', '-project', project, '-scheme', 'HelpBitesNative', '-configuration', 'Release', '-destination', destination,
    '-archivePath', archive, ...auth, `DEVELOPMENT_TEAM=${team}`, `CURRENT_PROJECT_VERSION=${build}`])
  run(['-exportArchive', '-archivePath', archive, '-exportOptionsPlist', exportPlist, ...auth])
  if (dry) continue
  bundleId ??= execFileSync('plutil', ['-extract', 'ApplicationProperties.CFBundleIdentifier', 'raw', join(archive, 'Info.plist')], { encoding: 'utf8' }).trim()
  console.log(`${platform} uploaded. It shows in TestFlight once App Store Connect finishes processing (minutes).`)
}

if (notes && !dry) {
  // App Store Connect API tokens: an ES256 JWT signed with the same key, good for at most 20 minutes.
  const token = () => {
    const part = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const head = `${part({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${part({ iss: issuer, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`
    return `${head}.${sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  }
  const asc = async (path, method = 'GET', data) => {
    const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: data && JSON.stringify({ data }) })
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
    return res.json()
  }
  const app = (await asc(`/v1/apps?filter[bundleId]=${bundleId}`)).data.find(a => a.attributes.bundleId === bundleId)
  for (const platform of platforms) {
    const query = `/v1/builds?filter[app]=${app.id}&filter[version]=${build}&filter[preReleaseVersion.platform]=${platform === 'ios' ? 'IOS' : 'MAC_OS'}`
    // ponytail: polls every 30 s for up to 30 minutes; a slow processing day means setting the text in App Store Connect.
    for (let tries = 0; ; tries++) {
      const found = (await asc(query)).data[0]
      if (found) {
        const local = (await asc(`/v1/builds/${found.id}/betaBuildLocalizations`)).data.find(l => l.attributes.locale === app.attributes.primaryLocale)
        if (local) await asc(`/v1/betaBuildLocalizations/${local.id}`, 'PATCH', { type: 'betaBuildLocalizations', id: local.id, attributes: { whatsNew: notes } })
        else await asc('/v1/betaBuildLocalizations', 'POST', { type: 'betaBuildLocalizations', attributes: { locale: app.attributes.primaryLocale, whatsNew: notes }, relationships: { build: { data: { type: 'builds', id: found.id } } } })
        console.log(`${platform}: "What to Test" set (${app.attributes.primaryLocale}).`)
        break
      }
      if (tries === 60) { console.error(`${platform}: build ${build} not in App Store Connect after 30 minutes; set "What to Test" there by hand.`); process.exit(1) }
      await new Promise(resolve => setTimeout(resolve, 30_000))
    }
  }
}
