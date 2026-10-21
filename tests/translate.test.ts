import { describe, expect, test } from 'bun:test'
import { defaultBlock, DEFAULT_SETTINGS, type EmailDocument } from '../shared/email/blocks'
import { emailTexts, localizeEmail } from '../shared/email/translate'
import { legalLabels } from '../shared/legal/labels'
import { localeName, matchLocale, normalizeLocale, parseAcceptLanguage } from '../shared/locales'
import {
  localizeOnboarding, onboardingTexts, translationFromTexts, translationTexts, validateOnboardingTranslations, type OnboardingStep
} from '../shared/onboarding'
import { isFaithful, mergeTranslated, parseTranslation, translatable, translationBatches, TRANSLATE_LIMITS } from '../shared/translate'
import { composeEmail, parseEmailRecipients, parseEmailSendRequest } from '../server/utils/emailSend'
import { renderLegalPage } from '../server/utils/legalPage'
import { renderLegalHtml } from '../server/utils/legalRender'

// Nitro auto-imports the server code reaches for; a Parse pointer's id is all this needs.
;(globalThis as Record<string, unknown>).pointerId = (value: { id?: string } | undefined) => value?.id || ''

const row = (id: string, fields: Record<string, unknown>) => ({ id, get: (key: string) => fields[key], updatedAt: new Date(0) }) as any
const status = (fn: () => unknown) => {
  try { fn() } catch (error) { return (error as { statusCode?: number }).statusCode }
  return 0
}

describe('locales', () => {
  test('tags are normalised and anything else is refused', () => {
    expect(normalizeLocale('pt_br')).toBe('pt-BR')
    expect(normalizeLocale('ZH-hant')).toBe('zh-Hant')
    expect(normalizeLocale(' es ')).toBe('es')
    expect(normalizeLocale('english')).toBeNull()
    expect(normalizeLocale('e')).toBeNull()
    expect(normalizeLocale('')).toBeNull()
    expect(normalizeLocale(42)).toBeNull()
    expect(localeName('es', 'en')).toBe('Spanish')
  })

  test('matching prefers the exact tag, then the same language, in the order wanted', () => {
    expect(matchLocale(['es-MX'], ['en', 'es'])).toBe('es')
    expect(matchLocale(['pt'], ['en', 'pt-BR'])).toBe('pt-BR')
    expect(matchLocale(['pt-PT', 'es'], ['en', 'pt-BR', 'es'])).toBe('pt-BR')
    expect(matchLocale(['fr', 'de'], ['en', 'es'])).toBeNull()
    expect(matchLocale([undefined, 'junk!', 'ES'], ['en', 'es'])).toBe('es')
  })

  test('Accept-Language is ordered by q and ignores what it cannot read', () => {
    expect(parseAcceptLanguage('fr;q=0.5, es-MX, en;q=0.8, *;q=0.1, xx_bad!')).toEqual(['es-MX', 'en', 'fr'])
    expect(parseAcceptLanguage('')).toEqual([])
    expect(parseAcceptLanguage('de;q=0')).toEqual([])
  })
})

describe('translation guards', () => {
  test('a translation must keep placeholders, URLs and tags', () => {
    expect(isFaithful('Hi {{firstName}}!', 'Hola {{ firstName }}!')).toBe(true)
    expect(isFaithful('Hi {{firstName}}!', 'Hola Ada!')).toBe(false)
    expect(isFaithful('Open {{{link}}}', 'Abre {{link}}')).toBe(false)
    expect(isFaithful('See <a href="https://acme.test/a">this</a>', 'Mira <a href="https://acme.test/a">esto</a>')).toBe(true)
    expect(isFaithful('See <a href="https://acme.test/a">this</a>', 'Mira <a href="https://evil.test/a">esto</a>')).toBe(false)
    expect(isFaithful('Hello <b>you</b>', 'Hola tú')).toBe(false)
    expect(isFaithful('Hello', '   ')).toBe(false)
  })

  test('only text with letters is worth sending', () => {
    expect(translatable('Welcome')).toBe(true)
    expect(translatable('{{firstName}}')).toBe(false)
    expect(translatable('https://acme.test/start')).toBe(false)
    expect(translatable('12 · 34')).toBe(false)
    expect(translatable('日本語')).toBe(true)
  })

  test('batches respect the count and the size', () => {
    const many = Array.from({ length: TRANSLATE_LIMITS.batchStrings * 2 + 1 }, (_, i) => [`k${i}`, 'x'] as [string, string])
    expect(translationBatches(many).map(b => b.length)).toEqual([TRANSLATE_LIMITS.batchStrings, TRANSLATE_LIMITS.batchStrings, 1])
    const big = [['a', 'x'.repeat(5000)], ['b', 'x'.repeat(5000)]] as Array<[string, string]>
    expect(translationBatches(big)).toHaveLength(2)
    expect(translationBatches([])).toEqual([])
  })

  test('a reply is usable only as a list of strings of the right length', () => {
    expect(parseTranslation(['a', 'b'], 2)).toEqual(['a', 'b'])
    expect(parseTranslation(['a'], 2)).toBeNull()
    expect(parseTranslation(['a', 3], 2)).toBeNull()
    expect(parseTranslation({ a: 1 }, 1)).toBeNull()
  })

  test('merging keeps what exists, takes what is new and drops what the source no longer has', () => {
    expect(mergeTranslated({ a: 'A', b: 'B' }, { a: 'x', old: 'y' }, { b: 'z' })).toEqual({ a: 'x', b: 'z' })
    expect(mergeTranslated({ a: 'A' }, { a: 'x' }, { a: 'new' })).toEqual({ a: 'new' })
  })
})

describe('onboarding translations', () => {
  const steps: OnboardingStep[] = [
    { id: 's1', title: 'Welcome', body: 'Start here', imageUrl: '', imageAlt: 'A screen', buttonLabel: '', pricingTable: '' },
    { id: 's2', title: 'Done', body: '', imageUrl: 'https://cdn.test/a.png', imageAlt: '', buttonLabel: 'Finish' }
  ]

  test('the flat texts leave out empty fields and round-trip into a translation', () => {
    const texts = onboardingTexts('Tour', steps)
    expect(Object.keys(texts)).toEqual(['name', 's1.title', 's1.body', 's1.imageAlt', 's2.title', 's2.buttonLabel'])
    const translation = translationFromTexts({ name: 'Visita', 's1.title': 'Bienvenido', 's2.buttonLabel': 'Terminar' }, steps)
    expect(translation).toEqual({ name: 'Visita', steps: { s1: { title: 'Bienvenido' }, s2: { buttonLabel: 'Terminar' } } })
    expect(translationTexts(translation)).toEqual({ 'name': 'Visita', 's1.title': 'Bienvenido', 's2.buttonLabel': 'Terminar' })
  })

  test('a translated flow falls back to the original word by word', () => {
    const localized = localizeOnboarding('Tour', steps, { name: '', steps: { s1: { title: 'Bienvenido' }, gone: { title: 'x' } } })
    expect(localized.name).toBe('Tour')
    expect(localized.steps[0]).toMatchObject({ title: 'Bienvenido', body: 'Start here' })
    expect(localized.steps[1]).toEqual(steps[1]!)
    expect(localizeOnboarding('Tour', steps, undefined).steps).toBe(steps)
  })

  test('translations from an operator are cleaned, replaced per language and removable', () => {
    const base = { fr: { name: 'Visite', steps: {} } }
    const { translations, errors } = validateOnboardingTranslations({ 'es_MX': { name: ' Visita ', steps: { s1: { title: 'Hola', body: '' }, nope: { title: 'x' } } }, fr: null }, steps, 'en', base)
    expect(errors).toEqual([])
    expect(translations).toEqual({ 'es-MX': { name: 'Visita', steps: { s1: { title: 'Hola' } } } })
    expect(validateOnboardingTranslations({ en: {} }, steps, 'en').errors).toEqual(["en is the flow's own language"])
    expect(validateOnboardingTranslations({ 'not a tag': {} }, steps, 'en').errors).toHaveLength(1)
    expect(validateOnboardingTranslations({ es: { steps: { s1: { title: 'x'.repeat(121) } } } }, steps, 'en').errors[0]).toContain('up to 120')
    expect(validateOnboardingTranslations([], steps, 'en').errors).toHaveLength(1)
    expect(validateOnboardingTranslations({ es: { steps: { s1: { body: 7 } } } }, steps, 'en').errors).toEqual(['es: body must be text'])
  })
})

describe('email translations', () => {
  const document: EmailDocument = {
    settings: { ...DEFAULT_SETTINGS, title: 'Welcome {{firstName}}', preheader: 'Your account is ready' },
    blocks: [
      { ...defaultBlock('heading', 'h1'), text: 'Hi {{firstName}}' } as any,
      { ...defaultBlock('button', 'b1'), label: 'Open the app', href: 'https://acme.test/open' } as any,
      { ...defaultBlock('html', 'x1'), html: '<p>Custom</p>' } as any
    ]
  }

  test('the words are found by block id, custom HTML and links are left alone', () => {
    const texts = emailTexts(document)
    expect(texts.subject).toBe('Welcome {{firstName}}')
    expect(texts.preheader).toBe('Your account is ready')
    expect(texts['h1#text']).toBe('Hi {{firstName}}')
    expect(texts['b1#label']).toBe('Open the app')
    expect(Object.keys(texts).some(k => k.startsWith('x1'))).toBe(false)
  })

  test('localizing swaps the words, keeps the rest and never touches the input', () => {
    const out = localizeEmail(document, { 'subject': 'Bienvenido {{firstName}}', 'h1#text': 'Hola {{firstName}}', 'b1#label': 'Abrir' })
    expect(out.settings.title).toBe('Bienvenido {{firstName}}')
    expect(out.settings.preheader).toBe('Your account is ready')
    expect((out.blocks[0] as any).text).toBe('Hola {{firstName}}')
    expect((out.blocks[1] as any).href).toBe('https://acme.test/open')
    expect((document.blocks[0] as any).text).toBe('Hi {{firstName}}')
  })

  test('a send picks the recipient\'s language, then the request\'s, then the template\'s own', () => {
    const template = row('t1', {
      name: 'Welcome', key: 'welcome', document, variables: [], locale: 'en',
      translations: { es: [{ key: 'subject', value: 'Bienvenido {{firstName}}' }, { key: 'h1#text', value: 'Hola {{firstName}}' }] }
    })
    const project = row('p1', { name: 'Acme' })
    const sender = { fromName: 'Acme', fromEmail: 'hello@mail.example.com', domain: 'mail.example.com', replyTo: '' }
    const send = (body: Record<string, unknown>) => {
      const request = parseEmailSendRequest({ template: 'welcome', variables: { firstName: 'Ada' }, ...body }, [])
      return composeEmail(project, { type: 'template', row: template }, request, request.recipients[0]!, sender)
    }
    const es = send({ to: [{ email: 'a@example.com', locale: 'es-MX' }] })
    expect(es.locale).toBe('es')
    expect(es.subject).toBe('Bienvenido Ada')
    expect(es.html).toContain('Hola Ada')
    expect(es.html).toContain('Open the app')
    expect(send({ to: 'a@example.com', locale: 'es' }).subject).toBe('Bienvenido Ada')
    expect(send({ to: [{ email: 'a@example.com', locale: 'en' }], locale: 'es' }).subject).toBe('Welcome Ada')
    const fallback = send({ to: 'a@example.com', locale: 'ja' })
    expect(fallback.locale).toBe('en')
    expect(fallback.subject).toBe('Welcome Ada')
    expect(send({ to: 'a@example.com' }).locale).toBe('en')
  })

  test('a bad language tag is a 400, and a recipient without one stays as it was', () => {
    expect(status(() => parseEmailSendRequest({ template: 'w', to: 'a@example.com', locale: 'klingon!' }, []))).toBe(400)
    expect(status(() => parseEmailRecipients([{ email: 'a@example.com', locale: 7 }]))).toBe(400)
    expect(parseEmailRecipients(['a@example.com'])).toEqual([{ email: 'a@example.com', name: '', variables: {} }])
  })
})

describe('legal page languages', () => {
  const section = { id: 's', heading: 'Contacto', body: 'Escríbenos.', source: 'ai' as const, locked: false, satisfies: [] }
  const project = row('p1', { name: 'Acme' })
  const doc = { type: 'privacy', slug: 'privacy-es', title: 'Política de privacidad', tldr: 'Resumen.', effectiveDate: '2026-10-19T00:00:00.000Z', version: 1, html: renderLegalHtml([section]), sections: [section] }

  test('labels follow the document\'s language, with English for the rest', () => {
    expect(legalLabels('es-MX').contents).toBe('Contenido')
    expect(legalLabels('ja').inShort).toBe('概要')
    expect(legalLabels('sw').contents).toBe('Contents')
    expect(legalLabels(undefined).contents).toBe('Contents')
  })

  test('a translated page speaks its language and links its siblings', () => {
    const page = renderLegalPage(project, {
      ...doc, locale: 'es', path: '/legal/pk_x/privacy-es', origin: 'https://help.acme.test',
      translations: [{ locale: 'en', title: 'Privacy Policy', path: '/legal/pk_x/privacy' }]
    }, [], null)
    expect(page).toContain('<html lang="es">')
    expect(page).toContain('En vigor desde el 19 de octubre de 2026')
    expect(page).toContain('Versión 1')
    expect(page).toContain('En resumen')
    expect(page).toContain('href="/legal/pk_x/privacy" hreflang="en" lang="en">English')
    expect(page).toContain('<link rel="alternate" hreflang="es" href="https://help.acme.test/legal/pk_x/privacy-es">')
    expect(page).toContain('<link rel="alternate" hreflang="en" href="https://help.acme.test/legal/pk_x/privacy">')
  })

  test('a document with no translations renders as it always did', () => {
    const page = renderLegalPage(project, doc, [], null)
    expect(page).toContain('<html lang="en">')
    expect(page).toContain('Effective October 19, 2026')
    expect(page).not.toContain('hreflang')
  })
})
