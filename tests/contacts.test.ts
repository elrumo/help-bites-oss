import { describe, expect, test } from 'bun:test'
import { cleanAttributes, csvRecords, guessMapping, mapSourceRow, mappedColumns, normalizeEmail, parseCsv, readContactInput, readFlag, validateMapping } from '../shared/contacts'
import { applyContactInput, nextSubscription } from '../server/utils/contacts'

function fakeRow(fields: Record<string, unknown> = {}, isNew = false) {
  const data: Record<string, unknown> = { ...fields }
  return { data, get: (k: string) => data[k], set: (k: string, v: unknown) => { data[k] = v }, isNew: () => isNew } as any
}

describe('contact input', () => {
  test('emails are lowercased; junk is refused', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com')
    expect(normalizeEmail('not an email')).toBe('')
    expect(normalizeEmail('a@b')).toBe('')
    expect(readContactInput({ email: 'nope' }).errors.length).toBeGreaterThan(0)
    expect(readContactInput({ name: 'Ada' }).errors).toEqual(['Pass an email or an externalId'])
    expect(readContactInput({ externalId: 'u1', email: 'A@x.io', tags: 'a, b,a', subscription: 'subscribed' }).input)
      .toEqual({ externalId: 'u1', email: 'a@x.io', tags: ['a', 'b'], subscription: 'subscribed' })
  })

  test('attributes merge, null removes, keys must be plain', () => {
    expect(cleanAttributes({ plan: 'pro', seats: 3, old: null }, { old: 'x', keep: true })).toEqual({ attributes: { keep: true, plan: 'pro', seats: 3 }, errors: [] })
    expect(cleanAttributes({ 'a.b': 1 }).errors).toHaveLength(1)
    expect(cleanAttributes({ $set: 1 }).errors).toHaveLength(1)
    expect(cleanAttributes({ nested: { a: 1 } }).errors).toHaveLength(1)
  })
})

describe('consent', () => {
  test('opt-out wins; only the person themselves can undo it', () => {
    expect(nextSubscription('subscribed', 'unsubscribed', false)).toBe('unsubscribed')
    expect(nextSubscription('unsubscribed', 'subscribed', false)).toBeNull()
    expect(nextSubscription('unsubscribed', 'subscribed', true)).toBe('subscribed')
    expect(nextSubscription('none', 'subscribed', false)).toBe('subscribed')
    expect(nextSubscription('pending', 'subscribed', false)).toBeNull()
    expect(nextSubscription('subscribed', 'pending', true)).toBeNull()
    expect(nextSubscription('subscribed', 'none', false)).toBeNull()
  })

  test('a subscribe records consent and clears old topic opt-outs', () => {
    const row = fakeRow({ subscription: 'unsubscribed', unsubscribedTopics: ['news'] })
    const { changed, subscription } = applyContactInput(row, { email: 'a@x.io', subscription: 'subscribed' }, { via: 'form', explicit: true, consent: { ip: '1.2.3.4' } }, new Date('2026-10-01T00:00:00Z'))
    expect(changed).toBe(true)
    expect(subscription).toMatchObject({ from: 'unsubscribed', to: 'subscribed' })
    expect(row.data.consent).toEqual({ source: 'form', at: '2026-10-01T00:00:00.000Z', ip: '1.2.3.4' })
    expect(row.data.unsubscribedTopics).toEqual([])
  })

  test('imports fill blanks only, and an unchanged row stays unchanged', () => {
    const row = fakeRow({ email: 'a@x.io', name: 'Ada', subscription: 'none', attributes: { plan: 'pro' }, tags: ['x'] })
    applyContactInput(row, { email: 'a@x.io', name: 'Someone else', attributes: { plan: 'free', seats: 2 } }, { via: 'import', fillOnly: true })
    expect(row.data.name).toBe('Ada')
    expect(row.data.attributes).toEqual({ plan: 'pro', seats: 2 })
    const again = applyContactInput(row, { email: 'a@x.io', tags: ['x'] }, { via: 'import', fillOnly: true })
    expect(again.changed).toBe(false)
  })

  test('an externalId is set once, never replaced', () => {
    const row = fakeRow({ externalId: 'u1', subscription: 'none' })
    applyContactInput(row, { externalId: 'u2', email: 'a@x.io' }, { via: 'api' })
    expect(row.data.externalId).toBe('u1')
  })
})

describe('mapping and CSV', () => {
  test('CSV: quotes, doubled quotes, newlines in quotes, CRLF, BOM, blank lines', () => {
    expect(parseCsv('﻿email,name\r\n"a@x.io","Ada ""The"" Lovelace"\r\n\r\nb@x.io,"two\nlines"\n')).toEqual([
      ['email', 'name'], ['a@x.io', 'Ada "The" Lovelace'], ['b@x.io', 'two\nlines']
    ])
    expect(csvRecords('Email,Plan\na@x.io,pro\nb@x.io').records).toEqual([{ Email: 'a@x.io', Plan: 'pro' }, { Email: 'b@x.io', Plan: '' }])
  })

  test('a mapped row becomes a contact; rows with no email and no id are skipped', () => {
    const mapping = { externalId: 'objectId', email: 'email', name: 'profile.name', subscribed: 'newsletter', attributes: { plan: 'plan', since: 'createdAt' } }
    expect(mapSourceRow({ objectId: 'u1', email: 'A@X.io', profile: { name: 'Ada' }, newsletter: 'yes', plan: 'pro', createdAt: { __type: 'Date', iso: '2026-01-01T00:00:00.000Z' } }, mapping))
      .toEqual({ externalId: 'u1', email: 'a@x.io', name: 'Ada', subscription: 'subscribed', attributes: { plan: 'pro', since: '2026-01-01T00:00:00.000Z' } })
    expect(mapSourceRow({ newsletter: true }, mapping)).toBeNull()
    expect(mapSourceRow({ email: 'a@x.io', newsletter: 'maybe' }, mapping)).toEqual({ email: 'a@x.io' })
    expect(readFlag(0)).toBe(false)
    expect(readFlag('Opted_In')).toBe(true)
  })

  test('a mapping needs an email or an id, and only reads the columns it names', () => {
    expect(validateMapping({ name: 'name' }).errors).toEqual(['Map the email or the user id column'])
    const { mapping, errors } = validateMapping({ email: 'email', name: 'drop table', attributes: { plan: 'billing.plan', 'bad key': 'x' } })
    expect(mapping).toEqual({ email: 'email', attributes: { plan: 'billing.plan' } })
    expect(errors).toHaveLength(1)
    expect(mappedColumns(mapping)).toEqual(['email', 'billing'])
    expect(guessMapping(['User ID', 'E-mail', 'Full name', 'Tags'])).toMatchObject({ email: 'E-mail', externalId: 'User ID', name: 'Full name', tags: 'Tags' })
  })
})
