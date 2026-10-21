import { describe, expect, test } from 'bun:test'
import { COMPANY_LIMITS, companyEntity, companyIsEmpty, normalizeCompany, resolveCompany, validateCompany } from '../shared/company'
import { applyCompany, companyOf, migrateCompany } from '../server/utils/company'
import { complianceProblems } from '../server/utils/campaigns'
import { legalDefaults, prepareAnswers } from '../server/utils/legal'
import { brandOf } from '../server/utils/emails'
import { applyProjectInput, serializeAdminProject } from '../server/utils/projects'
import { DEFAULT_SETTINGS, type EmailDocument } from '../shared/email/blocks'

/** A project row in memory: reads and writes go to `values`. */
function project(values: Record<string, unknown> = {}) {
  const row = { id: 'p1', get: (key: string) => values[key], set: (key: string, value: unknown) => { values[key] = value }, unset: (key: string) => { delete values[key] }, save: async () => row, values }
  return row as unknown as ParseObject & { values: Record<string, unknown> }
}

describe('company profile rules', () => {
  test('values are trimmed, limited and checked', () => {
    expect(normalizeCompany({ name: '  Acme  ', website: 'https://acme.test/about', ignored: 1 })).toMatchObject({ name: 'Acme', website: 'https://acme.test/about', email: '' })
    expect(validateCompany({ email: 'nope' }).errors).toEqual(['company.email must be an email address'])
    expect(validateCompany({ website: 'javascript:alert(1)' }).errors).toEqual(['company.website must be an http(s) URL'])
    expect(validateCompany({ phone: '+351 21 000 0000' }).errors).toEqual([])
    expect(validateCompany({ phone: '<b>1</b>' }).errors).toHaveLength(1)
    expect(validateCompany({ address: 'x'.repeat(COMPANY_LIMITS.address + 1) }).errors).toHaveLength(1)
    expect(validateCompany('nope').errors).toEqual(['company must be an object'])
    // Only the keys sent change; a bad value is reported and not applied.
    const { company, errors } = validateCompany({ email: 'bad', phone: '123' }, normalizeCompany({ name: 'Acme', email: 'a@acme.test' }))
    expect(errors).toHaveLength(1)
    expect(company).toMatchObject({ name: 'Acme', email: 'a@acme.test', phone: '123' })
  })

  test('without a saved profile the older fields stand in; a saved one is the only source', () => {
    const legacy = { entity: { name: 'Acme Ltd', address: '1 Main St', email: 'legal@acme.test', dpo: 'Dana' }, postalAddress: '2 Other St' }
    expect(resolveCompany(undefined, legacy)).toMatchObject({ legalName: 'Acme Ltd', address: '1 Main St', email: 'legal@acme.test', dpo: 'Dana', name: '' })
    expect(resolveCompany(null, { postalAddress: '2 Other St' }).address).toBe('2 Other St')
    // Clearing a field in a saved profile sticks: the old value does not come back.
    expect(resolveCompany({ name: 'Acme', address: '' }, legacy).address).toBe('')
    expect(companyIsEmpty(resolveCompany(undefined))).toBe(true)
    expect(companyEntity(normalizeCompany({ name: 'Acme', address: 'x' }))).toEqual({ name: 'Acme', address: 'x', email: '', dpo: '' })
    expect(companyEntity(normalizeCompany({ name: 'Acme', legalName: 'Acme Ltd' })).name).toBe('Acme Ltd')
  })
})

describe('company profile on a project', () => {
  test('reads fall back to legal.entity and marketing.postalAddress, and the first save copies them', async () => {
    const p = project({ name: 'Acme', legal: { entity: { name: 'Acme Ltd', address: '1 Main St', email: 'legal@acme.test', dpo: '' } }, marketing: { postalAddress: '' } })
    expect(companyOf(p)).toMatchObject({ legalName: 'Acme Ltd', address: '1 Main St' })
    expect(p.values.company).toBeUndefined()
    await migrateCompany(p)
    expect(p.values.company).toMatchObject({ legalName: 'Acme Ltd', address: '1 Main St', email: 'legal@acme.test' })
    // The older fields are left exactly as they were.
    expect((p.values.legal as any).entity.name).toBe('Acme Ltd')
    // Once saved, migrating again changes nothing.
    p.values.company = { ...(p.values.company as object), address: 'Moved' }
    await migrateCompany(p)
    expect(companyOf(p).address).toBe('Moved')
  })

  test('saving the profile mirrors it into the older fields', () => {
    const p = project({ legal: { font: 'serif' }, marketing: { doubleOptIn: false, topics: [] } })
    applyCompany(p, { name: 'Acme', legalName: 'Acme Ltd', address: '1 Main St', email: 'hi@acme.test', dpo: 'Dana' })
    expect(p.values.company).toMatchObject({ name: 'Acme', legalName: 'Acme Ltd', address: '1 Main St' })
    expect((p.values.legal as any)).toMatchObject({ font: 'serif', entity: { name: 'Acme Ltd', address: '1 Main St', email: 'hi@acme.test', dpo: 'Dana' } })
    expect((p.values.marketing as any)).toMatchObject({ doubleOptIn: false, postalAddress: '1 Main St' })
    expect(() => applyCompany(p, { email: 'nope' })).toThrow()
  })

  test('PATCH company, and the older legal.entity and marketing.postalAddress, all land in the one profile', async () => {
    const p = project({ name: 'Acme' })
    await applyProjectInput(p, { company: { name: 'Acme', address: '1 Main St' } })
    expect(companyOf(p)).toMatchObject({ name: 'Acme', address: '1 Main St' })
    await applyProjectInput(p, { legal: { entity: { name: 'Acme Ltd', email: 'legal@acme.test' } } })
    expect(companyOf(p)).toMatchObject({ name: 'Acme', legalName: 'Acme Ltd', email: 'legal@acme.test', address: '1 Main St' })
    await applyProjectInput(p, { marketing: { postalAddress: '2 New St' } })
    expect(companyOf(p).address).toBe('2 New St')
    // Both at once: the profile is applied last and wins.
    await applyProjectInput(p, { marketing: { postalAddress: '3 Old St' }, company: { address: '4 Chosen St' } })
    expect(companyOf(p).address).toBe('4 Chosen St')
    await expect(applyProjectInput(p, { company: { email: 'nope' } })).rejects.toThrow()
    // The admin DTO shows the profile through the older shapes too.
    p.values.publicKey = 'pk_x'
    const dto = serializeAdminProject(p)
    expect(dto.company.address).toBe('4 Chosen St')
    expect(dto.legal.entity).toMatchObject({ name: 'Acme Ltd', address: '4 Chosen St' })
    expect(dto.marketing.postalAddress).toBe('4 Chosen St')
  })

  test('legal answers start from the profile, and campaigns want its address', () => {
    const p = project({ name: 'Acme', siteUrl: 'https://acme.test', company: { name: 'Acme', legalName: 'Acme Ltd', address: '1 Main St', email: 'legal@acme.test', dpo: 'Dana' } })
    expect(legalDefaults(p)).toMatchObject({ app_name: 'Acme', entity_name: 'Acme Ltd', entity_address: '1 Main St', contact_email: 'legal@acme.test', dpo_contact: 'Dana', website_url: 'https://acme.test' })
    const footer: EmailDocument = { settings: DEFAULT_SETTINGS, blocks: [{ id: 'f', type: 'text', html: '{{unsubscribeUrl}} {{project.address}}', align: 'center' }] }
    expect(complianceProblems(p, footer)).toEqual([])
    const without = project({ name: 'Acme' })
    expect(complianceProblems(without, footer).join(' ')).toContain('Project settings → Company')
    // An address that only the older field has still counts.
    expect(complianceProblems(project({ marketing: { postalAddress: '1 Main St' } }), footer)).toEqual([])
    expect(prepareAnswers).toBeFunction()
  })

  test('the email brand carries the company address, name and email', () => {
    const brand = brandOf(project({ name: 'Acme', company: { name: 'Acme', address: '1 Main St', email: 'hi@acme.test' } }))
    expect(brand.address).toBe('1 Main St')
    expect(brand.company).toMatchObject({ name: 'Acme', email: 'hi@acme.test' })
  })
})
