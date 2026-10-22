import { expect, test } from 'bun:test'
import { GUEST_SURFACES, GUEST_WRITES_PER_10_MIN, GUEST_WRITES_PER_DAY, normalizeGuestSurfaces } from '../shared/guest'
import { guestDisplayName, isEndUserToken, newEndUserToken, newGuestExternalId } from '../server/utils/endUserTokens'

test('surfaces are kept once, in order, and unknown ones are dropped', () => {
  expect(normalizeGuestSurfaces(['comments', 'chat', 'chat', 'forms', 7])).toEqual(['chat', 'comments'])
  expect(normalizeGuestSurfaces([...GUEST_SURFACES])).toEqual([...GUEST_SURFACES])
})

test('anything that is not a list turns guests off', () => {
  for (const value of [undefined, null, 'chat', 1, {}, [], ['bogus']]) expect(normalizeGuestSurfaces(value)).toEqual([])
})

test('a guest id is random, prefixed apart from email-only and host ids, and labelled for the inbox', () => {
  const id = newGuestExternalId()
  expect(id).toMatch(/^guest_[0-9a-f]{24}$/)
  expect(id).not.toBe(newGuestExternalId())
  expect(guestDisplayName(id)).toBe(`Guest ${id.slice(-4)}`)
})

test('a guest uses the same opaque session token as an email-only user', () => {
  expect(isEndUserToken(newEndUserToken().token)).toBe(true)
})

test('the per-guest write budget is tighter per day than a runaway script needs', () => {
  expect(GUEST_WRITES_PER_10_MIN).toBeLessThan(GUEST_WRITES_PER_DAY)
  expect(GUEST_WRITES_PER_DAY).toBeLessThanOrEqual(200)
})

// ---- the gate ----

const { anonymousWriteGate, guestSurfacesOf, requireVerifiedAnonymous } = await import('../server/utils/endUserSessions')

const projectWith = (guestSurfaces: unknown) => ({ id: 'p1', get: (key: string) => (key === 'guestSurfaces' ? guestSurfaces : undefined) }) as never
const guestClaims = { iss: 'pk_x', sub: 'guest_abc', anon: true, guest: true, emailVerified: false, iat: 0, exp: 0 }

test('a project reads its guest surfaces through the same normaliser the panel uses', () => {
  expect(guestSurfacesOf(projectWith(['feedback', 'nonsense']))).toEqual(['feedback'])
  expect(guestSurfacesOf(projectWith(undefined))).toEqual([])
})

test('a guest is refused on a surface the admin did not open', async () => {
  const error = await anonymousWriteGate(projectWith(['feedback']), guestClaims, 'chat').then(() => null, e => e)
  expect(error?.statusCode).toBe(403)
  expect(error?.data).toEqual({ code: 'guest_not_allowed', surface: 'chat' })
  const closed = await anonymousWriteGate(projectWith([]), guestClaims, 'feedback').then(() => null, e => e)
  expect(closed?.data?.code).toBe('guest_not_allowed')
})

test('a guest cannot upload, and says so rather than asking for a code', () => {
  let error: any
  try { requireVerifiedAnonymous(guestClaims) } catch (e) { error = e }
  expect(error?.statusCode).toBe(403)
  expect(error?.data?.code).toBe('guest_upload_not_allowed')
})
