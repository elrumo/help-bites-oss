import { describe, expect, test } from 'bun:test'
import { normalizeLegalConfig, validateLegalConfig, withEntityDefaults } from '../shared/legal/config'
import type { LegalSection } from '../shared/legal/types'
import { renderLegalPage } from '../server/utils/legalPage'
import { legalToc, renderLegalHtml, sectionAnchors } from '../server/utils/legalRender'

const section = (heading: string, body: string): LegalSection => ({ id: heading, heading, body, source: 'template', locked: false, satisfies: [] })
const project = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] }) as unknown as ParseObject

describe('legal rendering', () => {
  test('anchors are unique and fall back for headings with no letters', () => {
    expect(sectionAnchors([{ heading: 'Contact us' }, { heading: 'Contact us' }, { heading: '???' }])).toEqual(['contact-us', 'contact-us-2', 'section-3'])
  })

  test('a heading cannot inject markup and a body is sanitised', () => {
    const html = renderLegalHtml([section('<script>alert(1)</script>', 'Hello <script>alert(2)</script> [x](javascript:alert(3)) **bold**')])
    expect(html).not.toContain('<script')
    // markdown-it refuses the link and leaves it as text: no anchor, no href.
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href=')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<section id="script-alert-1-script">')
  })

  test('the page carries the title, summary, contents and branding, all escaped', () => {
    const sections = ['One', 'Two', 'Three', 'Four'].map(h => section(h, `${h} text`))
    const page = renderLegalPage(
      project({ name: 'Acme <b>', theme: { accent: '#ff0066' }, legal: { font: 'serif', footerText: 'Acme & Co' } }),
      { type: 'privacy', slug: 'privacy', title: 'Privacy Policy', tldr: 'We "collect" <little>.', effectiveDate: '2026-10-19T00:00:00.000Z', version: 2, html: renderLegalHtml(sections), sections },
      [{ title: 'Terms', path: '/legal/pk_x/terms' }],
      null
    )
    expect(page).toContain('--brand: #ff0066')
    expect(page).toContain('Georgia')
    expect(page).toContain('Acme &lt;b&gt;')
    expect(page).toContain('We &quot;collect&quot; &lt;little&gt;.')
    expect(page).toContain('Effective October 19, 2026')
    expect(page).toContain('Version 2')
    expect(page).toContain('href="#four"')
    expect(page).toContain('Acme &amp; Co')
    expect(page).toContain('href="/legal/pk_x/terms"')
    expect(page).toContain('content="index,follow"')
  })

  test('the contents list is left out of a short document', () => {
    const sections = [section('Only', 'x')]
    const page = renderLegalPage(project({ name: 'A' }), { type: 'terms', slug: 'terms', title: 'T', tldr: '', effectiveDate: null, version: 0, html: renderLegalHtml(sections), sections }, [], null)
    expect(page).not.toContain('class="toc"')
    expect(legalToc(sections)).toEqual([{ id: 'only', title: 'Only' }])
  })
})

describe('project legal config', () => {
  test('defaults, and only the keys sent change', () => {
    const base = normalizeLegalConfig(undefined)
    expect(base.font).toBe('system')
    const { config, errors } = validateLegalConfig({ entity: { name: ' Acme ' }, accent: '#00ff00' }, base)
    expect(errors).toEqual([])
    expect(config.entity.name).toBe('Acme')
    expect(config.entity.email).toBe('')
    expect(config.accent).toBe('#00ff00')
  })

  test('bad values are reported and not applied', () => {
    const { config, errors } = validateLegalConfig({ accent: 'red', font: 'comic', logoUrl: 'javascript:alert(1)', entity: { email: 'nope' } })
    expect(errors).toHaveLength(4)
    expect(config.accent).toBe('')
    expect(config.font).toBe('system')
    expect(config.logoUrl).toBe('')
  })

  test('the saved identity fills only what the answers leave out', () => {
    const config = normalizeLegalConfig({ entity: { name: 'Acme Ltd', email: 'legal@acme.test' } })
    const out = withEntityDefaults({ app_name: 'Mine', contact_email: '  ' }, config, { name: 'Project', siteUrl: 'https://acme.test' })
    expect(out).toMatchObject({ app_name: 'Mine', entity_name: 'Acme Ltd', contact_email: 'legal@acme.test', website_url: 'https://acme.test' })
  })
})
