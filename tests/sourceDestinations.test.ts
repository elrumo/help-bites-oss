import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertSecretStaysHome } from '../server/utils/sourceDestinations'

const saved = { serverUrl: 'https://parse.acme.test/parse', appId: 'app1' }

describe('a saved contact source secret', () => {
  test('goes on to the server it was saved for', () => {
    expect(() => assertSecretStaysHome(saved, { ...saved }, false)).not.toThrow()
    expect(() => assertSecretStaysHome(saved, { ...saved, serverUrl: 'https://parse.acme.test/parse' }, false)).not.toThrow()
  })

  test('is not sent to another server unless a new one comes with it', () => {
    for (const after of [{ ...saved, serverUrl: 'https://evil.example/parse' }, { ...saved, appId: 'other' }, { serverUrl: undefined, appId: 'app1' }]) {
      expect(() => assertSecretStaysHome(saved, after, false)).toThrow(/Enter the secret again/)
      expect(() => assertSecretStaysHome(saved, after, true)).not.toThrow()
    }
    try { assertSecretStaysHome(saved, { ...saved, serverUrl: 'https://evil.example' }, false) } catch (error) { expect(error).toMatchObject({ statusCode: 400 }) }
  })

  test('a source that is not saved yet has nothing to protect', () => {
    expect(() => assertSecretStaysHome(null, { serverUrl: 'https://anywhere.test' }, false)).not.toThrow()
    expect(() => assertSecretStaysHome(undefined, {}, false)).not.toThrow()
  })

  test('both routes that use a saved secret ask first', () => {
    const route = (name: string) => readFileSync(join(import.meta.dir, '../server/routes/v1/admin/contact-sources', name), 'utf8')
    for (const name of ['test.post.ts', '[id].patch.ts']) {
      const text = route(name)
      expect(text).toContain('assertSecretStaysHome(')
      expect(text.indexOf('assertSecretStaysHome(')).toBeLessThan(text.indexOf('sourceSecret('))
    }
  })
})
