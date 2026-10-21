import { describe, expect, test } from 'bun:test'
import { guessContactOrigin, originTypeForVia, readContactOrigin } from '../shared/contacts'
import { LEAD_FORM_LIMITS, fieldKeyFrom, leadFieldsOf, leadFormKeyFrom, presetForm, readLeadSubmission, validateLeadContent, validateLeadFields, validateLeadSettings, validateLeadStyle, type LeadFormField } from '../shared/leadForms'
import { ALL_LEADS_SEGMENT, compileSegmentFilter, leadFormSegmentFilter, validateSegmentFilter } from '../shared/segments'
import { leadConfirmToken, leadFormPage, readLeadConfirmToken } from '../server/utils/leadForms'

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
    const token = leadConfirmToken('p1', 'c1', 'lf1', now)
    expect(readLeadConfirmToken(token, now + 86_400_000)).toEqual({ projectId: 'p1', contactId: 'c1', formId: 'lf1' })
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
    expect(html).toContain('<option selected>B</option>')
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
