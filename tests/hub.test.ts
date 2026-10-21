import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { composeHubSections, DEFAULT_HUB_CONFIG, HUB_HOME_SECTIONS, HUB_LIMITS, HUB_SECTIONS, hubTitle, normalizeHubConfig, validateHubConfig, type HubSectionContent } from '../shared/hub'
import { projectLook } from '../shared/projectLook'
import { HUB_PAGE_CSP, renderHubPage } from '../server/utils/hubPage'
import type { HubData } from '../server/utils/hub'

describe('hub config', () => {
  test('the page and the Home tab are off until a project turns them on', () => {
    expect(DEFAULT_HUB_CONFIG.enabled).toBe(false)
    expect(DEFAULT_HUB_CONFIG.widgetHome.enabled).toBe(false)
    expect(normalizeHubConfig(undefined).sections).toEqual([...HUB_SECTIONS])
    expect(normalizeHubConfig({ enabled: 'yes' }).enabled).toBe(false)
  })

  test('only the keys sent change; sections and links are whole lists', () => {
    const base = normalizeHubConfig({ enabled: true, title: 'Acme', links: [{ label: 'Docs', url: 'https://docs.acme.test' }] })
    const { config, errors } = validateHubConfig({ tagline: ' Hi ', sections: ['blog', 'changelog', 'blog'], widgetHome: { enabled: true, sections: ['onboarding'] } }, base)
    expect(errors).toEqual([])
    expect(config).toMatchObject({ enabled: true, title: 'Acme', tagline: 'Hi', sections: ['blog', 'changelog'], widgetHome: { enabled: true, sections: ['onboarding'] } })
    expect(config.links).toEqual(base.links)
    expect(validateHubConfig({ widgetHome: { enabled: true } }, config).config.widgetHome.sections).toEqual(['onboarding'])
  })

  test('bad values are reported and not applied', () => {
    expect(validateHubConfig({ sections: ['changelog', 'secrets'] }).errors).toHaveLength(1)
    expect(validateHubConfig({ widgetHome: { sections: ['blog'] } }).errors).toHaveLength(1)
    expect(validateHubConfig({ title: 'x'.repeat(HUB_LIMITS.title + 1) }).errors).toHaveLength(1)
    expect(validateHubConfig({ links: [{ label: 'x', url: 'javascript:alert(1)' }] }).errors).toHaveLength(1)
    expect(validateHubConfig({ links: [{ label: '', url: 'https://a.test' }] }).errors).toHaveLength(1)
    expect(validateHubConfig({ links: Array.from({ length: HUB_LIMITS.links + 1 }, () => ({ label: 'a', url: 'https://a.test' })) }).errors).toHaveLength(1)
    expect(validateHubConfig([]).errors).toEqual(['hub must be an object'])
    expect(validateHubConfig({ enabled: 1 }).config.enabled).toBe(false)
  })

  test('the title falls back to the project name', () => {
    expect(hubTitle({ title: '' }, 'Acme')).toBe('Acme')
    expect(hubTitle({ title: 'Acme help' }, 'Acme')).toBe('Acme help')
  })
})

const content = (part: Partial<HubSectionContent>): HubSectionContent => ({ title: 'T', url: '', text: '', items: [], action: '', ...part })

describe('hub sections', () => {
  test('only sections with something public appear, in the configured order', () => {
    const config = normalizeHubConfig({ sections: ['contact', 'blog', 'changelog', 'legal'] })
    const views = composeHubSections(config, {
      changelog: content({ title: 'What is new', items: [{ title: 'Dark mode', url: 'https://x.test', meta: '' }] }),
      blog: content({ title: 'Blog' }),
      roadmap: content({ url: 'https://x.test/roadmap' }),
      contact: content({ action: 'chat' }),
      legal: null
    })
    // Blog is empty, roadmap is not listed, legal has nothing.
    expect(views.map(v => v.key)).toEqual(['contact', 'changelog'])
  })
})

const data = (over: Partial<HubData> = {}): HubData => ({
  project: { name: 'Acme <b>', publicKey: 'pk_abc' },
  look: projectLook({ name: 'Acme <b>', brand: { colors: [{ name: 'Sky', hex: '#0ea5e9' }], page: { accent: '#16a34a', radius: 'round', theme: 'dark' }, fonts: [{ name: 'Fraunces', role: 'display', cssUrl: 'https://fonts.googleapis.com/css2?family=Fraunces' }] }, brandLook: { logoUrl: 'https://cdn.test/logo.svg', logoDarkUrl: 'https://cdn.test/logo-dark.svg' } }),
  hub: { enabled: true, title: 'Acme <help>', tagline: 'We "ship" <fast>', url: 'https://help.test/hub/pk_abc' },
  sections: [
    { key: 'changelog', title: 'What is new', url: 'https://help.test/changelog/pk_abc', text: '', action: '', items: [{ title: '<script>alert(1)</script>', url: 'https://help.test/changelog/pk_abc', meta: 'Oct 1, 2026' }, { title: 'Bad link', url: 'javascript:alert(1)', meta: '' }] },
    { key: 'about', title: 'About', url: '', text: 'First line\n\nSecond <i>line</i>', action: '', items: [] },
    { key: 'contact', title: 'Contact us', url: '', text: '', items: [], action: 'chat' }
  ],
  links: [{ label: 'Docs & more', url: 'https://docs.acme.test/?a=1&b=2' }, { label: 'Quote', url: 'https://x.test/"onmouseover="alert(1)' }],
  home: null,
  ...over
})

describe('hub page', () => {
  const html = renderHubPage(data())

  test('wears the project look', () => {
    expect(html).toContain('--accent: #16a34a')
    expect(html).toContain('--radius: 16px')
    expect(html).toContain('data-scheme="dark"')
    expect(html).toContain('"Fraunces"')
    expect(html).toContain('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces">')
    expect(html).toContain('class="logo on-light" src="https://cdn.test/logo.svg"')
    expect(html).toContain('class="logo on-dark" src="https://cdn.test/logo-dark.svg"')
  })

  test('everything is escaped and no link can run script', () => {
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Acme &lt;help&gt;')
    expect(html).toContain('Second &lt;i&gt;line&lt;/i&gt;')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('href="#"')
    expect(html).toContain('Docs &amp; more')
    expect(html).toContain('href="https://docs.acme.test/?a=1&amp;b=2"')
    expect(html).not.toContain('onmouseover')
    // The only scripts are the fixed click handler and the loader from this origin.
    const scripts = html.match(/<script[^>]*>/g)
    expect(scripts).toEqual(['<script>', '<script src="/helpbites.js" data-project="pk_abc" data-features="chat" async>'])
  })

  test('the CSP allows the one inline script by its hash, and only fonts from Google', () => {
    const inline = /<script>([^<]*)<\/script>/.exec(html)![1]!
    expect(HUB_PAGE_CSP).toContain(`'sha256-${createHash('sha256').update(inline).digest('base64')}'`)
    expect(HUB_PAGE_CSP).toContain("script-src 'self' 'sha256-")
    expect(HUB_PAGE_CSP).toContain("default-src 'none'")
    expect(HUB_PAGE_CSP).not.toContain('unsafe-eval')
  })

  test('Contact us opens the chat; a section with a list links to all of it', () => {
    expect(html).toContain('data-chat')
    expect(html).toContain('See all')
    expect(html).toContain('<h1>Acme &lt;help&gt;</h1>')
  })

  test('a font that is not on Google Fonts is never linked', () => {
    const look = { ...data().look, fontCssUrls: ['https://evil.test/x.css'] }
    expect(renderHubPage(data({ look }))).not.toContain('evil.test')
  })

  test('colours and fonts cannot close the style block', () => {
    const look = { ...data().look, accent: '#fff;}</style><script>alert(1)</script>', fontFamily: { display: '"A</style>"', body: '"B</style>"', mono: 'monospace' } }
    const out = renderHubPage(data({ look }))
    expect(out).not.toContain('</style><script>alert(1)')
    expect(out.match(/<\/style>/g)).toHaveLength(1)
  })
})

describe('native parity', () => {
  const swift = readFileSync(join(import.meta.dir, '..', 'helpbites-native/App/Features/Projects/ProjectsCompanyHub.swift'), 'utf8')
  const list = (values: readonly string[]) => `[${values.map(v => JSON.stringify(v)).join(', ')}]`

  test('the Swift hub config has the same sections and link limit', () => {
    expect(swift).toContain(`static let sectionKeys = ${list(HUB_SECTIONS)}`)
    expect(swift).toContain(`static let homeSectionKeys = ${list(HUB_HOME_SECTIONS)}`)
    expect(swift).toContain(`static let maxLinks = ${HUB_LIMITS.links}`)
  })
})
