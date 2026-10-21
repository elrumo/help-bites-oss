import { describe, expect, test } from 'bun:test'
import { buildEmailSetup, EMAIL_SETUP_CHECKS, type EmailSetupFacts } from '../shared/emailSetup'

const ready: EmailSetupFacts = { apiKey: true, domain: 'mail.acme.app', fromEmail: 'hello@mail.acme.app', webhook: true, postalAddress: '1 Main St, Lisbon', pausedReason: '' }
const states = (facts: Partial<EmailSetupFacts>) => Object.fromEntries(buildEmailSetup({ ...ready, ...facts }).checks.map(c => [c.key, c.state]))

describe('email setup', () => {
  test('everything in place sends and runs campaigns', () => {
    const setup = buildEmailSetup(ready)
    expect(setup).toMatchObject({ sending: true, bulk: true })
    expect(setup.checks.map(c => c.key)).toEqual([...EMAIL_SETUP_CHECKS])
    expect(setup.checks.every(c => c.state === 'ok')).toBe(true)
  })

  test('no mailer key, or no sender, stops all mail', () => {
    expect(buildEmailSetup({ ...ready, apiKey: false })).toMatchObject({ sending: false, bulk: false })
    expect(states({ domain: '' })).toMatchObject({ sender: 'todo' })
    expect(buildEmailSetup({ ...ready, fromEmail: '' })).toMatchObject({ sending: false, bulk: false })
  })

  test('a missing delivery webhook is a warning: mail still goes, bounces just never come back', () => {
    expect(buildEmailSetup({ ...ready, webhook: false })).toMatchObject({ sending: true, bulk: true })
    expect(states({ webhook: false }).webhook).toBe('warn')
  })

  test('campaigns need a postal address and a sender that is not paused, mail by hand does not', () => {
    expect(buildEmailSetup({ ...ready, postalAddress: '  ' })).toMatchObject({ sending: true, bulk: false })
    const paused = buildEmailSetup({ ...ready, pausedReason: 'Of the 120 emails sent, 9% bounced' })
    expect(paused).toMatchObject({ sending: true, bulk: false })
    expect(paused.checks.find(c => c.key === 'paused')).toMatchObject({ state: 'todo', scope: 'bulk', value: 'Of the 120 emails sent, 9% bounced' })
  })
})
