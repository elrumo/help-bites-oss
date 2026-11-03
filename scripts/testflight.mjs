// Archives the native app and uploads it to TestFlight: bun run testflight [ios] [macos] [--dry-run]
// (no platform = both). Needs Xcode and, in .env or the shell, an App Store Connect API key:
//   APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID,
//   APP_STORE_CONNECT_PRIVATE_KEY  (the .p8 contents, "\n"-escaped or base64 also fine, or a path to the .p8)
// Optional: APPLE_TEAM_ID (default: the team of your local "Apple Development" certificate).
// Signing is automatic and cloud-managed through the key, so no certificates or profiles to install. The build
// number is the current UTC time (YYYYMMDDHHMM), passed on the command line so no file changes. Bump the version
// itself with `bun run release:bump` (docs/RELEASING.md).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const picked = args.filter(a => !a.startsWith('--'))
const bad = picked.filter(p => !['ios', 'macos'].includes(p))
if (bad.length) { console.error('Usage: bun run testflight [ios] [macos] [--dry-run]'); process.exit(1) }
const platforms = picked.length ? picked : ['ios', 'macos']

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

for (const platform of platforms) {
  const archive = join(work, `${platform}.xcarchive`)
  const destination = platform === 'ios' ? 'generic/platform=iOS' : 'generic/platform=macOS'
  console.log(`\n== ${platform}: build ${build}, team ${team} ==`)
  run(['archive', '-project', project, '-scheme', 'HelpBitesNative', '-configuration', 'Release', '-destination', destination,
    '-archivePath', archive, ...auth, `DEVELOPMENT_TEAM=${team}`, `CURRENT_PROJECT_VERSION=${build}`])
  run(['-exportArchive', '-archivePath', archive, '-exportOptionsPlist', exportPlist, ...auth])
  if (!dry) console.log(`${platform} uploaded. It shows in TestFlight once App Store Connect finishes processing (minutes).`)
}
