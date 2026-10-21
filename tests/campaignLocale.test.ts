import { describe, expect, test } from 'bun:test'
import { groupByLocale, localeForLanguage, snapshotDocument, snapshotLocales, subjectForLocale, translatedDocuments } from '../shared/campaignLocale'
import { EMAIL_TEMPLATES } from '../shared/email/templates'
import { campaignEmails, complianceProblems, contactVariables, snapshotFromRow, snapshotProblems, snapshotToRow, type CampaignSnapshot } from '../server/utils/campaigns'

process.env.HELPBITES_SECRET = 'test-secret-that-is-at-least-32-characters-long'

const document = EMAIL_TEMPLATES.find(t => t.id === 'newsletter-editorial')!.document
const footer = (document.blocks.find(b => b.id === 'digest_footer') as { html: string }).html
const snapshot = (translations: CampaignSnapshot['translations'], locale = 'en'): CampaignSnapshot => ({ document, defaults: {}, templateId: 't1', templateKey: 'digest', templateName: 'Digest', locale, translations })
const es = { subject: 'Resumen semanal', 'digest_title#text': 'Tres ideas para tu viernes', 'digest_footer#html': footer }
const spanish = snapshot({ es, fr: { subject: '' } })

const fake = (fields: Record<string, unknown>, id: string) => ({ id, get: (key: string) => fields[key] }) as any
const contact = (id: string, language?: string) => fake({ email: `${id}@example.com`, name: id, ...(language ? { language } : {}) }, id)
const project = fake({ name: 'Acme', fromName: 'Acme', fromEmail: 'hi@mail.example.com', mailDomain: 'mail.example.com', marketing: { postalAddress: '1 Main St' } }, 'p1')
const options = { batchId: 'cm_1', subject: '', topic: '', testMode: false, source: 'campaign' as const, actor: { type: 'system' as const, id: '', name: 'Campaign' }, base: 'https://help.example.com' }

describe('which language a contact gets', () => {
  test('the closest language the template has, else its own', () => {
    expect(localeForLanguage('es', spanish)).toBe('es')
    expect(localeForLanguage('es-MX', spanish)).toBe('es')
    expect(localeForLanguage('ES', spanish)).toBe('es')
    expect(localeForLanguage('de', spanish)).toBe('en')
    expect(localeForLanguage('', spanish)).toBe('en')
    expect(localeForLanguage('not a tag', spanish)).toBe('en')
  })

  test('a template with no translations, or from before they were kept, sends its own to everyone', () => {
    expect(localeForLanguage('es', snapshot({}))).toBe('en')
    expect(localeForLanguage('es', { document })).toBe('en')
    expect(snapshotLocales({ document })).toEqual(['en'])
  })

  test('a language added but not yet written is not offered', () => {
    expect(snapshotLocales(spanish)).toEqual(['en', 'es'])
    expect(localeForLanguage('fr', spanish)).toBe('en')
  })

  test('the template\'s own language wins over a stray translation of it, and a regional match is found', () => {
    const base = snapshot({ 'pt-BR': { subject: 'Oi' }, en: { subject: 'Hi' } }, 'es')
    expect(snapshotLocales(base)).toEqual(['es', 'pt-BR', 'en'])
    expect(localeForLanguage('pt', base)).toBe('pt-BR')
    expect(localeForLanguage('es', base)).toBe('es')
  })
})

describe('grouping recipients', () => {
  test('one group per language, in the order each first appears, nobody lost', () => {
    const people = [contact('a', 'es'), contact('b'), contact('c', 'de'), contact('d', 'es-AR'), contact('e', 'fr')]
    const groups = groupByLocale(people, c => String(c.get('language') || ''), spanish)
    expect(groups.map(g => [g.locale, g.items.map(c => c.id)])).toEqual([['es', ['a', 'd']], ['en', ['b', 'c', 'e']]])
  })

  test('no one, no groups', () => {
    expect(groupByLocale([], () => '', spanish)).toEqual([])
  })
})

describe('the design in a language', () => {
  test('the translation\'s words go in; the original is not changed', () => {
    const localized = snapshotDocument(spanish, 'es')
    expect(localized.settings.title).toBe('Resumen semanal')
    expect(JSON.stringify(localized)).toContain('Tres ideas para tu viernes')
    expect(JSON.stringify(document)).not.toContain('Tres ideas')
    expect(snapshotDocument(spanish, 'en')).toBe(document)
    expect(snapshotDocument(spanish, 'de')).toBe(document)
  })

  test('a translation with its own subject replaces the campaign\'s line; without, the line stays', () => {
    expect(subjectForLocale(spanish, 'es', 'Our news')).toBe('')
    expect(subjectForLocale(spanish, 'en', 'Our news')).toBe('Our news')
    expect(subjectForLocale(snapshot({ es: { 'digest_title#text': 'Hola' } }), 'es', 'Our news')).toBe('Our news')
  })
})

describe('campaignEmails', () => {
  const mails = campaignEmails(project, spanish, [contact('ada', 'es'), contact('bob'), contact('cy', 'es-MX'), contact('dee', 'de')], options)
  const by = (name: string) => mails.find(m => m.to.name === name)!

  test('everyone gets one message, whatever their language', () => {
    expect(mails.map(m => m.to.name).sort()).toEqual(['ada', 'bob', 'cy', 'dee'])
  })

  test('a contact with language "es" gets the Spanish version, with the translated subject', () => {
    expect(by('ada').html).toContain('Tres ideas para tu viernes')
    expect(by('ada').subject).toBe('Resumen semanal')
    expect(by('cy').html).toContain('Tres ideas para tu viernes')
  })

  test('everyone else gets the template as designed', () => {
    for (const name of ['bob', 'dee']) {
      expect(by(name).html).toContain('Three ideas worth your Friday')
      expect(by(name).html).not.toContain('Tres ideas')
      expect(by(name).subject).toBe('Weekly digest')
    }
  })

  test('the campaign\'s own subject line is used where the translation has none, and a test is marked', () => {
    const plain = campaignEmails(project, snapshot({ es: { 'digest_title#text': 'Hola' } }), [contact('ada', 'es')], { ...options, subject: 'Our news', source: 'test' })
    expect(plain[0]!.subject).toBe('[Test] Our news')
  })

  test('each message has its own unsubscribe link and the log keeps the template', () => {
    expect(by('ada').html).toContain('/u/')
    expect(new Set(mails.map(m => m.headers['List-Unsubscribe'])).size).toBe(4)
    expect(by('ada').log.templateKey).toBe('digest')
  })
})

describe('contact.language', () => {
  test('is a variable the template can use', () => {
    expect(contactVariables(contact('ada', 'es'))['contact.language']).toBe('es')
    expect(contactVariables(contact('bob'))['contact.language']).toBe('')
  })
})

describe('compliance across languages', () => {
  test('a translation that loses the unsubscribe link or the address stops the send', () => {
    expect(snapshotProblems(project, spanish)).toEqual([])
    const broken = snapshot({ es: { subject: 'Hola', 'digest_footer#html': 'Sin salida' } })
    expect(translatedDocuments(broken).map(d => d.locale)).toEqual(['es'])
    const problems = snapshotProblems(project, broken)
    expect(problems).toHaveLength(2)
    expect(problems.join(' ')).toContain('es translation lost the unsubscribe link')
    expect(problems.join(' ')).toContain('es translation lost the postal address')
    expect(complianceProblems(project, document)).toEqual([])
  })
})

describe('keeping a snapshot on a row', () => {
  test('translation keys with dots survive as pairs, and old snapshots read back with none', () => {
    const withDots = snapshot({ es: { subject: 'Hola', 'blk#values.title': 'Título' } })
    const stored = snapshotToRow(withDots)
    expect(JSON.stringify(stored.translations)).not.toContain('values.title":')
    expect(snapshotFromRow(JSON.parse(JSON.stringify(stored))).translations).toEqual(withDots.translations)
    expect(snapshotFromRow({ document, defaults: {} }).translations).toEqual({})
    expect(snapshotFromRow(undefined).translations).toEqual({})
  })
})
