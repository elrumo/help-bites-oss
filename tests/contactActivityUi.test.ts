import { describe, expect, test } from 'bun:test'
import { ACTIVITY_TYPES } from '../shared/activity'
import { ACTIVITY_ICONS, BILLING_ACTIVITY, activityLink, relativeTime } from '../app/utils/contactActivity'
import { demoApi } from '../app/utils/demoApi'

describe('contact activity in the panel', () => {
  test('every kind of activity has an icon', () => {
    expect(Object.keys(ACTIVITY_ICONS).sort()).toEqual([...ACTIVITY_TYPES].sort())
    expect(BILLING_ACTIVITY.every(type => (ACTIVITY_TYPES as readonly string[]).includes(type))).toBe(true)
  })

  test('items lead to the part of the panel that holds them', () => {
    expect(activityLink('p1', { kind: 'conversation', id: 'c9' })).toBe('/inbox?project=p1&c=c9')
    expect(activityLink('p1', { kind: 'feedback_post', id: 'x' })).toBe('/projects/p1/feedback')
    expect(activityLink('p1', { kind: 'email_log', id: 'x' })).toBe('/projects/p1/email?view=log')
    expect(activityLink('p1', { kind: 'sequence', id: 'x' })).toBe('/projects/p1/campaigns?view=sequences')
    expect(activityLink('p1', { kind: 'onboarding_flow', id: 'welcome' })).toBe('/projects/p1/onboarding')
    expect(activityLink('p1', { kind: 'stripe', id: 'pay_1' })).toBe('/projects/p1/revenue')
    expect(activityLink('p1', null)).toBeNull()
  })

  test('times read relative to now', () => {
    const now = Date.parse('2026-10-21T12:00:00Z')
    const at = (seconds: number) => new Date(now - seconds * 1000).toISOString()
    expect(relativeTime(at(5), now, 'en')).toBe('now')
    expect(relativeTime(at(5 * 60), now, 'en')).toBe('5 minutes ago')
    expect(relativeTime(at(3 * 3600), now, 'en')).toBe('3 hours ago')
    expect(relativeTime(at(86_400), now, 'en')).toBe('yesterday')
    expect(relativeTime(at(21 * 86_400), now, 'en')).toBe('3 weeks ago')
    expect(relativeTime(at(400 * 86_400), now, 'en')).toBe('last year')
    expect(relativeTime(at(-2 * 3600), now, 'en')).toBe('in 2 hours')
    expect(relativeTime('nonsense', now, 'en')).toBe('')
  })

  test('the demo answers the timeline, newest first, and keeps a contact\'s language', async () => {
    const { contacts } = await demoApi<any>('/contacts', { query: { project: 'acme' } })
    expect(contacts.every((c: any) => typeof c.language === 'string')).toBe(true)
    const { items, nextBefore } = await demoApi<any>(`/contacts/${contacts[0].id}/activity`, { query: { project: 'acme' } })
    expect(items.length).toBeGreaterThan(0)
    expect(nextBefore).toBeNull()
    expect(items.map((i: any) => i.at)).toEqual([...items.map((i: any) => i.at)].sort().reverse())
    const { contact } = await demoApi<any>(`/contacts/${contacts[0].id}`, { method: 'PATCH', body: { language: 'pt-BR' } })
    expect(contact.language).toBe('pt-BR')
  })
})
