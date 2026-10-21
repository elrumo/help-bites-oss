import { createError } from 'h3'
import { companyEntity, companyIsEmpty, resolveCompany, validateCompany, type CompanyProfile } from '#shared/company'
import { normalizeLegalConfig } from '#shared/legal/config'
import { normalizeMarketingConfig } from '#shared/marketing'
import { MASTER, type ParseObject } from './parse'

// `Project.company` (shared/company.ts): one profile for Legal and campaigns.
// The saved profile is the source. Until a project saves one, the older
// `legal.entity` and `marketing.postalAddress` stand in, so reads never lose
// anything; saving writes the profile and mirrors it back into those two
// fields, so a client or a script that still reads them sees the same values.

type Row = { get: (key: string) => unknown }

/** The project's company profile, whichever field it still lives in. */
export function companyOf(project: Row): CompanyProfile {
  return resolveCompany(project.get('company'), {
    entity: normalizeLegalConfig(project.get('legal')).entity,
    postalAddress: normalizeMarketingConfig(project.get('marketing')).postalAddress
  })
}

/** Set (not saved) a partial profile on the project: validated, merged onto the current one, mirrored into the older fields. 400 when a value is bad. */
export function applyCompany(project: ParseObject, patch: unknown): CompanyProfile {
  const { company, errors } = validateCompany(patch, companyOf(project))
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  project.set('company', company)
  project.set('legal', { ...normalizeLegalConfig(project.get('legal')), entity: companyEntity(company) })
  project.set('marketing', { ...normalizeMarketingConfig(project.get('marketing')), postalAddress: company.address })
  return company
}

/** The first time a project is read after upgrading: copy what the older fields hold into the profile. Does nothing once a profile is saved, or when there is nothing to copy. */
export async function migrateCompany(project: ParseObject): Promise<void> {
  if (project.get('company') && typeof project.get('company') === 'object') return
  if (companyIsEmpty(companyOf(project))) return
  project.set('company', companyOf(project))
  await project.save(null, MASTER)
}
