import { describe, expect, test } from 'bun:test'
import Parse from 'parse/node'
import { campaignStatsFrom, canMoveCampaign, validateMarketingConfig } from '../shared/marketing'
import { EMAIL_TEMPLATES } from '../shared/email/templates'
import { blankValues, campaignAudience, campaignMailerReady, complianceProblems, contactVariables, pickDueCampaigns, readUnsubscribePayload, unsubscribeLinks } from '../server/utils/campaigns'
import { isMarketingSource } from '../server/utils/emailLogs'
import { readLinkToken } from '../server/utils/secrets'
import { renderPreferencesPage } from '../server/utils/preferences'

process.env.HELPBITES_SECRET = 'test-secret-that-is-at-least-32-characters-long'
process.env.PARSE_ID ||= 'test'
process.env.PARSE_MASTER_KEY ||= 'test'
process.env.PARSE_URL ||= 'http://127.0.0.1:1/parse'

const fake = (fields: Record<string, unknown>, id = 'x') => ({ id, get: (k: string) => fields[k] }) as any
const newsletter = EMAIL_TEMPLATES.find(t => t.id === 'newsletter-editorial')!.document

describe('campaign rules', () => {
  test('an audience is always this project, subscribed, with an email, not opted out of the topic', async () => {
    const project = Parse.Object.extend('Project').createWithoutData('p1')
    const where = (await campaignAudience(project, { topic: 'news' })).toJSON().where
    expect(where).toMatchObject({ project: { __type: 'Pointer', className: 'Project', objectId: 'p1' }, subscription: 'subscribed', email: { $exists: true }, unsubscribedTopics: { $ne: 'news' } })
  })

  test('no unsubscribe link or no postal address, no campaign', () => {
    const withAddress = fake({ marketing: { postalAddress: '1 Main St' } })
    expect(complianceProblems(withAddress, newsletter)).toEqual([])
    expect(complianceProblems(fake({}), newsletter)).toHaveLength(1)
    const bare = { ...newsletter, blocks: newsletter.blocks.filter(b => b.id !== 'digest_footer') }
    expect(complianceProblems(withAddress, bare).length).toBe(2)
  })

  test('no mailer, no campaign: there is nothing a retry could send through', () => {
    const saved = { key: process.env.MAILGUN_API_KEY, domain: process.env.MAILGUN_DOMAIN, from: process.env.MAILGUN_FROM_EMAIL }
    delete process.env.MAILGUN_API_KEY
    process.env.MAILGUN_DOMAIN = 'mg.x.test'
    process.env.MAILGUN_FROM_EMAIL = 'hi@x.test'
    try {
      expect(campaignMailerReady(fake({}))).toBe(false)
      process.env.MAILGUN_API_KEY = 'key'
      expect(campaignMailerReady(fake({}))).toBe(true)
    } finally {
      for (const [name, value] of [['MAILGUN_API_KEY', saved.key], ['MAILGUN_DOMAIN', saved.domain], ['MAILGUN_FROM_EMAIL', saved.from]] as const) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  test('status moves', () => {
    expect(canMoveCampaign('draft', 'scheduled')).toBe(true)
    expect(canMoveCampaign('sending', 'paused')).toBe(true)
    expect(canMoveCampaign('paused', 'sending')).toBe(true)
    expect(canMoveCampaign('sent', 'sending')).toBe(false)
    expect(canMoveCampaign('canceled', 'draft')).toBe(false)
    expect(canMoveCampaign('sending', 'draft')).toBe(false)
  })

  test('numbers: each log row counts once, at its furthest status', () => {
    expect(campaignStatsFrom({ sent: 2, delivered: 5, opened: 3, clicked: 1, unsubscribed: 1, bounced: 1, failed: 1, suppressed: 2 }, 16)).toEqual({
      audience: 16, sent: 13, failed: 1, suppressed: 2, delivered: 10, opened: 5, clicked: 1, bounced: 1, complained: 0, unsubscribed: 1
    })
  })
})

describe('due campaigns', () => {
  const due = [{ id: 'a1', workspaceId: 'A' }, { id: 'a2', workspaceId: 'A' }, { id: 'b1', workspaceId: 'B' }, { id: 'a3', workspaceId: 'A' }, { id: 'c1', workspaceId: 'C' }]

  test('one per workspace, the longest waiting first: a workspace\'s other lists wait their turn', () => {
    expect(pickDueCampaigns(due, 5).map(c => c.id)).toEqual(['a1', 'b1', 'c1'])
  })

  test('never more than asked for', () => {
    expect(pickDueCampaigns(due, 2).map(c => c.id)).toEqual(['a1', 'b1'])
    expect(pickDueCampaigns(due, 0)).toEqual([])
  })
})

describe('personalisation', () => {
  test('a contact fills contact.*, their attributes and firstName; nothing is left as {{...}}', () => {
    const contact = fake({ name: 'Ada Lovelace', email: 'ada@x.io', externalId: 'u1', language: 'es', attributes: { plan: 'pro', seats: 3 } })
    expect(contactVariables(contact)).toEqual({ firstName: 'Ada', 'contact.name': 'Ada Lovelace', 'contact.firstName': 'Ada', 'contact.email': 'ada@x.io', 'contact.language': 'es', 'contact.externalId': 'u1', plan: 'pro', 'contact.plan': 'pro', seats: '3', 'contact.seats': '3' })
    const doc = { settings: { title: 'Hi {{firstName}}' }, blocks: [{ id: 'a', type: 'text', html: '{{contact.plan}} {{project.name}} {{unsubscribeUrl}}' }] } as any
    expect(blankValues(doc, '{{ season }} news')).toEqual({ firstName: '', 'contact.plan': '', unsubscribeUrl: '', season: '' })
  })
})

describe('unsubscribe links', () => {
  test('signed, scoped to project, contact and topic; one-click headers point at the API', () => {
    const links = unsubscribeLinks('https://help.example.com', 'p1', 'c1', 'news')
    const token = links.preferencesUrl.split('/u/')[1]!
    expect(readUnsubscribePayload(readLinkToken('unsubscribe', token))).toEqual({ projectId: 'p1', contactId: 'c1', topic: 'news' })
    expect(links.unsubscribeUrl).toBe(`https://help.example.com/u/${token}?unsubscribe=1`)
    expect(links.headers).toEqual({ 'List-Unsubscribe': `<https://help.example.com/v1/unsubscribe/${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
    expect(readUnsubscribePayload(readLinkToken('unsubscribe', `${token.slice(0, -2)}xx`))).toBeNull()
  })

  test('marketing mail unsubscribes the contact; other mail suppresses the address', () => {
    expect(isMarketingSource('campaign')).toBe(true)
    expect(isMarketingSource('sequence')).toBe(true)
    expect(isMarketingSource('api')).toBe(false)
  })

  test('the preferences page escapes what it shows and only changes things by POST', () => {
    const project = fake({ name: '<Acme>', marketing: { topics: [{ key: 'news', name: 'News & <b>more</b>', description: '' }] } })
    const contact = fake({ email: 'a"b@x.io', subscription: 'subscribed', unsubscribedTopics: [] })
    const html = renderPreferencesPage({ project, contact, topic: 'news' }, { token: 'tok', askUnsubscribe: true, notice: '' })
    expect(html).toContain('&lt;Acme&gt;')
    expect(html).toContain('News &amp; &lt;b&gt;more&lt;/b&gt;')
    expect(html).not.toContain('a"b@x.io')
    expect(html).toContain('method="post" action="/u/tok"')
    expect(html).not.toMatch(/<script/i)
  })

  test('subscribing again from the page waits for the confirmation mail, and says so', () => {
    const project = fake({ name: 'Acme', marketing: {} })
    const page = (subscription: string, notice: string) => renderPreferencesPage({ project, contact: fake({ email: 'a@x.io', subscription }), topic: '' }, { token: 'tok', askUnsubscribe: false, notice })
    expect(page('unsubscribed', '')).toContain('value="resubscribe"')
    expect(page('pending', 'confirm')).toContain('Check your inbox')
    expect(page('pending', 'subscribed')).not.toContain('subscribed again')
  })
})

describe('marketing settings', () => {
  test('topics need clean keys; the sender must be on its domain', () => {
    expect(validateMarketingConfig({ topics: [{ key: 'News', name: 'News' }, { key: 'news' }] }).errors).toEqual(['Topic "news" twice'])
    expect(validateMarketingConfig({ topics: [{ key: 'bad key' }] }).errors).toHaveLength(1)
    expect(validateMarketingConfig({ fromEmail: 'hi@other.com', mailDomain: 'news.example.com' }).errors).toEqual(['fromEmail must be on mailDomain'])
    expect(validateMarketingConfig({ confirmRedirectUrl: 'javascript:alert(1)' }).errors).toHaveLength(1)
    expect(validateMarketingConfig({ doubleOptIn: false, postalAddress: ' 1 Main St ' }).config).toMatchObject({ doubleOptIn: false, postalAddress: '1 Main St' })
  })
})
