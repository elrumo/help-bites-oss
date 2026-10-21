import { describe, expect, test } from 'bun:test'
import { guessContactOrigin, originTypeForVia, readContactOrigin } from '../shared/contacts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_LEAD_CONTENT, EMBED_WORD_KEYS, LEAD_FILE_EXTENSIONS, LEAD_FORM_LIMITS, LEAD_FORM_WORDS, checkLeadFiles, detectLeadFile, fieldKeyFrom, leadFieldsOf, leadFormKeyFrom, leadFormMaxBytes, leadFormTexts, leadFormWords,
  leadOptionAliases, leadTranslationFromTexts, leadTranslationTexts, localizeLeadForm, presetForm, readLeadSubmission, validateLeadContent, validateLeadFields, validateLeadSettings,
  validateLeadStyle, validateLeadTranslations, type LeadFormField
} from '../shared/leadForms'
import { ALL_LEADS_SEGMENT, compileSegmentFilter, leadFormSegmentFilter, validateSegmentFilter } from '../shared/segments'
import { afterSignupUrl, leadConfirmToken, leadFormPage, leadMessagePage, readLeadConfirmToken, serializeLeadForm } from '../server/utils/leadForms'

// Lead forms (shared/leadForms.ts, server/utils/leadForms.ts): the fields a form
// may have, what a submission may say, how contacts remember where they came
// from, and the segments forms make.

process.env.HELPBITES_SECRET = 'test-secret-that-is-at-least-32-characters-long'

const fake = (id: string, fields: Record<string, unknown>) => ({ id, get: (k: string) => fields[k] }) as any

describe('fields', () => {
  test('a form always asks for an email, first when it was missing, and once', () => {
    const { fields, errors } = validateLeadFields([{ type: 'name' }, { type: 'text', label: 'Company' }])
    expect(errors).toEqual([])
    expect(fields.map(f => [f.type, f.key])).toEqual([['email', 'email'], ['name', 'name'], ['text', 'company']])
    expect(fields[0]!.required).toBe(true)
    expect(validateLeadFields([{ type: 'email' }, { type: 'email' }]).errors[0]).toContain('one email field')
  })

  test('other answers go to attributes: valid, unique, not reserved keys', () => {
    expect(validateLeadFields([{ type: 'text', key: 'bad key' }]).errors[0]).toContain('letters, digits')
    expect(validateLeadFields([{ type: 'text', key: 'website' }]).errors[0]).toContain('reserved')
    expect(validateLeadFields([{ type: 'text', key: 'plan' }, { type: 'number', key: 'plan' }]).errors[0]).toContain('used twice')
    expect(fieldKeyFrom('Company size')).toBe('company_size')
    expect(fieldKeyFrom('2 seats')).toBe('f_2_seats')
    expect(fieldKeyFrom('Website')).toBe('website_answer')
  })

  test('a choice needs options; types and counts are bounded', () => {
    expect(validateLeadFields([{ type: 'select', label: 'Role', options: [] }]).errors[0]).toContain('at least one option')
    expect(validateLeadFields([{ type: 'select', label: 'Role', options: ['A', 'A', ' B '] }]).fields[1]!.options).toEqual(['A', 'B'])
    expect(validateLeadFields([{ type: 'date' }]).errors[0]).toContain('type is one of')
    const many = Array.from({ length: 20 }, (_, i) => ({ type: 'text', key: `k${i}` }))
    expect(validateLeadFields(many).errors[0]).toContain(`at most ${LEAD_FORM_LIMITS.fields}`)
    expect(validateLeadFields(many).fields.length).toBe(LEAD_FORM_LIMITS.fields)
  })

  test('saved fields read back as they are, and still ask for an email', () => {
    expect(leadFieldsOf([]).map(f => f.type)).toEqual(['email'])
    expect(leadFieldsOf([{ id: 'a', key: 'email', type: 'email', label: 'Email', required: true }])[0]).toMatchObject({ id: 'a', options: [], placeholder: '' })
  })

  test('presets: a single email box on one row, a waitlist, a longer form', () => {
    expect(presetForm('email').fields.map(f => f.type)).toEqual(['email'])
    expect(presetForm('email').style.layout).toBe('inline')
    expect(presetForm('waitlist').fields.map(f => f.type)).toEqual(['email', 'name'])
    expect(validateLeadFields(presetForm('detailed').fields).errors).toEqual([])
  })
})

describe('content, style and settings', () => {
  test('only what is sent changes; the button and success title never go blank', () => {
    const { content } = validateLeadContent({ title: 'Soon', buttonLabel: '' })
    expect(content.title).toBe('Soon')
    expect(content.buttonLabel).toBe('Notify me')
    expect(validateLeadContent({ title: 'x'.repeat(200) }).errors[0]).toContain('up to 120')
  })

  test('colours, radius, font and layout are checked', () => {
    expect(validateLeadStyle({ accent: '#0EA5E9', layout: 'inline' }).style).toMatchObject({ accent: '#0ea5e9', layout: 'inline' })
    expect(validateLeadStyle({ accent: 'red', radius: 99, font: 'comic', layout: 'grid' }).errors).toHaveLength(4)
  })

  test('settings: tags cleaned, redirect must be a web address', () => {
    const { settings, errors } = validateLeadSettings({ doubleOptIn: false, tags: ['waitlist', ' waitlist ', 'beta'], redirectUrl: 'https://acme.test/thanks' })
    expect(errors).toEqual([])
    expect(settings).toMatchObject({ doubleOptIn: false, tags: ['waitlist', 'beta'], redirectUrl: 'https://acme.test/thanks' })
    expect(validateLeadSettings({ redirectUrl: 'javascript:alert(1)' }).errors[0]).toContain('http(s)')
    expect(validateLeadSettings({ doubleOptIn: 'yes' }).errors[0]).toContain('true or false')
  })
})

describe('a submission', () => {
  const fields: LeadFormField[] = validateLeadFields([
    { type: 'email' }, { type: 'name' }, { type: 'number', key: 'seats', label: 'Seats' }, { type: 'url', key: 'site', label: 'Site' },
    { type: 'select', key: 'role', label: 'Role', options: ['Founder', 'Developer'], required: true }, { type: 'checkbox', key: 'terms', label: 'I agree', required: true },
    { type: 'phone', key: 'phone', label: 'Phone' }, { type: 'textarea', key: 'note', label: 'Note' }
  ]).fields

  test('answers are typed for attributes; a plain form\'s strings work', () => {
    const { submission, errors } = readLeadSubmission(fields, { email: ' Ada@Example.COM ', name: 'Ada', seats: '3', site: 'https://ada.dev', role: 'Founder', terms: 'on', phone: '+44 20 7946 0958', note: 'Hi', extra: 'ignored' })
    expect(errors).toEqual([])
    expect(submission).toEqual({ email: 'ada@example.com', name: 'Ada', attributes: { seats: 3, site: 'https://ada.dev/', role: 'Founder', terms: true, phone: '+44 20 7946 0958', note: 'Hi' }, bot: false })
  })

  test('every problem is listed', () => {
    const { errors } = readLeadSubmission(fields, { email: 'nope', seats: 'many', site: 'ftp://x', role: 'CEO', phone: 'call me' })
    expect(errors).toEqual(['Enter a valid email address', 'Seats must be a number', 'Site must be a web address', 'Role: pick one of the options', 'I agree: tick the box to continue', 'Phone must be a phone number'])
  })

  test('optional answers may be left out; the honeypot marks bots', () => {
    const { submission, errors } = readLeadSubmission(fields.filter(f => !f.required || f.type === 'email'), { email: 'a@x.io', website: 'http://spam' })
    expect(errors).toEqual([])
    expect(submission.bot).toBe(true)
    expect(submission.attributes).toEqual({})
    // An optional box left unticked (a plain form sends nothing) is a "no".
    const box = validateLeadFields([{ type: 'checkbox', key: 'beta', label: 'Join the beta' }]).fields
    expect(readLeadSubmission(box, { email: 'a@x.io' }).submission.attributes).toEqual({ beta: false })
  })
})

describe('where a contact came from', () => {
  test('each writer stands for an origin', () => {
    expect(originTypeForVia('form')).toBe('signup')
    expect(originTypeForVia('import')).toBe('import')
    expect(originTypeForVia('lead_form')).toBe('lead_form')
    expect(originTypeForVia('mystery')).toBe('api')
  })

  test('stored origins are read strictly; older contacts get a best guess', () => {
    expect(readContactOrigin({ type: 'lead_form', id: 'lf1', at: '2026-01-01T00:00:00.000Z' })).toEqual({ type: 'lead_form', id: 'lf1', at: '2026-01-01T00:00:00.000Z' })
    expect(readContactOrigin({ type: 'carrier pigeon' })).toBeNull()
    expect(guessContactOrigin({ leadForms: ['lf1'], externalId: 'u1' })).toEqual({ type: 'lead_form', id: 'lf1', at: null })
    expect(guessContactOrigin({ sources: ['src1'] })).toEqual({ type: 'sync', id: 'src1', at: null })
    expect(guessContactOrigin({ consent: { source: 'import' } })?.type).toBe('import')
    expect(guessContactOrigin({ externalId: 'u1' })?.type).toBe('app')
    expect(guessContactOrigin({})).toBeNull()
  })
})

describe('segments', () => {
  test('a form\'s segment and every lead', () => {
    expect(compileSegmentFilter(leadFormSegmentFilter('lf1'))).toEqual({ leadForms: 'lf1' })
    expect(compileSegmentFilter(ALL_LEADS_SEGMENT)).toEqual({ leadForms: { $exists: true } })
    expect(validateSegmentFilter(leadFormSegmentFilter('lf1')).errors).toEqual([])
  })

  test('"added via" filters on the stored origin, and only on known ones', () => {
    expect(compileSegmentFilter({ match: 'all', rules: [{ field: 'origin', op: 'is', value: 'import' }] })).toEqual({ 'origin.type': 'import' })
    expect(validateSegmentFilter({ rules: [{ field: 'origin', op: 'is', value: 'telepathy' }] }).errors[0]).toContain('origin is one of')
  })
})

describe('server', () => {
  test('confirm links name the form, expire after a week and cannot be forged', () => {
    const now = Date.UTC(2026, 9, 1)
    const token = leadConfirmToken('p1', 'c1', 'lf1', 'pt-BR', now)
    expect(readLeadConfirmToken(token, now + 86_400_000)).toEqual({ projectId: 'p1', contactId: 'c1', formId: 'lf1', locale: 'pt-BR' })
    expect(readLeadConfirmToken(leadConfirmToken('p1', 'c1', 'lf1', '', now), now)?.locale).toBe('')
    expect(readLeadConfirmToken(token, now + 8 * 86_400_000)).toBeNull()
    expect(readLeadConfirmToken(`${Buffer.from('p1:c2:lf1:9999999999').toString('base64url')}.${token.split('.')[1]}`, now)).toBeNull()
  })

  test('the hosted page escapes everything, keeps what was typed and carries the honeypot', () => {
    const project = fake('p1', { name: '<Acme>', publicKey: 'pk_1', theme: { accent: '#112233' } })
    const row = fake('lf1', { key: 'waitlist', name: 'Waitlist', fields: validateLeadFields([{ type: 'email' }, { type: 'select', key: 'role', label: 'Role', options: ['A <b>', 'B'] }]).fields, content: { title: 'Join <now>' }, style: { accent: '#ff0000' }, settings: { doubleOptIn: true } })
    const html = leadFormPage(project, row, { values: { email: '"><script>', role: 'B' } })
    expect(html).toContain('&lt;Acme&gt;')
    expect(html).toContain('Join &lt;now&gt;')
    expect(html).toContain('action="/v1/forms/pk_1/waitlist"')
    expect(html).toContain('name="website"')
    expect(html).toContain('<option value="B" selected>B</option>')
    expect(html).toContain('A &lt;b&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('--accent: #ff0000')
    expect(leadFormPage(project, row, { sent: true })).toContain('confirm your email')
  })

  test('a form key from its name', () => {
    expect(leadFormKeyFrom('Launch Waitlist!')).toBe('launch-waitlist')
    expect(leadFormKeyFrom('')).toBe('waitlist')
  })
})

describe('uploads', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13])
  const pdf = new TextEncoder().encode('%PDF-1.7\n...')
  const zip = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 20, 0])

  test('file fields: at most three, a kind and a size within bounds', () => {
    const { fields, errors } = validateLeadFields([{ type: 'file', label: 'CV', accept: 'documents', maxMB: 5 }, { type: 'file', key: 'shot' }])
    expect(errors).toEqual([])
    expect(fields[1]).toMatchObject({ type: 'file', key: 'cv', accept: 'documents', maxMB: 5, placeholder: '' })
    expect(fields[2]).toMatchObject({ accept: 'any', maxMB: 10 })
    expect(fields[0]).toMatchObject({ accept: '', maxMB: 0 })
    expect(validateLeadFields(Array.from({ length: 4 }, (_, i) => ({ type: 'file', key: `f${i}` }))).errors.join()).toContain('3')
    expect(validateLeadFields([{ type: 'file', accept: 'videos' }]).errors.length).toBe(1)
    expect(validateLeadFields([{ type: 'file', maxMB: LEAD_FORM_LIMITS.fileMB + 1 }]).errors.length).toBe(1)
    expect(leadFieldsOf([{ id: 'a', type: 'file', key: 'cv' }])[1]).toMatchObject({ accept: 'any', maxMB: 10 })
  })

  test('a file is what its bytes say: pictures by bytes, documents by name and bytes', () => {
    expect(detectLeadFile(png, 'whatever.pdf', 'images')).toEqual({ ext: 'png', mime: 'image/png' })
    expect(detectLeadFile(png, 'a.png', 'documents')).toBeNull()
    expect(detectLeadFile(pdf, 'cv.pdf', 'documents')).toEqual({ ext: 'pdf', mime: 'application/pdf' })
    expect(detectLeadFile(pdf, 'cv.pdf', 'images')).toBeNull()
    expect(detectLeadFile(png.slice(4), 'cv.pdf', 'documents')).toBeNull()
    expect(detectLeadFile(zip, 'deck.pptx', 'documents')?.ext).toBe('pptx')
    expect(detectLeadFile(zip, 'site.zip', 'documents')).toBeNull()
    expect(detectLeadFile(zip, 'site.zip', 'any')?.mime).toBe('application/zip')
    expect(detectLeadFile(new TextEncoder().encode('<script>alert(1)</script>'), 'x.html', 'any')).toBeNull()
    expect(detectLeadFile(new Uint8Array([0x61, 0, 0x62]), 'notes.txt', 'documents')).toBeNull()
    expect(detectLeadFile(new Uint8Array(), 'a.png', 'any')).toBeNull()
  })

  test('a submission\'s files: required, within size, of a kind the field takes, with a safe name', () => {
    const fields = validateLeadFields([{ type: 'file', key: 'cv', label: 'CV', accept: 'documents', maxMB: 1, required: true }, { type: 'file', key: 'shot', accept: 'images' }]).fields
    expect(checkLeadFiles(fields, {}).errors).toEqual(['CV is required'])
    const big = new Uint8Array(1024 * 1024 + 1)
    big.set(pdf)
    expect(checkLeadFiles(fields, { cv: { filename: 'cv.pdf', data: big } }).errors).toEqual(['CV: the file is larger than 1 MB'])
    expect(checkLeadFiles(fields, { cv: { filename: 'cv.pdf', data: pdf }, shot: { filename: 'a.pdf', data: pdf } }, leadFormWords('es')).errors).toEqual(['Attach a file: este tipo de archivo no se acepta'])
    const ok = checkLeadFiles(fields, { cv: { filename: '../../etc/<cv>.pdf', data: pdf } })
    expect(ok.errors).toEqual([])
    expect(ok.files.map(f => [f.field.key, f.name, f.mime])).toEqual([['cv', '_cv_.pdf', 'application/pdf']])
    expect(leadFormMaxBytes(fields)).toBe((1 + 10 + 1) * 1024 * 1024)
  })

  test('readLeadSubmission leaves file fields to checkLeadFiles', () => {
    const fields = validateLeadFields([{ type: 'file', key: 'cv', required: true }]).fields
    expect(readLeadSubmission(fields, { email: 'a@b.co', cv: 'C:\\fakepath\\cv.pdf' })).toEqual({ submission: { email: 'a@b.co', name: '', attributes: {}, bot: false }, errors: [] })
  })
})

describe('translations', () => {
  const fields = validateLeadFields([{ type: 'email', id: 'fe', placeholder: 'you@example.com' }, { type: 'select', id: 'fs', key: 'role', label: 'Role', options: ['Developer', 'Designer'] }, { type: 'checkbox', id: 'fc', key: 'agree' }]).fields

  test('a translation is checked: language tags, not the form\'s own, known fields, bounded words; null removes one', () => {
    const { translations, errors } = validateLeadTranslations({ 'pt_br': { content: { title: 'Olá', bogus: 'x' }, fields: { fs: { label: 'Papel', options: ['Desenvolvedor', ''] }, nope: { label: 'x' } } }, es: { content: { title: 'Hola' } } }, fields, 'en')
    expect(errors).toEqual([])
    expect(translations['pt-BR']).toEqual({ content: { title: 'Olá' }, fields: { fs: { label: 'Papel', options: ['Desenvolvedor', ''] } } })
    expect(validateLeadTranslations({ en: { content: {} } }, fields, 'en').errors[0]).toContain('own language')
    expect(validateLeadTranslations({ 'not a tag': {} }, fields, 'en').errors[0]).toContain('not a language tag')
    expect(validateLeadTranslations({ es: { content: { title: 'x'.repeat(LEAD_FORM_LIMITS.title + 1) } } }, fields, 'en').errors.length).toBe(1)
    expect(Object.keys(validateLeadTranslations({ es: null }, fields, 'en', translations).translations)).toEqual(['pt-BR'])
  })

  test('a translator gets every word, default labels included, and its answer comes back as a translation', () => {
    const texts = leadFormTexts(DEFAULT_LEAD_CONTENT, fields)
    expect(texts['fe.label']).toBe('Email')
    expect(texts['fe.placeholder']).toBe('you@example.com')
    expect(texts['fs.options.1']).toBe('Designer')
    expect(texts['fc.label']).toBe('I agree')
    expect(texts['content.footnote']).toBeUndefined()
    const back = leadTranslationFromTexts({ 'content.title': 'Sé el primero', 'fs.options.0': 'Desarrollador', 'fc.label': 'Acepto' }, fields)
    expect(back).toEqual({ content: { title: 'Sé el primero' }, fields: { fs: { options: ['Desarrollador', ''] }, fc: { label: 'Acepto' } } })
    expect(leadTranslationTexts(back)).toEqual({ 'content.title': 'Sé el primero', 'fs.options.0': 'Desarrollador', 'fc.label': 'Acepto' })
  })

  test('a localized form keeps option values and says what they show; translated options are understood on the way back', () => {
    const translation = { content: { title: 'Hola' }, fields: { fs: { label: 'Rol', options: ['Desarrollador', ''] } } }
    const { content, fields: shown } = localizeLeadForm(DEFAULT_LEAD_CONTENT, fields, translation)
    expect(content.title).toBe('Hola')
    expect(content.buttonLabel).toBe(DEFAULT_LEAD_CONTENT.buttonLabel)
    expect(shown[1]).toMatchObject({ label: 'Rol', options: ['Developer', 'Designer'], optionLabels: ['Desarrollador', 'Designer'] })
    const aliases = leadOptionAliases(fields, { es: translation })
    expect(aliases).toEqual({ role: { Desarrollador: 'Developer' } })
    const words = leadFormWords('es-MX')
    expect(readLeadSubmission(shown, { email: 'a@b.co', role: 'Desarrollador', agree: 'on' }, { words, aliases }).submission.attributes).toEqual({ role: 'Developer', agree: true })
    expect(readLeadSubmission(shown, { email: 'nope', role: 'Nada' }, { words, aliases }).errors).toEqual(['Escribe un correo electrónico válido', 'Rol: elige una de las opciones'])
  })

  test('built-in words: every language has every word with the same blanks; others get English', () => {
    const blanks = (text: string) => (text.match(/\{\w+\}/g) || []).sort().join()
    for (const [lang, words] of Object.entries(LEAD_FORM_WORDS)) {
      expect([lang, Object.keys(words).sort()]).toEqual([lang, Object.keys(LEAD_FORM_WORDS.en).sort()])
      for (const [key, text] of Object.entries(words)) expect([lang, key, blanks(text)]).toEqual([lang, key, blanks(LEAD_FORM_WORDS.en[key as keyof typeof LEAD_FORM_WORDS.en])])
    }
    expect(leadFormWords('nl')).toBe(LEAD_FORM_WORDS.en)
    expect(leadFormWords('pt-BR')).toBe(LEAD_FORM_WORDS.pt)
  })

  test('forms.js carries the words it shows itself, in every language', () => {
    const js = readFileSync(join(import.meta.dir, '../public/forms.js'), 'utf8')
    const unescape = (text: string) => text.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    for (const [lang, words] of Object.entries(LEAD_FORM_WORDS)) {
      const block = js.match(new RegExp(`^ +${lang}: \\{(.*)\\},?$`, 'm'))?.[1]
      expect([lang, Boolean(block)]).toEqual([lang, true])
      for (const key of EMBED_WORD_KEYS) expect(unescape(block!)).toContain(`${key}: '${words[key].replace(/'/g, "\\'")}'`)
    }
    // And what a file field takes.
    for (const [kind, exts] of Object.entries(LEAD_FILE_EXTENSIONS)) {
      const accept = new Function(`${js.match(/var IMAGES = .*/)![0]}\n${js.match(/var DOCUMENTS = .*/)![0]}\n${js.match(/var ACCEPT = .*/)![0]}\nreturn ACCEPT`)()[kind] as string
      expect([kind, accept.split(',').sort()]).toEqual([kind, exts.map(e => `.${e}`).sort()])
    }
  })

  test('the hosted page speaks the language asked for, and so do its messages and the way back', () => {
    const project = fake('p1', { name: 'Acme', publicKey: 'pk_1' })
    const row = fake('lf1', {
      key: 'waitlist', name: 'Waitlist', locale: 'en', settings: { doubleOptIn: false },
      fields: validateLeadFields([{ type: 'email', id: 'fe' }, { type: 'file', id: 'ff', key: 'cv', label: 'CV', accept: 'documents', maxMB: 4 }]).fields,
      translations: { es: { content: { title: 'Únete', buttonLabel: 'Avísame' }, fields: { ff: { label: 'Currículum' } } } }
    })
    const html = leadFormPage(project, row, { wanted: ['es-ES', 'en'] })
    expect(html).toContain('<html lang="es">')
    expect(html).toContain('Únete')
    expect(html).toContain('Currículum')
    expect(html).toContain('Hasta 4 MB')
    expect(html).toContain('enctype="multipart/form-data"')
    expect(html).toContain('accept=".pdf,.docx')
    expect(html).toContain('name="locale" value="es"')
    expect(leadFormPage(project, row, { wanted: ['fr'] })).toContain('<html lang="en">')
    expect(leadMessagePage({ name: 'x', logoUrl: '', accent: '#000000' }, ['nl', 'de-AT'], 'closed')).toContain('Dieses Formular ist geschlossen')
    expect(leadMessagePage({ name: 'x', logoUrl: '', accent: '#000000' }, ['ar'], 'expired')).toContain('This link has expired')
    const form = serializeLeadForm(project, row)
    expect(afterSignupUrl(project, form, 'es')).toBe('/f/pk_1/waitlist?sent=1&locale=es')
    expect(afterSignupUrl(project, form, 'en')).toBe('/f/pk_1/waitlist?sent=1')
  })
})
