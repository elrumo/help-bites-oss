import { describe, expect, test } from 'bun:test'
import { DEFAULT_ACCENT, legacyTheme, projectLook } from '../shared/projectLook'

describe('projectLook', () => {
  test('a project that set nothing still has a usable look', () => {
    const look = projectLook({ name: 'Acme' })
    expect(look.accent).toBe(DEFAULT_ACCENT)
    expect(look.accentText).toBe('#ffffff')
    expect(look.logoUrl).toBe('')
    expect(look.fontFamily.body).toContain('system-ui')
    expect(look.radiusPx).toBe(8)
    expect(projectLook(null).accent).toBe(DEFAULT_ACCENT)
  })

  test('the Brand kit wins; the older Settings accent only fills in', () => {
    expect(projectLook({ theme: { accent: '#AA0000' } }).accent).toBe('#aa0000')
    expect(projectLook({ theme: { accent: '#aa0000' }, brand: { colors: [{ name: 'Sky', hex: '#00ff00' }] } }).accent).toBe('#00ff00')
    expect(projectLook({ theme: { accent: '#aa0000' }, brand: { colors: [{ name: 'Sky', hex: '#00ff00' }], page: { accent: '#0000ff' } } }).accent).toBe('#0000ff')
    expect(projectLook({ theme: { accent: 'red' } }).accent).toBe(DEFAULT_ACCENT)
  })

  test('logo and icon come from the kit, then the older fields, with the logo as the last icon', () => {
    expect(projectLook({ brandLook: { logoUrl: 'https://cdn.test/kit.svg', iconUrl: 'https://cdn.test/icon.png' }, brandLogoUrl: 'https://old.test/logo.png', iconUrl: 'https://old.test/icon.png' })).toMatchObject({ logoUrl: 'https://cdn.test/kit.svg', iconUrl: 'https://cdn.test/icon.png' })
    expect(projectLook({ brandLogoUrl: 'https://old.test/logo.png', iconUrl: 'https://old.test/icon.png' })).toMatchObject({ logoUrl: 'https://old.test/logo.png', iconUrl: 'https://old.test/icon.png' })
    expect(projectLook({ brandLogoUrl: 'https://old.test/logo.png' }).iconUrl).toBe('https://old.test/logo.png')
    expect(projectLook({ brandLogoUrl: 'javascript:alert(1)' }).logoUrl).toBe('')
    expect(projectLook({ brandLook: { logoUrl: 'https://cdn.test/a.svg' } }).logoDarkUrl).toBe('https://cdn.test/a.svg')
  })

  test('fonts and radius follow the kit', () => {
    const look = projectLook({ brand: { fonts: [{ name: 'Fraunces', role: 'display', cssUrl: 'https://fonts.googleapis.com/css2?family=Fraunces' }, { name: 'Inter', role: 'body' }], page: { radius: 'round', theme: 'dark' } } })
    expect(look.fontFamily.display).toStartWith('"Fraunces"')
    expect(look.fontFamily.body).toStartWith('"Inter"')
    expect(look.fontCssUrls).toEqual(['https://fonts.googleapis.com/css2?family=Fraunces'])
    expect(look.radiusPx).toBe(16)
    expect(look.scheme).toBe('dark')
  })

  test('legacyTheme keeps the older shape for clients that read project.theme', () => {
    expect(legacyTheme(projectLook({ brand: { page: { accent: '#112233' } } }), { accent: '#aa0000', dark: true })).toEqual({ accent: '#112233', dark: true })
  })
})
