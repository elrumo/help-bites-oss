import { describe, expect, test } from 'bun:test'
import {
  blogReadingMinutes,
  blogSlugify,
  blogTitle,
  fillBlogPostUrl,
  isBlogPostLive,
  normalizeBlogConfig,
  readBlogCommentInput,
  readBlogPostInput,
  summarizeBlogReactions,
  threadBlogComments,
  validateBlogConfig
} from '../shared/blog'
import { blogEmailHtml, blogPlainText, deriveBlogExcerpt, literalBraceText, renderBlogBody } from '../server/utils/blogRender'
import { blogNewsletterDocument } from '../server/utils/blogNewsletter'
import { blogPageProject, renderBlogIndex, renderBlogPost } from '../server/utils/blogPage'
import { complianceProblems } from '../server/utils/campaigns'
import { renderEmailHtml } from '../shared/email/render'
import { extractTemplateVariables } from '../shared/email/placeholders'

process.env.APP_URL = 'https://support.example.com'

const fake = (fields: Record<string, unknown>, id = 'x') => ({ id, get: (k: string) => fields[k] }) as any

describe('blog rules', () => {
  test('a title becomes a slug: accents keep their letter, the rest is hyphens', () => {
    expect(blogSlugify('Cómo empezar: ¡rápido!')).toBe('como-empezar-rapido')
    expect(blogSlugify('  Hello,   World!!  ')).toBe('hello-world')
    expect(blogSlugify('🎉🎉')).toBe('')
    expect(blogSlugify('x'.repeat(100)).length).toBe(80)
    expect(blogSlugify(`${'a'.repeat(79)} b`)).toBe('a'.repeat(79))
  })

  test('a create needs a title and starts as a draft; only the keys sent change on an update', () => {
    expect(readBlogPostInput({}, { create: true }).errors).toContain('A title is required')
    const created = readBlogPostInput({ title: '  Hello   there ' }, { create: true })
    expect(created.values).toEqual({ title: 'Hello there', tags: [], status: 'draft' })
    expect(readBlogPostInput({ excerpt: null }, { create: false }).values).toEqual({ excerpt: '' })
    expect(readBlogPostInput({ status: 'live' }, { create: false }).errors[0]).toMatch(/status must be one of/)
    expect(readBlogPostInput({ coverImageUrl: 'javascript:alert(1)' }, { create: false }).errors[0]).toMatch(/http/)
    expect(readBlogPostInput({ publishedAt: 'not a date' }, { create: false }).errors[0]).toMatch(/publishedAt/)
    expect(readBlogPostInput({ slug: 'Mi Entrada' }, { create: false }).values.slug).toBe('mi-entrada')
  })

  test('tags: trimmed, each once whatever its case, at most ten', () => {
    expect(readBlogPostInput({ tags: ['News', ' news ', 'Engineering', ''] }, { create: false }).values.tags).toEqual(['News', 'Engineering'])
    expect(readBlogPostInput({ tags: 'a, b,a' }, { create: false }).values.tags).toEqual(['a', 'b'])
    expect(readBlogPostInput({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, { create: false }).errors[0]).toMatch(/at most 10 tags/)
  })

  test('a published post is live once its date passes', () => {
    const now = Date.parse('2026-10-21T12:00:00Z')
    expect(isBlogPostLive({ status: 'published', publishedAt: '2026-10-21T11:59:00Z' }, now)).toBe(true)
    expect(isBlogPostLive({ status: 'published', publishedAt: '2026-10-21T12:01:00Z' }, now)).toBe(false)
    expect(isBlogPostLive({ status: 'draft', publishedAt: '2026-10-01T00:00:00Z' }, now)).toBe(false)
  })

  test('settings: partial, checked, and off by default', () => {
    expect(normalizeBlogConfig(undefined)).toMatchObject({ enabled: false, comments: true, reactions: true, subscribeForm: false })
    const { config, errors } = validateBlogConfig({ enabled: true, commentNotify: 'A@x.com, b@y.com a@x.com', newsletterTopic: 'Blog' }, normalizeBlogConfig({ title: 'Kept' }))
    expect(errors).toEqual([])
    expect(config).toMatchObject({ enabled: true, title: 'Kept', commentNotify: ['a@x.com', 'b@y.com'], newsletterTopic: 'blog' })
    expect(validateBlogConfig({ postUrl: 'https://acme.test/blog' }).errors[0]).toMatch(/\{slug\}/)
    expect(validateBlogConfig({ postUrl: '{siteUrl}/blog/{slug}' }).errors).toEqual([])
    expect(validateBlogConfig({ enabled: 'yes' }).errors[0]).toMatch(/enabled/)
  })

  test('the post address on the project\'s own site, and the blog\'s name', () => {
    expect(fillBlogPostUrl('{siteUrl}/blog/{slug}', 'https://acme.test/', 'hello')).toBe('https://acme.test/blog/hello')
    expect(fillBlogPostUrl('{siteUrl}/blog/{slug}', '', 'hello')).toBe('')
    expect(fillBlogPostUrl('', 'https://acme.test', 'hello')).toBe('')
    expect(blogTitle({ title: '' }, 'Acme')).toBe('Acme blog')
    expect(blogTitle({ title: 'Field notes' }, 'Acme')).toBe('Field notes')
  })

  test('reactions add up per key, in a fixed order, with the viewer\'s own marked', () => {
    const entries = ['heart:u1', 'heart:u2', 'rocket:u1', 'nope:u3', ':u4']
    expect(summarizeBlogReactions(entries)).toEqual([{ key: 'heart', count: 2 }, { key: 'rocket', count: 1 }])
    expect(summarizeBlogReactions(entries, 'u2')).toEqual([{ key: 'heart', count: 2, reacted: true }, { key: 'rocket', count: 1, reacted: false }])
  })

  test('a thread reads top-level comments with their replies under them', () => {
    const thread = threadBlogComments([
      { id: 'a', parentId: null }, { id: 'b', parentId: null }, { id: 'r1', parentId: 'a' }, { id: 'orphan', parentId: 'gone' }, { id: 'r2', parentId: 'a' }
    ])
    expect(thread.map(c => `${c.id}:${c.depth}`)).toEqual(['a:0', 'r1:1', 'r2:1', 'b:0', 'orphan:0'])
  })

  test('a comment body is read, never a deletion', () => {
    expect(readBlogCommentInput({ body: 'hi', parentId: 'c1' })).toEqual({ body: 'hi', parentId: 'c1', errors: [] })
    expect(readBlogCommentInput({ status: 'gone' }).errors[0]).toMatch(/status/)
  })

  test('reading time: whole minutes, never under one', () => {
    expect(blogReadingMinutes('')).toBe(1)
    expect(blogReadingMinutes('word '.repeat(221))).toBe(2)
  })
})

describe('rendering a post', () => {
  test('Markdown becomes HTML through an allowlist; an h1 becomes an h2', () => {
    const html = renderBlogBody('# Title\n\nHi <script>alert(1)</script> <img src="x" onerror="alert(1)"> <a href="javascript:alert(1)">x</a> <span style="position:fixed">y</span>\n\n![ok](https://example.com/a.png)')
    expect(html).toContain('<h2>Title</h2>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('style=')
    expect(html).toContain('<img src="https://example.com/a.png" alt="ok" loading="lazy" />')
  })

  test('outside links open in a new tab; images only over http(s)', () => {
    expect(renderBlogBody('[out](https://example.com) [in](/docs)')).toBe('<p><a href="https://example.com" target="_blank" rel="noopener">out</a> <a href="/docs">in</a></p>')
    expect(renderBlogBody('<img src="data:image/png;base64,AAAA">')).not.toContain('data:')
  })

  test('the excerpt leaves headings out and cuts on a word', () => {
    expect(deriveBlogExcerpt('## Why\n\nBecause **it** works.')).toBe('Because it works.')
    const long = deriveBlogExcerpt(`## Head\n\n${'lorem ipsum '.repeat(40)}`, 50)
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(51)
    expect(blogPlainText('## Why\n\nBecause')).toBe('Why Because')
  })

  test('the email copy carries our inline styles and nothing else', () => {
    const html = blogEmailHtml('<p style="color:red">Hi <a href="https://x.test">x</a></p><img src="https://x.test/a.png" alt="">', '#0f766e')
    expect(html).toContain('<p style="margin:0 0 16px 0;font-size:16px;line-height:1.65">')
    expect(html).toContain('color:#0f766e')
    expect(html).not.toContain('color:red')
    expect(html).toContain('max-width:100%')
  })
})

describe('the newsletter email', () => {
  const project = fake({ name: 'Acme', publicKey: 'pk_test', theme: { accent: '#0f766e' }, brandLogoUrl: 'https://cdn.test/logo.png', marketing: { postalAddress: '1 Main St' } }, 'p1')
  const post = fake({ title: 'Release {{3}}', slug: 'release-3', excerpt: 'All new', readingMinutes: 4, publishedAt: new Date('2026-10-21T10:00:00Z'), coverImageUrl: 'https://cdn.test/cover.png', bodyHtml: '<p>Use <code>{{ value }}</code> in templates.</p>' }, 'post1')

  test('it has what every campaign must: an unsubscribe link and the postal address', () => {
    const document = blogNewsletterDocument(project, post)
    expect(complianceProblems(project, document)).toEqual([])
    expect(document.blocks.map(b => b.id)).toEqual(['blog_logo', 'blog_title', 'blog_meta', 'blog_cover', 'blog_body', 'blog_read', 'blog_rule', 'blog_footer'])
    expect(document.settings.preheader).toBe('All new')
  })

  test('braces in the post are text, not placeholders to blank', () => {
    const document = blogNewsletterDocument(project, post)
    expect(extractTemplateVariables(document).sort()).toEqual(['preferencesUrl', 'project.address', 'unsubscribeUrl'])
    const html = renderEmailHtml(document)
    expect(html).toContain('&#123;&#123; value &#125;&#125;')
    expect(html).toContain('Release {\u200B{3}\u200B}')
    expect(literalBraceText('{{firstName}} and {one}')).toBe('{\u200B{firstName}\u200B} and {one}')
  })

  test('the button and the cover link to the hosted post', () => {
    const document = blogNewsletterDocument(project, post)
    const button = document.blocks.find(b => b.id === 'blog_read') as { href: string }
    expect(button.href).toBe('https://support.example.com/blog/pk_test/release-3')
  })
})

describe('the hosted blog', () => {
  const project = fake({ name: 'Acme <b>', publicKey: 'pk_test', theme: { accent: '#0f766e' } }, 'p1')
  const config = normalizeBlogConfig({ enabled: true, title: 'Notes', reactions: true })
  const item = { title: 'A <post>', path: '/blog/pk_test/a-post', excerpt: 'Lead "in"', coverImageUrl: 'https://cdn.test/c.png', publishedAt: '2026-10-21T10:00:00Z', readingMinutes: 3, tags: ['News'], authorName: 'Ada' }

  test('the index escapes what it shows and links the feed', () => {
    const html = renderBlogIndex(blogPageProject(project), config, { posts: [item], tag: '', page: 1, hasMore: true, blogPath: '/blog/pk_test', feedUrl: 'https://support.example.com/v1/projects/pk_test/blog.rss', canonical: 'https://support.example.com/blog/pk_test' }, null)
    expect(html).toContain('A &lt;post&gt;')
    expect(html).toContain('Lead &quot;in&quot;')
    expect(html).toContain('type="application/rss+xml"')
    expect(html).toContain('Older →')
  })

  test('a post page has its link preview, its canonical copy and the embed under it', () => {
    const html = renderBlogPost(blogPageProject(project), config, { ...item, bodyHtml: '<p>Body</p>', canonical: 'https://acme.test/blog/a-post', commentsOpen: true }, { blogPath: '/blog/pk_test', feedUrl: 'https://support.example.com/v1/projects/pk_test/blog.rss', scriptSrc: '/blog.js' }, null)
    expect(html).toContain('<link rel="canonical" href="https://acme.test/blog/a-post">')
    expect(html).toContain('<meta property="og:image" content="https://cdn.test/c.png">')
    expect(html).toContain('data-view="extras"')
    expect(html).toContain('data-post="a-post"')
    expect(html).toContain('<p>Body</p>')
  })

  test('no reactions, comments or sign-up: no script at all', () => {
    const quiet = normalizeBlogConfig({ enabled: true, reactions: false, comments: false, subscribeForm: false })
    const html = renderBlogPost(blogPageProject(project), quiet, { ...item, bodyHtml: '', canonical: '', commentsOpen: true }, { blogPath: '/blog/pk_test', feedUrl: '', scriptSrc: '/blog.js' }, null)
    expect(html).not.toContain('<script')
  })
})
