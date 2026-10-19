import { expect, test } from 'bun:test'
import { resolveAppUrl } from '../app/composables/useAppUrl'

test('resolveAppUrl prefers browsed origin over a stale/unset localhost APP_URL', () => {
  // stale deploy default → show the origin the operator is actually on
  expect(resolveAppUrl('http://localhost:3100', 'https://help.example.com')).toBe('https://help.example.com')
  // unset APP_URL → origin
  expect(resolveAppUrl('', 'https://help.example.com')).toBe('https://help.example.com')
  // a public APP_URL is an intentional override and wins (trailing slash trimmed)
  expect(resolveAppUrl('https://tunnel.ngrok.io/', 'http://localhost:3100')).toBe('https://tunnel.ngrok.io')
  // no origin available (SSR) with only a loopback config → best we have
  expect(resolveAppUrl('http://localhost:3100', '')).toBe('http://localhost:3100')
})
