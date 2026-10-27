import { describe, expect, test } from 'bun:test'
import { destinationKeysIn, refuseDestinationsToKeys } from '../server/utils/projectDestinations'

describe('where a project sends mail, notifications and events', () => {
  test('finds the top-level settings that decide it', () => {
    expect(destinationKeysIn({ name: 'Acme', notifyEmails: ['a@evil.test'], replyTo: 'a@evil.test', allowAttachments: true })).toEqual(['notifyEmails', 'replyTo'])
    for (const key of ['fromEmail', 'fromName', 'mailDomain', 'siteUrl', 'inboxPath', 'allowedOrigins', 'emailLogContent', 'actionWebhookUrl', 'actionWebhookSecret', 'eventWebhookUrl', 'eventWebhookSecret']) {
      expect(destinationKeysIn({ [key]: 'x' }), key).toEqual([key])
    }
  })

  test('finds the ones inside a section, by their path', () => {
    expect(destinationKeysIn({ changelog: { enabled: true, commentNotify: ['a@evil.test'], pageUrl: 'https://evil.test' }, blog: { postUrl: 'https://evil.test/{slug}', title: 'Blog' }, marketing: { fromEmail: 'x@evil.test', doubleOptIn: true }, feedback: { postUrlTemplate: 'https://evil.test' }, hub: { links: [], title: 'Hi' } }))
      .toEqual(['changelog.commentNotify', 'changelog.pageUrl', 'blog.postUrl', 'marketing.fromEmail', 'feedback.postUrlTemplate', 'hub.links'])
  })

  test('says nothing about settings that change no destination', () => {
    expect(destinationKeysIn({ name: 'Acme', hiddenSections: ['blog'], board: { statuses: [] }, style: { radius: 8 }, flags: [], changelog: { enabled: true }, company: { name: 'Acme', email: 'a@acme.test' } })).toEqual([])
    expect(destinationKeysIn(null)).toEqual([])
    expect(destinationKeysIn('notifyEmails')).toEqual([])
    expect(destinationKeysIn({ changelog: 'commentNotify' })).toEqual([])
  })

  test('a key that names one is refused with the code the panel and assistants read', () => {
    expect(() => refuseDestinationsToKeys({ name: 'Acme' })).not.toThrow()
    try {
      refuseDestinationsToKeys({ notifyEmails: ['a@evil.test'], hub: { links: [] } })
      throw new Error('it was let through')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 403, data: { code: 'session_required' } })
      expect((error as { statusMessage: string }).statusMessage).toContain('notifyEmails, hub.links')
    }
  })
})
