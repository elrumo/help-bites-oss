import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { DOCS, REPO_URL, docByFile, docPath, resolveDocLink } from '../shared/docs'
import { headingSlug, renderDoc } from '../server/utils/docsRender'

const source = (file: string) => readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8')

describe('resolveDocLink', () => {
  test('a published guide links to its page, with the anchor kept', () => {
    expect(resolveDocLink('CONNECTING.md')).toEqual({ href: '/docs/connect', external: false })
    expect(resolveDocLink('./DEPLOYMENT.md#first-run')).toEqual({ href: '/docs/self-host#first-run', external: false })
    expect(resolveDocLink('../docs/ERRORS.md')).toEqual({ href: '/docs/errors', external: false })
  })

  test('a file that is not published links to it on GitHub, a folder to its listing', () => {
    expect(resolveDocLink('MARKETING.md#sequences')).toEqual({ href: `${REPO_URL}/blob/main/docs/MARKETING.md#sequences`, external: true })
    expect(resolveDocLink('../CONTRIBUTING.md')).toEqual({ href: `${REPO_URL}/blob/main/CONTRIBUTING.md`, external: true })
    expect(resolveDocLink('../helpbites-native/')).toEqual({ href: `${REPO_URL}/tree/main/helpbites-native`, external: true })
  })

  test('in-page anchors and absolute links are left alone; only web links open a new tab', () => {
    expect(resolveDocLink('#architecture')).toEqual({ href: '#architecture', external: false })
    expect(resolveDocLink('https://glitchtip.com')).toEqual({ href: 'https://glitchtip.com', external: true })
    expect(resolveDocLink('mailto:hi@example.com')).toEqual({ href: 'mailto:hi@example.com', external: false })
  })
})

describe('headingSlug', () => {
  test("matches GitHub's ids, which the guides' own #anchors were written against", () => {
    expect(headingSlug('Quick start (local)')).toBe('quick-start-local')
    expect(headingSlug('Parse + MongoDB')).toBe('parse--mongodb')
    expect(headingSlug('Example production .env')).toBe('example-production-env')
    expect(headingSlug('Reading flags: GET /v1/flags')).toBe('reading-flags-get-v1flags')
  })
})

describe('renderDoc', () => {
  test('drops the file title and a hand-written contents list, and numbers the rest', async () => {
    const { html, headings } = await renderDoc('# Title\n\nIntro.\n\n---\n\n## Contents\n\n- [A](#a)\n\n---\n\n## A\n\nBody.\n\n### Same\n\n### Same\n')
    expect(html).not.toContain('Title')
    expect(html).not.toContain('Contents')
    expect(headings.map(h => h.id)).toEqual(['a', 'same', 'same-1'])
    expect(html.match(/<hr>/g)).toHaveLength(1)
  })

  test('shows raw HTML as text instead of rendering it', async () => {
    const { html } = await renderDoc('# T\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
  })

  test('fences are highlighted and tables scroll on their own', async () => {
    const { html } = await renderDoc('# T\n\n```bash\ndocker compose up -d\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(html).toContain('shj-lang-bash')
    expect(html).toContain('shj-syn-')
    expect(html).toContain('<div class="table-wrap"><table>')
  })

  test('checklist items become task items', async () => {
    const { html } = await renderDoc('# T\n\n- [ ] one\n- [x] two\n')
    expect(html).toContain('<li class="task-item">one</li>')
    expect(html).toContain('<li class="task-item task-done">two</li>')
  })
})

describe('the published guides', () => {
  test('every entry has a file, a unique slug, and its text imported by the server', () => {
    expect(new Set(DOCS.map(doc => doc.slug)).size).toBe(DOCS.length)
    const loader = readFileSync(new URL('../server/utils/docsSource.ts', import.meta.url), 'utf8')
    for (const doc of DOCS) {
      expect(source(doc.file).length).toBeGreaterThan(0)
      expect(loader).toContain(`docs/${doc.file}`)
    }
  })

  test('every link in every guide goes somewhere that exists', async () => {
    const ids = new Map<string, Set<string>>()
    const rendered = new Map<string, string>()
    for (const doc of DOCS) {
      const page = await renderDoc(source(doc.file))
      ids.set(docPath(doc), new Set([...page.html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]!)))
      rendered.set(docPath(doc), page.html)
    }

    const broken: string[] = []
    for (const [path, html] of rendered) {
      for (const [, href] of html.matchAll(/<a [^>]*?href="([^"]+)"/g)) {
        if (!href || href.startsWith('http') || href.startsWith('mailto:')) continue
        const [page = '', fragment] = href.split('#') as [string, string?]
        const target = page || path
        if (!ids.has(target)) broken.push(`${path} → ${href} (no such page)`)
        else if (fragment && !href.includes('heading-anchor') && !ids.get(target)!.has(fragment)) broken.push(`${path} → ${href} (no such heading)`)
      }
    }
    expect(broken).toEqual([])
  })

  test('the registry finds a guide by its file', () => {
    expect(docByFile('DEPLOYMENT.md')?.slug).toBe('self-host')
  })
})
