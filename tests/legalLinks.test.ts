import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type EmailDocument } from '../shared/email/blocks'
import { extractTemplateVariables } from '../shared/email/placeholders'
import { PROJECT_VARIABLES, projectBrandVars, resolveTemplate } from '../shared/email/resolve'
import { buildLegalLinks, normalizeLegalLinks } from '../shared/legal/links'
import { brandOf } from '../server/utils/emails'
import { legalLinksOf } from '../server/utils/legalLinks'

const base = 'https://help.example.com'

describe('legal links', () => {
  test('one public address per document type, only for published documents', () => {
    const links = buildLegalLinks([
      { type: 'privacy', slug: 'privacy', publishedAt: '2026-01-01T00:00:00Z' },
      { type: 'terms', slug: 'terms of use', publishedAt: '2026-02-01T00:00:00Z' }
    ], `${base}/`, 'pk_abc')
    expect(links).toEqual({
      privacyUrl: `${base}/legal/pk_abc/privacy`,
      termsUrl: `${base}/legal/pk_abc/terms%20of%20use`,
      cookiesUrl: '',
      refundUrl: ''
    })
  })

  test('an original beats a translation; the newest original wins', () => {
    const links = buildLegalLinks([
      { type: 'privacy', slug: 'privacidad', translationOf: 'doc1', publishedAt: '2026-05-01T00:00:00Z' },
      { type: 'privacy', slug: 'privacy-old', publishedAt: '2026-01-01T00:00:00Z' },
      { type: 'privacy', slug: 'privacy', publishedAt: '2026-03-01T00:00:00Z' }
    ], base, 'pk_abc')
    expect(links.privacyUrl).toBe(`${base}/legal/pk_abc/privacy`)
    // A project whose only published privacy policy is a translation still links it.
    expect(buildLegalLinks([{ type: 'privacy', slug: 'privacidad', translationOf: 'doc1' }], base, 'pk_abc').privacyUrl).toContain('/privacidad')
  })

  test('with no public address to build on, every link is blank', () => {
    expect(buildLegalLinks([{ type: 'privacy', slug: 'privacy' }], '', 'pk_abc').privacyUrl).toBe('')
    expect(buildLegalLinks([], base, 'pk_abc')).toEqual({ privacyUrl: '', termsUrl: '', cookiesUrl: '', refundUrl: '' })
  })

  test('saved links are checked on the way out', () => {
    expect(normalizeLegalLinks({ privacyUrl: 'javascript:alert(1)', termsUrl: ' https://x.test/t ', other: 'y' })).toEqual({ privacyUrl: '', termsUrl: 'https://x.test/t', cookiesUrl: '', refundUrl: '' })
    expect(legalLinksOf({ get: () => undefined }).privacyUrl).toBe('')
  })
})

const footer: EmailDocument = {
  settings: DEFAULT_SETTINGS,
  blocks: [
    { id: 'a', type: 'text', html: '{{project.company}} · {{project.address}} · {{project.email}}', align: 'center' },
    { id: 'b', type: 'text', html: '<a href="{{project.privacyUrl}}">Privacy</a> <a href="{{project.termsUrl}}">Terms</a> {{project.cookiesUrl}}{{project.refundUrl}} {{unknown}}', align: 'center' }
  ]
}
const html = (doc: EmailDocument, id: string) => (doc.blocks.find(b => b.id === id) as { html: string }).html
const master = { name: 'm', document: footer, variables: [] }

describe('project email variables', () => {
  test('the new variables fill in from the project', () => {
    const brand = {
      name: 'Acme', company: { name: 'Acme', legalName: 'Acme Ltd', address: '1 Main St', email: 'hi@acme.test' },
      legalLinks: { privacyUrl: `${base}/legal/pk/privacy`, termsUrl: `${base}/legal/pk/terms` }
    }
    const { document } = resolveTemplate(master, { brand })
    expect(html(document, 'a')).toBe('Acme · 1 Main St · hi@acme.test')
    expect(html(document, 'b')).toContain(`href="${base}/legal/pk/privacy"`)
    expect(html(document, 'b')).toContain(`href="${base}/legal/pk/terms"`)
  })

  test('a project without them gets blanks, never a leaked placeholder; unknown ones stay as written', () => {
    const { document } = resolveTemplate(master, { brand: { name: 'Acme' } })
    expect(html(document, 'a')).toBe('Acme ·  · ')
    expect(html(document, 'b')).not.toContain('{{project.')
    expect(html(document, 'b')).toContain('{{unknown}}')
  })

  test('projectBrandVars sets every project variable, the company name falling back to the project name', () => {
    const vars = projectBrandVars({ name: 'Acme' })
    expect(Object.keys(vars).sort()).toEqual([...PROJECT_VARIABLES].sort())
    expect(vars['project.company']).toBe('Acme')
    expect(projectBrandVars({ name: 'Acme', company: { legalName: 'Acme Ltd' } })['project.company']).toBe('Acme Ltd')
    // The address from the older field still shows when the company has none.
    expect(projectBrandVars({ address: '2 Old St' })['project.address']).toBe('2 Old St')
    expect(projectBrandVars({ look: { logoUrl: 'https://cdn.test/kit.svg' }, brandLogoUrl: 'https://old.test/logo.png' })['project.logoUrl']).toBe('https://cdn.test/kit.svg')
  })

  test('the server builds the same brand from a project row', () => {
    const row = { get: (key: string) => ({ name: 'Acme', company: { name: 'Acme', email: 'hi@acme.test' }, legalLinks: { privacyUrl: `${base}/legal/pk/privacy` } } as Record<string, unknown>)[key] }
    const vars = projectBrandVars(brandOf(row as never))
    expect(vars).toMatchObject({ 'project.company': 'Acme', 'project.email': 'hi@acme.test', 'project.privacyUrl': `${base}/legal/pk/privacy`, 'project.termsUrl': '' })
  })

  test('the lint, the AI prompt, the docs and the Swift port name the variables', () => {
    const root = join(import.meta.dir, '..')
    const read = (path: string) => readFileSync(join(root, path), 'utf8')
    for (const key of PROJECT_VARIABLES) {
      expect(read('docs/EMAIL.md')).toContain(`{{${key}}}`)
      expect(read('helpbites-native/App/Features/Email/EmailRender.swift')).toContain(`"${key}"`)
    }
    expect(read('server/utils/emailAi.ts')).toContain('{{project.privacyUrl}}')
    expect(read('shared/email/lint.ts')).toContain('{{project.privacyUrl}}')
    expect(extractTemplateVariables(footer).filter(k => k.startsWith('project.')).every(k => (PROJECT_VARIABLES as readonly string[]).includes(k))).toBe(true)
  })
})
