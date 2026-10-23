import { describe, expect, test } from 'bun:test'
import { DEFAULT_FEEDBACK_CONFIG, validateFeedbackConfig } from '../shared/feedback'
import { DEFAULT_CHANGELOG_CONFIG, normalizeChangelogConfig, validateChangelogConfig } from '../shared/changelog'
import { projectLook } from '../shared/projectLook'
import { DEFAULT_PROJECT_STYLE, normalizeProjectStyle, overlayStyle, resolveStyle, styleFrom, styleVars, validateProjectStyle } from '../shared/projectStyle'

const base = { accent: '#4f46e5', radiusPx: 8, fontFamily: 'system-ui', logoUrl: '', logoDarkUrl: '', iconUrl: '' }

describe('projectStyle', () => {
  test('a style that sets nothing still resolves in light and dark', () => {
    const style = resolveStyle(base, DEFAULT_PROJECT_STYLE)
    expect(style).toMatchObject({ scheme: 'auto', radius: 8, shadow: 'soft' })
    expect(style.light).toMatchObject({ accent: '#4f46e5', background: '#ffffff' })
    expect(style.dark).toMatchObject({ accent: '#4f46e5', background: '#0c0a09' })
  })

  test('validation is partial and reports bad values without applying them', () => {
    const first = validateProjectStyle({ scheme: 'dark', light: { accent: '#AA0000' }, radius: 12 })
    expect(first.errors).toEqual([])
    expect(first.style).toMatchObject({ scheme: 'dark', radius: 12, light: { accent: '#aa0000' } })
    // Only the keys sent change; light merges colour by colour, null clears the radius.
    const next = validateProjectStyle({ light: { text: '#111111' }, radius: null }, first.style).style
    expect(next.light).toMatchObject({ accent: '#aa0000', text: '#111111' })
    expect(next.radius).toBeNull()
    const bad = validateProjectStyle({ scheme: 'sepia', radius: 99, shadow: 'huge', dark: { accent: 'red' }, logoUrl: 'javascript:alert(1)' }, first.style)
    expect(bad.errors).toHaveLength(5)
    expect(bad.style).toEqual(first.style)
    expect(validateProjectStyle('nope').errors).toEqual(['style must be an object'])
  })

  test('the dark palette follows the light accent until it sets its own', () => {
    const style = normalizeProjectStyle({ light: { accent: '#ff0000' } })
    expect(resolveStyle(base, style).dark.accent).toBe('#ff0000')
    expect(resolveStyle(base, normalizeProjectStyle({ light: { accent: '#ff0000' }, dark: { accent: '#00ff00' } })).dark.accent).toBe('#00ff00')
  })

  test('a feature overlay changes only what it sets', () => {
    const project = normalizeProjectStyle({ scheme: 'light', radius: 4, shadow: 'strong', light: { accent: '#112233' } })
    const feature = normalizeProjectStyle({ radius: 16, dark: { background: '#000000' } })
    const merged = overlayStyle(project, feature)
    expect(merged).toMatchObject({ scheme: 'light', radius: 16, shadow: 'strong', light: { accent: '#112233' }, dark: { background: '#000000' } })
    expect(resolveStyle(base, project, feature).dark.background).toBe('#000000')
  })

  test('css variables carry the scheme asked for', () => {
    const style = resolveStyle(base, normalizeProjectStyle({ light: { accent: '#ffffff' }, shadow: 'none', radius: 0 }))
    expect(styleVars(style, 'light')).toMatchObject({ '--hb-accent': '#ffffff', '--hb-accent-text': '#000000', '--hb-bg': '#ffffff', '--hb-radius': '0px', '--hb-shadow': 'none' })
    expect(styleVars(style, 'dark')['--hb-bg']).toBe('#0c0a09')
  })

  test('the project look wears the project style over the Brand kit', () => {
    const look = projectLook({ name: 'Acme', brand: { page: { accent: '#00ff00', radius: 'round' } }, style: { light: { accent: '#0000ff' }, logoUrl: 'https://cdn.test/logo.svg', logoDarkUrl: 'https://cdn.test/logo-dark.svg', radius: 3 } })
    expect(look).toMatchObject({ accent: '#0000ff', radiusPx: 3, logoUrl: 'https://cdn.test/logo.svg', logoDarkUrl: 'https://cdn.test/logo-dark.svg' })
    expect(look.style.light.accent).toBe('#0000ff')
    // Without a style the kit still decides.
    expect(projectLook({ brand: { page: { accent: '#00ff00', radius: 'round' } } })).toMatchObject({ accent: '#00ff00', radiusPx: 16 })
    expect(look.kit.accent).toBe('#00ff00')
    expect(resolveStyle(look.kit, look.projectStyle, normalizeProjectStyle({ light: { accent: '#abcdef' } })).light.accent).toBe('#abcdef')
  })

  test('a project style logo does not borrow the kit\'s dark logo', () => {
    const look = projectLook({ brandLook: { logoUrl: 'https://cdn.test/kit.svg', logoDarkUrl: 'https://cdn.test/kit-dark.svg' }, style: { logoUrl: 'https://cdn.test/mine.svg' } })
    expect(look.logoDarkUrl).toBe('https://cdn.test/mine.svg')
  })
})

describe('styleFrom', () => {
  test('offers only what maps onto a project style, and leaves empty colours unset', () => {
    const project = normalizeProjectStyle({ light: { accent: '#112233', text: '#222222' }, font: 'serif' })
    const offered = styleFrom({ accent: '#abcdef', background: '', text: '', radius: 20, font: 'rounded', scheme: 'dark', logoUrl: '' })
    expect(offered).toEqual({ light: { accent: '#abcdef', background: '', surface: '', text: '', muted: '', border: '' }, radius: 20, scheme: 'dark' })
    const next = overlayStyle(project, validateProjectStyle(offered).style)
    expect(next).toMatchObject({ light: { accent: '#abcdef', text: '#222222' }, radius: 20, scheme: 'dark', font: 'serif' })
  })
})

describe('changelog style', () => {
  test('new projects use the project style', () => {
    expect(DEFAULT_CHANGELOG_CONFIG.style.source).toBe('project')
    expect(normalizeChangelogConfig(undefined).style.custom).toEqual(DEFAULT_PROJECT_STYLE)
  })

  test('the changelog style is partial like the rest of the config', () => {
    const one = validateChangelogConfig({ style: { source: 'custom', custom: { shadow: 'medium', light: { accent: '#123456' } } } })
    expect(one.errors).toEqual([])
    const two = validateChangelogConfig({ style: { custom: { dark: { background: '#101010' } } } }, one.config)
    expect(two.config.style).toMatchObject({ source: 'custom', custom: { shadow: 'medium', light: { accent: '#123456' }, dark: { background: '#101010' } } })
    const bad = validateChangelogConfig({ style: { source: 'both', custom: { shadow: 'huge' } } }, two.config)
    expect(bad.errors).toHaveLength(2)
    expect(bad.config.style).toEqual(two.config.style)
  })
})

describe('feedback board style', () => {
  test('the board takes its style like the changelog does, and keeps it when other settings change', () => {
    expect(DEFAULT_FEEDBACK_CONFIG.style.source).toBe('project')
    const one = validateFeedbackConfig({ style: { source: 'custom', custom: { radius: 20, dark: { background: '#101010' } } } })
    expect(one.errors).toEqual([])
    const two = validateFeedbackConfig({ title: 'Ideas' }, one.config)
    expect(two.config.style).toMatchObject({ source: 'custom', custom: { radius: 20, dark: { background: '#101010' } } })
    const bad = validateFeedbackConfig({ style: { source: 'nope', custom: { radius: 99 } } }, two.config)
    expect(bad.errors).toHaveLength(2)
    expect(bad.config.style).toEqual(two.config.style)
  })
})
