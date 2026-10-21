import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTACT_ORIGIN_TYPES } from '../shared/contacts'
import { LEAD_FIELD_TYPES, LEAD_FILE_EXTENSIONS, LEAD_FILE_KINDS, LEAD_FORM_FONTS, LEAD_FORM_KEY, LEAD_FORM_LAYOUTS, LEAD_FORM_LIMITS, LEAD_FORM_PRESETS, RESERVED_FIELD_KEYS } from '../shared/leadForms'
import { SEGMENT_FIELDS } from '../shared/segments'

// The native app hand-ports the lead form limits and choices, the ways a
// contact can be added, and the segment fields; this keeps the copies in step
// with shared/leadForms.ts, shared/contacts.ts and shared/segments.ts.

const native = (path: string) => join(import.meta.dir, '../helpbites-native/App/Features', path)
const missing = (src: string, values: Array<string | number>) => values.filter(v => typeof v === 'number' ? !new RegExp(`\\b${v}\\b`).test(src) : !src.includes(JSON.stringify(v)))

describe('native lead form parity', () => {
  test('LeadFormsModels.swift has every limit, the key pattern, the field types, file kinds, fonts, layouts, presets and reserved keys', () => {
    const file = native('Forms/LeadFormsModels.swift')
    expect(existsSync(file)).toBe(true)
    const swift = readFileSync(file, 'utf8')
    expect(missing(swift, [...Object.values(LEAD_FORM_LIMITS), LEAD_FORM_KEY.source, ...LEAD_FIELD_TYPES, ...LEAD_FILE_KINDS, ...LEAD_FORM_FONTS, ...LEAD_FORM_LAYOUTS, ...LEAD_FORM_PRESETS, ...RESERVED_FIELD_KEYS])).toEqual([])
    for (const [name, value] of Object.entries({ files: LEAD_FORM_LIMITS.files, fileMB: LEAD_FORM_LIMITS.fileMB })) expect([name, Number(new RegExp(`static let ${name} = (\\d+)`).exec(swift)?.[1])]).toEqual([name, value])
  })

  test('the editor\'s HTML snippet offers what each file kind takes', () => {
    const swift = readFileSync(native('Forms/LeadFormScreen.swift'), 'utf8')
    for (const [kind, exts] of Object.entries(LEAD_FILE_EXTENSIONS)) {
      const accept = new RegExp(`"${kind}": "([^"]+)"`).exec(swift)?.[1] || ''
      expect([kind, accept.split(',').sort()]).toEqual([kind, exts.map(e => `.${e}`).sort()])
    }
  })

  test('ContactsModels.swift knows every way a contact is added, and every segment field', () => {
    const swift = readFileSync(native('Contacts/ContactsModels.swift'), 'utf8')
    // `case app, leadForm = "lead_form", …`: a case's raw value is its name unless it says otherwise.
    const cases = /enum ContactOriginKind[^{]*\{\s*case ([^\n]+)/.exec(swift)?.[1] || ''
    const raw = cases.split(',').map(c => c.trim()).map(c => /"([^"]+)"/.exec(c)?.[1] || c)
    expect(raw).toEqual(CONTACT_ORIGIN_TYPES)
    expect(missing(swift, SEGMENT_FIELDS.map(f => f.key))).toEqual([])
  })
})
