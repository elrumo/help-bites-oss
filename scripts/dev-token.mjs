// Mint an identity token for a project, the way a host backend would.
//   bun scripts/dev-token.mjs <projectId> <userId> [name] [email]
import { createHmac } from 'node:crypto'
import { assertEnv, parseFetch } from './parseRest.mjs'

const [projectId, userId, name = 'Demo user', email = ''] = process.argv.slice(2)
if (!projectId || !userId) {
  console.error('usage: bun scripts/dev-token.mjs <projectId> <userId> [name] [email]')
  process.exit(1)
}
assertEnv()
const res = await parseFetch(`/classes/Project/${projectId}`)
if (!res.ok) { console.error('project not found'); process.exit(1) }
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const head = b64({ alg: 'HS256', typ: 'JWT' })
const body = b64({ iss: res.body.publicKey, sub: userId, name, email, iat: now, exp: now + 3600 })
const token = `${head}.${body}.${createHmac('sha256', res.body.secret).update(`${head}.${body}`).digest('base64url')}`
console.log(`pk=${res.body.publicKey}`)
console.log(`token=${token}`)
console.log(`\n${process.env.APP_URL || 'http://localhost:3100'}/embed-demo.html?pk=${res.body.publicKey}&token=${token}`)
