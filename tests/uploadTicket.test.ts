import { afterAll, expect, test } from 'bun:test'

process.env.HELPBITES_SECRET = 'x'.repeat(40)
const { mintUploadTicket, readUploadTicket } = await import('../server/utils/uploadTicket')
afterAll(() => { delete process.env.HELPBITES_SECRET })

test('a ticket names the project, owner and file, and expires', () => {
  const now = Date.now()
  const { token, expiresAt } = mintUploadTicket({ projectId: 'p1', owner: 'agent-a1', filename: 'icon.png' }, now)
  expect(expiresAt.getTime()).toBe(now + 15 * 60 * 1000)
  expect(readUploadTicket(token, now + 1000)).toEqual({ projectId: 'p1', owner: 'agent-a1', filename: 'icon.png' })
  expect(readUploadTicket(token, now + 16 * 60 * 1000)).toBeNull()
})

test('a forged or truncated ticket is refused', () => {
  const { token } = mintUploadTicket({ projectId: 'p1', owner: 'o', filename: 'a.png' })
  const [body] = token.split('.')
  expect(readUploadTicket(`${body}.AAAA`)).toBeNull()
  expect(readUploadTicket(body!)).toBeNull()
  expect(readUploadTicket('')).toBeNull()
})
