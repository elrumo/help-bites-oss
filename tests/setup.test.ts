import { describe, expect, test } from 'bun:test'
import { SETUP_KEYS, SETUP_REASONS, buildSetup, type SetupFacts } from '../shared/setup'

const bare: SetupFacts = {
  hiddenSections: [], allowedOrigins: 0, widgetSeenAt: null, identitySeenAt: null, allowAnonymousUsers: false,
  notifyEmails: 0, mailerReady: false, pushDevices: 0, fromEmail: '',
  assistants: { total: 0, live: 0, first: '' }, stripe: { connected: false, synced: false, error: '' }, repos: 0, errorTracker: { connected: false, name: '' }
}
const row = (facts: Partial<SetupFacts>, key: string) => buildSetup({ ...bare, ...facts }).items.find(item => item.key === key)!

describe('setup checklist', () => {
  test('a new project has every row to do, and no row of it done', () => {
    const setup = buildSetup(bare)
    expect(setup.items.map(i => i.key)).toEqual(SETUP_KEYS)
    expect(setup.items.every(i => i.state === 'todo')).toBe(true)
    expect(setup).toMatchObject({ done: 0, total: 8 })
  })

  test('the widget is installed only once it has loaded on a site, not when an origin is allowed', () => {
    expect(row({}, 'widget')).toMatchObject({ state: 'todo', reason: 'noOrigins' })
    expect(row({ allowedOrigins: 2 }, 'widget')).toMatchObject({ state: 'todo', reason: 'waiting', value: '2' })
    expect(row({ allowedOrigins: 2, widgetSeenAt: '2026-10-21T08:00:00.000Z' }, 'widget')).toMatchObject({ state: 'done', reason: 'seen', value: '2026-10-21T08:00:00.000Z' })
  })

  test('identity is seen when a signed token arrived; anonymous sign-in makes a missing one optional', () => {
    expect(row({}, 'identity')).toMatchObject({ state: 'todo', reason: 'missing', optional: false })
    expect(row({ allowAnonymousUsers: true }, 'identity')).toMatchObject({ state: 'todo', reason: 'anonymous', optional: true })
    expect(row({ identitySeenAt: '2026-10-21T08:00:00.000Z', allowAnonymousUsers: true }, 'identity')).toMatchObject({ state: 'done', reason: 'seen' })
  })

  test('someone is notified by email only when mail can go out, else by a phone, else nobody', () => {
    expect(row({ notifyEmails: 2 }, 'notified')).toMatchObject({ state: 'attention', reason: 'noMailer' })
    expect(row({ notifyEmails: 2, mailerReady: true }, 'notified')).toMatchObject({ state: 'done', reason: 'email', value: '2' })
    expect(row({ pushDevices: 1 }, 'notified')).toMatchObject({ state: 'done', reason: 'push' })
    expect(row({}, 'notified')).toMatchObject({ state: 'todo', reason: 'nobody' })
  })

  test('the sender is done when mail can go out, whoever supplies the address', () => {
    expect(row({ mailerReady: true, fromEmail: 'hello@mail.acme.app' }, 'sender')).toMatchObject({ state: 'done', reason: 'ready', value: 'hello@mail.acme.app', section: 'email?view=settings' })
    expect(row({ mailerReady: true }, 'sender')).toMatchObject({ state: 'done', reason: 'default', value: '' })
  })

  test('an assistant that exists but cannot answer is a problem to look at, not a to-do', () => {
    expect(row({}, 'assistant')).toMatchObject({ state: 'todo', reason: 'none' })
    expect(row({ assistants: { total: 2, live: 0, first: 'Ava' } }, 'assistant')).toMatchObject({ state: 'attention', reason: 'notLive', value: 'Ava' })
    expect(row({ assistants: { total: 2, live: 1, first: 'Ben' } }, 'assistant')).toMatchObject({ state: 'done', reason: 'live', value: 'Ben' })
  })

  test('Stripe is done only after a sync that did not fail', () => {
    expect(row({}, 'stripe')).toMatchObject({ state: 'todo', reason: 'none', optional: true })
    expect(row({ stripe: { connected: true, synced: false, error: '' } }, 'stripe')).toMatchObject({ state: 'todo', reason: 'waiting' })
    expect(row({ stripe: { connected: true, synced: true, error: 'Stripe answered 401' } }, 'stripe')).toMatchObject({ state: 'attention', reason: 'error', value: 'Stripe answered 401' })
    expect(row({ stripe: { connected: true, synced: true, error: '' } }, 'stripe')).toMatchObject({ state: 'done', reason: 'synced' })
  })

  test('GitHub and errors follow what is linked and connected', () => {
    expect(row({ repos: 2 }, 'github')).toMatchObject({ state: 'done', reason: 'linked', value: '2' })
    expect(row({ errorTracker: { connected: true, name: 'Bugsink' } }, 'errors')).toMatchObject({ state: 'done', reason: 'connected', value: 'Bugsink' })
  })

  test('a hidden section takes its row with it, and a role that cannot see a row does not get it', () => {
    const keys = (facts: Partial<SetupFacts>) => buildSetup({ ...bare, ...facts }).items.map(i => i.key)
    expect(keys({ hiddenSections: ['revenue', 'errors'] })).not.toContain('stripe')
    expect(keys({ hiddenSections: ['revenue', 'errors'] })).not.toContain('errors')
    expect(keys({ hiddenSections: ['email', 'assistants'] })).toEqual(['widget', 'identity', 'notified', 'stripe', 'github', 'errors'])
    expect(keys({ skip: ['stripe'] })).not.toContain('stripe')
    expect(buildSetup({ ...bare, hiddenSections: ['revenue'] }).total).toBe(7)
  })

  test('every reason a row can give is one the table knows', () => {
    const everyAnswer = [
      bare, { ...bare, allowedOrigins: 1 }, { ...bare, allowedOrigins: 1, widgetSeenAt: 'x', identitySeenAt: 'x', notifyEmails: 1, mailerReady: true, fromEmail: 'a@b.co', repos: 1, errorTracker: { connected: true, name: 'a' }, assistants: { total: 1, live: 1, first: 'a' }, stripe: { connected: true, synced: true, error: '' } },
      { ...bare, allowAnonymousUsers: true, notifyEmails: 1, pushDevices: 1, mailerReady: true, assistants: { total: 1, live: 0, first: 'a' }, stripe: { connected: true, synced: false, error: 'e' } }
    ]
    for (const facts of everyAnswer) for (const item of buildSetup(facts).items) expect(SETUP_REASONS[item.key] as readonly string[]).toContain(item.reason)
  })
})
