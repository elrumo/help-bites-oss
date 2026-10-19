import { expect, test } from 'bun:test'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { appJwt, githubConfigured, installUrl, setProjectRepos } from '../server/utils/github'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
Object.assign(process.env, {
  HELPBITES_SECRET: 'x'.repeat(40), GITHUB_APP_ID: '123', GITHUB_APP_SLUG: 'helpbites-test', GITHUB_APP_CLIENT_ID: 'c', GITHUB_APP_CLIENT_SECRET: 's',
  // A .env file holds the key on one line with literal \n.
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n')
})

test('the app JWT is RS256, issued by the app id and short-lived', () => {
  const jwt = appJwt(1_000_000)
  const [head, body, sig] = jwt.split('.') as [string, string, string]
  expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
  expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({ iat: 999_940, exp: 1_000_540, iss: '123' })
  expect(createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true)
})

test('the install link carries a signed state, and GitHub must be fully configured', () => {
  expect(githubConfigured()).toBe(true)
  const url = new URL(installUrl('ws1', 'user1'))
  expect(url.origin + url.pathname).toBe('https://github.com/apps/helpbites-test/installations/new')
  expect(url.searchParams.get('state')).toMatch(/^[\w-]+\.[\w-]+$/)
  delete process.env.GITHUB_APP_CLIENT_SECRET
  expect(githubConfigured()).toBe(false)
  expect(() => installUrl('ws1', 'user1')).toThrow(/not set up/)
})

test('a project cannot take more than ten repos', async () => {
  const picks = Array.from({ length: 11 }, (_, id) => ({ installationId: '1', id }))
  await expect(setProjectRepos({} as any, {} as any, picks)).rejects.toThrow(/up to 10/)
})
