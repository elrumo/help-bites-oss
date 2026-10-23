import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_HUB_CONFIG, validateHubConfig } from '../shared/hub'
import { DEFAULT_WIDGET_CONFIG, normalizeWidgetConfig, validateWidgetConfig } from '../shared/widget'
import { normalizeProjectStyle, resolveStyle, styleLayers } from '../shared/projectStyle'
import { projectLook } from '../shared/projectLook'
import { renderHubPage } from '../server/utils/hubPage'
import type { HubData } from '../server/utils/hub'

const look = projectLook({ name: 'Acme', brand: { page: { accent: '#16a34a' } } })
const hubPage = (style = look.style) => renderHubPage({ project: { name: 'Acme', publicKey: 'pk_abc' }, look, style, hub: { enabled: true, title: 'Acme', tagline: '', url: '' }, sections: [], links: [], home: null } satisfies HubData)

describe('hub and widget style choices', () => {
  test('both start on the project style', () => {
    expect(DEFAULT_HUB_CONFIG.style.source).toBe('project')
    expect(DEFAULT_WIDGET_CONFIG.style.source).toBe('project')
  })

  test('a partial choice changes only what is sent, and a bad one changes nothing', () => {
    const hub = validateHubConfig({ style: { source: 'custom', custom: { shadow: 'strong', dark: { background: '#000000' } } } }).config
    expect(hub.style).toMatchObject({ source: 'custom', custom: { shadow: 'strong', dark: { background: '#000000' } } })
    expect(validateHubConfig({ title: 'Hi' }, hub).config.style).toEqual(hub.style)
    const bad = validateHubConfig({ style: { source: 'nope' } }, hub)
    expect(bad.errors).toEqual(['style.source is one of project, custom'])
    expect(bad.config.style).toEqual(hub.style)

    const widget = validateWidgetConfig({ style: { source: 'custom', custom: { radius: 20 } } }).config
    expect(widget.style.custom.radius).toBe(20)
    expect(normalizeWidgetConfig('junk')).toEqual(DEFAULT_WIDGET_CONFIG)
    expect(validateWidgetConfig({ style: { custom: { radius: 99 } } }).errors).toHaveLength(1)
    expect(validateWidgetConfig('x').errors).toEqual(['widget must be an object'])
  })

  test("the widget's own choices lay over the project style", () => {
    const project = normalizeProjectStyle({ light: { accent: '#112233' }, radius: 4 })
    const widget = validateWidgetConfig({ style: { source: 'custom', custom: { radius: 18 } } }).config
    const style = resolveStyle(look.kit, ...styleLayers(project, widget.style))
    expect(style).toMatchObject({ radius: 18 })
    expect(style.light.accent).toBe('#112233')
    expect(resolveStyle(look.kit, ...styleLayers(project, DEFAULT_WIDGET_CONFIG.style)).radius).toBe(4)
  })
})

describe('hub page style', () => {
  test('auto follows the visitor: light colours and a dark block', () => {
    const html = hubPage(resolveStyle(look.kit, normalizeProjectStyle({ light: { accent: '#e11d48' }, dark: { background: '#101820' } })))
    expect(html).toContain('--accent:#e11d48')
    expect(html).toContain('@media (prefers-color-scheme:dark){:root{')
    expect(html).toContain('--bg:#101820')
    expect(html).toContain('box-shadow: var(--shadow)')
    expect(html).toContain('data-scheme="auto"')
  })

  test('a style that fixes the scheme gets only that palette', () => {
    const html = hubPage(resolveStyle(look.kit, normalizeProjectStyle({ scheme: 'dark', dark: { background: '#101820' } })))
    expect(html).toContain('data-scheme="dark"')
    expect(html).not.toContain('prefers-color-scheme:dark){:root{')
    expect(html).toContain('--bg:#101820')
  })

  test("the Brand kit's page theme still decides while the style leaves the scheme open", () => {
    const dark = projectLook({ name: 'Acme', brand: { page: { theme: 'dark' } } })
    expect(hubPage(dark.style).replace(/\s+/g, ' ')).toContain('data-scheme="auto"')
    expect(renderHubPage({ project: { name: 'Acme', publicKey: 'pk_abc' }, look: dark, style: dark.style, hub: { enabled: true, title: 'Acme', tagline: '', url: '' }, sections: [], links: [], home: null })).toContain('data-scheme="dark"')
  })
})

describe('the chat widget loader', () => {
  const widget = readFileSync(join(import.meta.dir, '..', 'public/widget.js'), 'utf8')
  const loader = readFileSync(join(import.meta.dir, '..', 'public/helpbites.js'), 'utf8')

  test('passes the host\'s accent, radius, shadow and theme to the frame', () => {
    for (const name of ['data-theme', 'data-radius', 'data-shadow', "'&accent='", "'&radius='", "'&shadow='", "'&theme='"]) expect(widget).toContain(name)
    expect(widget).toContain('widgetStyle')
  })

  test('helpbites.js hands the same attributes to every module', () => {
    expect(loader).toContain("var SHARED = ['accent', 'theme', 'radius', 'shadow',")
  })
})
