// After `bun run build`, check the server bundle matches the edition it was
// built for: a community bundle must not contain the cloud layer's code, and
// a cloud bundle must (or ee/ was silently left out).
//
//   bun scripts/check-edition-build.mjs community|cloud

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const expected = process.argv[2] === 'cloud' ? 'cloud' : 'community'
// The ee/ edition plugin's registration, however the bundler quotes it.
const MARKER = /registerEdition\(\{\s*id:\s*["']cloud["']/

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(m?js|json)$/.test(name) ? [path] : []
  })
}

const server = files('.output/server')
const hasEe = server.some(file => MARKER.test(readFileSync(file, 'utf8')))
if (expected === 'community' && hasEe) {
  console.error('FAIL: the community build contains ee/ code')
  process.exit(1)
}
if (expected === 'cloud' && !hasEe) {
  console.error('FAIL: the cloud build is missing the ee/ layer')
  process.exit(1)
}
console.log(`ok  ${expected} build`)
