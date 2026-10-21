import { describe, expect, test } from 'bun:test'
import { DEFAULT_ACCENT } from '../shared/projectLook'
import { blogPageProject } from '../server/utils/blogPage'
import { brandOf } from '../server/utils/emails'
import { formProjectLook } from '../server/utils/leadForms'
import { legalLook } from '../server/utils/legalPage'
import { pageBrand } from '../server/utils/marketingPages'
import { flowProjectLook } from '../server/utils/onboarding'
import { lookOf, serializePublicProject } from '../server/utils/projects'

// One project, every surface that wears its look: they must all show the same
// accent and logo, whatever the older per-feature fields say.

const row = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] }) as unknown as ParseObject

const kit = row({
  name: 'Acme',
  // Settings' older accent disagrees with the kit on purpose.
  theme: { accent: '#aa0000' },
  brand: { colors: [{ name: 'Sky', hex: '#0ea5e9' }], page: { accent: '#16a34a' } },
  brandLogoUrl: 'https://old.test/logo.png',
  iconUrl: 'https://old.test/icon.png',
  brandLook: { logoUrl: 'https://cdn.test/kit-logo.svg', iconUrl: 'https://cdn.test/kit-icon.png' }
})

describe('every reader of the project look agrees', () => {
  test('the Brand kit wins on every surface', () => {
    const accent = '#16a34a'
    const logo = 'https://cdn.test/kit-logo.svg'
    expect(lookOf(kit)).toMatchObject({ accent, logoUrl: logo })
    expect(pageBrand(kit)).toMatchObject({ name: 'Acme', accent, logoUrl: logo })
    expect(blogPageProject(kit)).toMatchObject({ name: 'Acme', accent, logo })
    expect(legalLook(kit)).toMatchObject({ name: 'Acme', accent, logo })
    expect(formProjectLook(kit)).toEqual({ name: 'Acme', accent, logoUrl: logo })
    expect(flowProjectLook(kit)).toEqual({ name: 'Acme', accent, logoUrl: logo })
    const email = brandOf(kit)
    expect(email.theme?.accent).toBe(accent)
    expect(email.look).toEqual({ accent, logoUrl: logo })
    expect(email.brandLogoUrl).toBe(logo)
    // The public DTO older loaders read carries the same colour.
    expect(serializePublicProject(kit).theme.accent).toBe(accent)
    expect(serializePublicProject(kit).brandLogoUrl).toBe(logo)
  })

  test('a project that never filled the kit in keeps its older fields', () => {
    const old = row({ name: 'Old', theme: { accent: '#AA0000' }, brandLogoUrl: 'https://old.test/logo.png' })
    expect(pageBrand(old).accent).toBe('#aa0000')
    expect(blogPageProject(old).accent).toBe('#aa0000')
    expect(legalLook(old).accent).toBe('#aa0000')
    expect(formProjectLook(old)).toEqual({ name: 'Old', accent: '#aa0000', logoUrl: 'https://old.test/logo.png' })
    expect(flowProjectLook(old).accent).toBe('#aa0000')
  })

  test('with nothing set every surface uses the one default accent', () => {
    const bare = row({ name: 'Bare' })
    expect(DEFAULT_ACCENT).toBe('#4f46e5')
    for (const accent of [pageBrand(bare).accent, blogPageProject(bare).accent, legalLook(bare).accent, formProjectLook(bare).accent, flowProjectLook(bare).accent, brandOf(bare).theme?.accent]) expect(accent).toBe(DEFAULT_ACCENT)
  })

  test('the legal pages keep their own accent, logo and font as overrides', () => {
    const own = row({ name: 'Acme', brand: { page: { accent: '#16a34a' } }, brandLook: { logoUrl: 'https://cdn.test/kit-logo.svg' }, legal: { accent: '#7c3aed', logoUrl: 'https://legal.test/logo.png', font: 'serif' } })
    const look = legalLook(own)
    expect(look.accent).toBe('#7c3aed')
    expect(look.logo).toBe('https://legal.test/logo.png')
    expect(look.font).toContain('Georgia')
    // The other surfaces still follow the kit.
    expect(pageBrand(own).accent).toBe('#16a34a')
    expect(blogPageProject(own).logo).toBe('https://cdn.test/kit-logo.svg')
  })
})
