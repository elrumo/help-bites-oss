import { safeHttpUrl } from './support'

// The project's company profile (`Project.company`): who is behind the product,
// written once. Legal documents (the operator's name, address, contact and data
// protection officer) and campaigns (the postal address every marketing email
// must carry) both read it instead of keeping their own copy.
//
// Projects that predate it keep those answers in `legal.entity` and
// `marketing.postalAddress`; `resolveCompany` reads them until the profile is
// first saved, so nothing is lost and no migration has to run.

export type CompanyProfile = {
  /** The name people know: used where a company name is shown (`{{project.company}}`). */
  name: string
  /** The registered name, for contracts and notices; '' means the name above. */
  legalName: string
  /** Postal address, as it should be printed. */
  address: string
  /** Public contact address. */
  email: string
  phone: string
  /** The company's own website (not the product's `siteUrl`). */
  website: string
  /** Data protection officer or privacy contact. */
  dpo: string
}

export const COMPANY_FIELDS = ['name', 'legalName', 'address', 'email', 'phone', 'website', 'dpo'] as const satisfies readonly (keyof CompanyProfile)[]

export const COMPANY_LIMITS: Record<keyof CompanyProfile, number> = { name: 120, legalName: 120, address: 300, email: 200, phone: 40, website: 300, dpo: 200 }

export const DEFAULT_COMPANY: CompanyProfile = { name: '', legalName: '', address: '', email: '', phone: '', website: '', dpo: '' }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Digits and the punctuation people type in numbers; no letters, so it cannot carry markup.
const PHONE = /^[+\d][\d\s().\-/]*$/

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})

export function normalizeCompany(value: unknown): CompanyProfile {
  return validateCompany(value).company
}

/** Validate a (partial) profile on top of `base`: only the keys sent change; bad values are reported, not applied. */
export function validateCompany(value: unknown, base: CompanyProfile = DEFAULT_COMPANY): { company: CompanyProfile, errors: string[] } {
  const errors: string[] = []
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) errors.push('company must be an object')
  const raw = record(value)
  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...base }
  for (const key of COMPANY_FIELDS) {
    if (raw[key] === undefined) continue
    const text = typeof raw[key] === 'string' ? (raw[key] as string).trim() : null
    if (text === null || text.length > COMPANY_LIMITS[key]) errors.push(`company.${key} is up to ${COMPANY_LIMITS[key]} characters`)
    else if (key === 'email' && text && !EMAIL.test(text)) errors.push('company.email must be an email address')
    else if (key === 'phone' && text && !PHONE.test(text)) errors.push('company.phone may hold digits, spaces and + ( ) - . only')
    else if (key === 'website' && text && !safeHttpUrl(text)) errors.push('company.website must be an http(s) URL')
    else company[key] = key === 'website' ? safeHttpUrl(text) : text
  }
  return { company, errors }
}

/** What a project had before the profile existed. */
export type LegacyCompany = {
  /** `Project.legal.entity` */
  entity?: { name?: string, address?: string, email?: string, dpo?: string }
  /** `Project.marketing.postalAddress` */
  postalAddress?: string
}

/**
 * The profile a project has: the saved one when there is one (it is then the
 * only source, so clearing a field sticks), else what the older fields hold.
 */
export function resolveCompany(stored: unknown, legacy: LegacyCompany = {}): CompanyProfile {
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) return normalizeCompany(stored)
  const entity = legacy.entity || {}
  return normalizeCompany({
    legalName: entity.name,
    address: entity.address || legacy.postalAddress,
    email: entity.email,
    dpo: entity.dpo
  })
}

/** True when nothing is filled in. */
export const companyIsEmpty = (company: CompanyProfile): boolean => COMPANY_FIELDS.every(key => !company[key])

/** The name documents name as the operator: the registered name, else the everyday one. */
export const companyLegalName = (company: CompanyProfile): string => company.legalName || company.name

/** The older `legal.entity` shape, for the legal wizard and clients that still read it. */
export function companyEntity(company: CompanyProfile): { name: string, address: string, email: string, dpo: string } {
  return { name: companyLegalName(company), address: company.address, email: company.email, dpo: company.dpo }
}
