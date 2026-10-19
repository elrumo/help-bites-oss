import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { nextStepAt, validateSequenceInput } from '../shared/marketing'
import { confirmToken, readConfirmToken, readSignup, signupOriginAllowed, signupPage } from '../server/utils/signup'
import { nextWebhookAttempt, webhookSignature, WEBHOOK_BACKOFF_MINUTES } from '../server/utils/webhooks'

process.env.HELPBITES_SECRET = 'test-secret-that-is-at-least-32-characters-long'

const statusOf = (fn: () => unknown) => {
  try { fn() } catch (error) { return (error as { statusCode?: number }).statusCode }
  return 0
}
const fake = (fields: Record<string, unknown>) => ({ id: 'p1', get: (k: string) => fields[k] }) as any

describe('sign-up', () => {
  test('reads a form or JSON; the honeypot marks bots', () => {
    expect(readSignup({ email: ' Ada@X.io ', name: 'Ada', topics: 'news' })).toEqual({ email: 'ada@x.io', name: 'Ada', topics: ['news'], bot: false })
    expect(readSignup({ email: 'a@x.io', topics: ['news', 'BAD KEY', 'tips'] }).topics).toEqual(['news', 'tips'])
    expect(readSignup({ email: 'a@x.io' }).topics).toBeNull()
    expect(readSignup({ email: 'a@x.io', topics_sent: '1' }).topics).toEqual([])
    expect(readSignup({ email: 'a@x.io', website: 'http://spam' }).bot).toBe(true)
    expect(statusOf(() => readSignup({ email: 'nope' }))).toBe(400)
  })

  test('a browser form must come from one of the project\'s sites or this server', () => {
    expect(signupOriginAllowed('', ['https://app.example.com'], 'https://help.example.com')).toBe(true)
    expect(signupOriginAllowed('https://app.example.com', ['https://app.example.com'], 'https://help.example.com')).toBe(true)
    expect(signupOriginAllowed('https://help.example.com', ['https://app.example.com'], 'https://help.example.com')).toBe(true)
    expect(signupOriginAllowed('https://evil.example', ['https://app.example.com'], 'https://help.example.com')).toBe(false)
    expect(signupOriginAllowed('https://anywhere.example', [], 'https://help.example.com')).toBe(true)
  })

  test('confirm links expire after a week and cannot be forged', () => {
    const now = Date.UTC(2026, 9, 1)
    const token = confirmToken('p1', 'c1', now)
    expect(readConfirmToken(token, now + 86_400_000)).toEqual({ projectId: 'p1', contactId: 'c1' })
    expect(readConfirmToken(token, now + 8 * 86_400_000)).toBeNull()
    expect(readConfirmToken(`${Buffer.from('p1:c2:9999999999').toString('base64url')}.${token.split('.')[1]}`, now)).toBeNull()
  })

  test('the hosted page escapes the project and carries the honeypot', () => {
    const html = signupPage(fake({ name: '<Acme>', publicKey: 'pk_1', marketing: { topics: [{ key: 'news', name: 'News' }] } }))
    expect(html).toContain('&lt;Acme&gt;')
    expect(html).toContain('name="website"')
    expect(html).toContain('name="topics_sent"')
    expect(html).toContain('value="pk_1"')
  })
})

describe('event webhooks', () => {
  test('signed like the action webhook', () => {
    const body = JSON.stringify({ id: 'evt_1' })
    expect(webhookSignature('whsec', body)).toBe(`sha256=${createHmac('sha256', 'whsec').update(body).digest('hex')}`)
  })

  test('retries back off, then give up', () => {
    const now = new Date('2026-10-01T00:00:00Z')
    expect(nextWebhookAttempt(1, now)!.toISOString()).toBe('2026-10-01T00:01:00.000Z')
    expect(nextWebhookAttempt(WEBHOOK_BACKOFF_MINUTES.length, now)!.toISOString()).toBe('2026-10-01T12:00:00.000Z')
    expect(nextWebhookAttempt(WEBHOOK_BACKOFF_MINUTES.length + 1, now)).toBeNull()
  })
})

describe('sequences', () => {
  test('triggers and steps are checked; each delay counts from the step before', () => {
    const { trigger, steps, errors } = validateSequenceInput({ trigger: { type: 'event', event: 'trial_started' }, steps: [{ delayMinutes: 0, template: 'welcome' }, { delayMinutes: 60, template: 'tips', subject: 'Tips' }] })
    expect(errors).toEqual([])
    expect(trigger).toEqual({ type: 'event', event: 'trial_started' })
    expect(steps.map(s => [s.delayMinutes, s.template, s.subject])).toEqual([[0, 'welcome', undefined], [60, 'tips', 'Tips']])
    const at = new Date('2026-10-01T00:00:00Z')
    expect(nextStepAt(steps, 1, at)!.toISOString()).toBe('2026-10-01T01:00:00.000Z')
    expect(nextStepAt(steps, 2, at)).toBeNull()
  })

  test('bad input is refused', () => {
    expect(validateSequenceInput({ trigger: { type: 'event', event: 'has spaces' } }).errors).toHaveLength(1)
    expect(validateSequenceInput({ trigger: { type: 'cron' } }).errors).toHaveLength(1)
    expect(validateSequenceInput({ steps: [{ delayMinutes: -5, template: '' }] }).errors).toHaveLength(2)
    expect(validateSequenceInput({ steps: Array.from({ length: 21 }, () => ({ template: 't' })) }).errors).toContain('At most 20 steps')
  })
})
