import { afterEach, describe, expect, test } from 'bun:test'
import { edition, registerEdition, resetEdition, sourceCodeUrl } from '../server/utils/edition'

afterEach(() => resetEdition())

describe('edition registry', () => {
  test('defaults to the community edition with the first-run setup form', () => {
    expect(edition().id).toBe('community')
    expect(edition().policy.signup).toBe('setup')
  })

  test('a registration replaces only what it passes', () => {
    registerEdition({ id: 'cloud', policy: { signup: 'open' } })
    expect(edition()).toMatchObject({ id: 'cloud', policy: { signup: 'open' } })
    registerEdition({ id: 'cloud' })
    expect(edition().policy.signup).toBe('setup')
  })
})

describe('sourceCodeUrl', () => {
  test('points at the upstream repository by default', () => {
    expect(sourceCodeUrl({})).toBe('https://github.com/elrumo/help-bites-oss')
  })

  test('a fork names its own repository, pinned to the running commit on GitHub', () => {
    expect(sourceCodeUrl({ SOURCE_CODE_URL: 'https://github.com/acme/desk/', GIT_SHA: 'abc1234' })).toBe('https://github.com/acme/desk/tree/abc1234')
    expect(sourceCodeUrl({ SOURCE_CODE_URL: 'https://git.acme.dev/desk', GIT_SHA: 'abc1234' })).toBe('https://git.acme.dev/desk')
    expect(sourceCodeUrl({ GIT_SHA: 'not a sha' })).toBe('https://github.com/elrumo/help-bites-oss')
  })
})
