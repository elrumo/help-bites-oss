import { afterEach, describe, expect, test } from 'bun:test'
import { definePlan, UNLIMITED_PLAN } from '../shared/entitlements'
import { edition, planFor, registerEdition, resetEdition } from '../server/utils/edition'

// poweredByFor reaches the plan through Nitro's auto-imports; stub the ones usage.ts needs.
const g = globalThis as Record<string, unknown>
g.edition = edition
g.planFor = planFor
g.pointerId = (value: unknown) => (typeof value === 'string' ? value : (value as { id?: string } | null)?.id || '')
g.getWorkspace = async (id: string) => (id ? { id, get: () => undefined } : null)
g.workspaceIdOfProject = async () => ''
const { projectWorkspaceId, workspacePlan } = await import('../server/utils/usage')
g.projectWorkspaceId = projectWorkspaceId
g.workspacePlan = workspacePlan
const { poweredByFor, poweredByHtml, poweredByText, withPoweredByHtml, withPoweredByText } = await import('../server/utils/branding')
const { renderMessageEmail } = await import('../server/utils/messageEmail')
const { composeEmail, parseEmailSendRequest } = await import('../server/utils/emailSend')
const { renderMarketingPage } = await import('../server/utils/marketingPages')

afterEach(() => resetEdition())

const project = { id: 'p1', get: (key: string) => (key === 'workspace' ? { id: 'w1' } : key === 'name' ? 'Acme' : undefined) } as any
const badge = { url: 'https://helpbites.example/?ref=badge' }
const cloud = (features: Record<string, boolean>) => registerEdition({ id: 'cloud', brandUrl: badge.url, planFor: () => definePlan({ id: 'free', name: 'Free', features }) })

describe('poweredByFor', () => {
  test('the community edition never shows it: every workspace is unlimited', async () => {
    expect(UNLIMITED_PLAN.features.removeBranding).toBe(true)
    expect(await poweredByFor(project)).toBeNull()
  })

  test('a plan without removeBranding shows it, linking to the edition\'s brand URL', async () => {
    cloud({})
    expect(await poweredByFor(project)).toEqual(badge)
    cloud({ removeBranding: true })
    expect(await poweredByFor(project)).toBeNull()
  })

  test('a failed plan lookup hides it rather than failing the page', async () => {
    registerEdition({ id: 'cloud', planFor: () => { throw new Error('down') } })
    expect(await poweredByFor(project)).toBeNull()
  })
})

describe('the badge in pages and email', () => {
  test('nothing at all without a badge', () => {
    expect(poweredByHtml(null)).toBe('')
    expect(poweredByText(null)).toBe('')
    expect(withPoweredByHtml('<body><p>Hi</p></body>', null)).toBe('<body><p>Hi</p></body>')
    expect(withPoweredByText('Hi', null)).toBe('Hi')
  })

  test('a small muted link, escaped, at the end of the body', () => {
    expect(poweredByHtml(badge)).toContain('<a href="https://helpbites.example/?ref=badge"')
    expect(poweredByHtml(badge)).toContain('font-size: 12px')
    expect(poweredByHtml({ url: 'https://x.test/"><script>' })).not.toContain('<script>')
    expect(withPoweredByHtml('<html><body><p>Hi</p></BODY></html>', badge)).toMatch(/<p>Hi<\/p><p [^>]*><a [^>]*>Powered by HelpBites<\/a><\/p>\n<\/BODY><\/html>$/)
    expect(withPoweredByText('Hi\n', badge)).toBe(`Hi\n\nPowered by HelpBites: ${badge.url}`)
  })

  test('the message email carries it only with a badge', () => {
    const input = { appName: 'Acme', body: 'Hello', attachmentUrls: [] }
    const plain = renderMessageEmail(input)
    expect(plain.html).not.toContain('Powered by HelpBites')
    expect(plain.html).not.toContain('{{poweredBy}}')
    expect(plain.text).not.toContain('Powered by HelpBites')
    const branded = renderMessageEmail({ ...input, poweredBy: badge })
    expect(branded.html.match(/Powered by HelpBites/g)).toHaveLength(1)
    expect(branded.text.endsWith(`Powered by HelpBites: ${badge.url}`)).toBe(true)
  })

  test('a composed send carries it once, in every kind of content', () => {
    const sender = { fromName: 'Acme', fromEmail: 'hi@acme.test', domain: 'acme.test', replyTo: '' }
    const html = parseEmailSendRequest({ to: 'ada@example.com', html: '<p>Hi</p>', subject: 'Hi' }, [])
    const message = parseEmailSendRequest({ to: 'ada@example.com', message: { subject: 'Hi', body: 'Hello' } }, [])
    for (const request of [html, message]) {
      const content = request.content as any
      expect(composeEmail(project, content, request, request.recipients[0]!, sender).html).not.toContain('Powered by HelpBites')
      const out = composeEmail(project, content, request, request.recipients[0]!, sender, badge)
      expect(out.html.match(/Powered by HelpBites/g)).toHaveLength(1)
      expect(out.text.match(/Powered by HelpBites/g)).toHaveLength(1)
    }
  })

  test('the hosted pages carry it only with a badge', () => {
    const brand = { name: 'Acme', logoUrl: '', accent: '#4f46e5' }
    expect(renderMarketingPage(brand, 'Subscribe', '<h1>Hi</h1>')).not.toContain('Powered by HelpBites')
    expect(renderMarketingPage({ ...brand, poweredBy: badge }, 'Subscribe', '<h1>Hi</h1>')).toContain('Powered by HelpBites')
  })
})
