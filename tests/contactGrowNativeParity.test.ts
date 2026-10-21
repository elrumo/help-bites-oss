import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIVITY_TYPES } from '../shared/activity'

// The native contact sheet hand-ports the activity kinds, the enrollment answer, the revenue
// rows' contact link and the language mapping; this keeps the copies in step.

const swift = (file: string) => readFileSync(join(import.meta.dir, '../helpbites-native/App/Features', file), 'utf8')

describe('native contact parity', () => {
  test('ContactActivity.swift has an icon for every kind of activity and asks for the ones the web asks for', () => {
    const source = swift('Contacts/ContactActivity.swift')
    expect(ACTIVITY_TYPES.filter(type => !source.includes(`"${type}"`))).toEqual([])
    expect(source).toContain('/v1/contacts/\\(contactId)/activity')
    expect(source).toContain('nextBefore')
  })

  test('the enrollment answer is decoded with every field the route returns', () => {
    const source = swift('Contacts/ContactsSequence.swift')
    for (const field of ['enrolled', 'skipped', 'truncated', 'notSubscribed', 'optedOut', 'alreadyEnrolled', 'notFound']) expect(source).toContain(field)
    const route = readFileSync(join(import.meta.dir, '../server/routes/v1/sequences/[id]/enrollments.post.ts'), 'utf8')
    for (const field of ['notSubscribed', 'optedOut', 'alreadyEnrolled', 'notFound']) expect(route).toContain(field)
  })

  test('revenue rows carry the contact they belong to, as the report sends it', () => {
    expect(swift('Revenue/RevenueModels.swift').match(/contactId/g)?.length).toBeGreaterThanOrEqual(2)
    expect(readFileSync(join(import.meta.dir, '../shared/stripe.ts'), 'utf8')).toContain('contactId')
  })

  test('the language column is mapped by import and sync like the web guesses it', () => {
    const guess = '^(language|lang|locale|preferredlanguage)$'
    for (const file of ['Contacts/ContactsImport.swift', 'Contacts/ContactsSources.swift']) expect(swift(file)).toContain(guess)
    expect(readFileSync(join(import.meta.dir, '../shared/contacts.ts'), 'utf8')).toContain(guess.replace('$', '$/'))
    expect(swift('Contacts/ContactsModels.swift')).toContain('let language: String?')
  })
})
